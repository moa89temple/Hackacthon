import type { NewActivityEntry } from "./store.ts";
import type { BrowserAccess } from "./browser-access.ts";
import type { Claude } from "./claude.ts";
import { todayInPhiladelphia, type Clock } from "./clock.ts";
import { readDay } from "./discovery.ts";
import { readEventPage, readEventsPage, type ListedEvent } from "./now-temple-pages.ts";
import { eventListPage, isNowTempleEvent, MOST_EVENT_LIST_PAGES } from "./now-temple-rules.ts";
import { goalKey } from "./opportunities.ts";
import { fetchPublicPage, openPublicPage, readPublicPage, readWholePage, takeInOpportunityPage } from "./opportunity-reading.ts";
import { searchForGoal } from "./opportunity-search.ts";
import { THE_STUDENT, type Store } from "./store.ts";
import type { Web } from "./web.ts";

const DAY_MS = 24 * 3_600_000;
const MISSING_FOR_MS = 14 * DAY_MS;
const SEARCH_EVERY_MS = 7 * DAY_MS;
const SCHEDULE_CHECK_EVERY_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 3_600_000;
const EVENTS_RUN = "events";

/** Each Goal has its own, by its words, so that changing a Goal's words is what makes a new search due. */
const goalRun = (key: string) => `goal:${key}`;

export interface OpportunityDiscovery {
  /**
   * Does whatever has come due: today's read of now.temple.edu, and a search for each Goal that's new, has
   * changed, or was last searched a week ago. Those two go on side by side, because the read can take many
   * minutes and a changed Goal shouldn't wait for it. Two calls at once share a trip. Never throws.
   */
  runDue(): Promise<void>;
  /** Calls runDue from now on, so a changed Goal is searched within a minute. The timer stops when the backend closes. */
  startSchedule(everyMs?: number): void;
  stopSchedule(): void;
}

export interface OpportunityDiscoveryDeps {
  claude: Claude;
  web: Web;
  browserAccess: BrowserAccess;
  clock: Clock;
  store: Store;
  model: string;
  logError: (error: unknown) => void;
}

const problemsIn = (couldNotRead: string[]) => (couldNotRead.length > 0 ? ` Couldn't read: ${couldNotRead.join(", ")}` : "");

function eventsRead(listed: number, couldNotRead: string[], at: Date): NewActivityEntry {
  return { kind: "opportunities_read", title: "Buddy read Temple's events", detail: `Read ${listed - couldNotRead.length} of ${listed} events on now.temple.edu.${problemsIn(couldNotRead)}`, at };
}

function eventsFailed(at: Date): NewActivityEntry {
  return {
    kind: "opportunities_read_failed",
    title: "Buddy couldn't read Temple's events",
    detail: "now.temple.edu didn't answer with its list of events, so the Guidebook stays as it was. Buddy tries again each hour.",
    at,
  };
}

function goalSearched(goal: string, pages: number, couldNotRead: string[], at: Date): NewActivityEntry {
  return { kind: "opportunity_search", title: `Buddy searched the web for your Goal: ${goal}`, detail: `Read ${pages - couldNotRead.length} of the ${pages} pages it picked.${problemsIn(couldNotRead)}`, at };
}

function goalSearchFailed(goal: string, couldNotRead: string[], at: Date): NewActivityEntry {
  return { kind: "opportunity_search_failed", title: `Buddy couldn't search the web for your Goal: ${goal}`, detail: `Buddy tries again each hour.${problemsIn(couldNotRead)}`, at };
}

function pagesReadAgain(pages: number, couldNotRead: string[], at: Date): NewActivityEntry {
  return { kind: "opportunity_pages_read_again", title: "Buddy checked Opportunities it found earlier", detail: `Read ${pages - couldNotRead.length} of ${pages} pages again.${problemsIn(couldNotRead)}`, at };
}

export function createOpportunityDiscovery(deps: OpportunityDiscoveryDeps): OpportunityDiscovery {
  const { claude, web, browserAccess, clock, store, model, logError } = deps;
  const data = store.opportunities;
  const readers = { web, browserAccess };
  const takeInDeps = { claude, store: data, model, logError };
  let readingEvents: Promise<void> | undefined;
  let searching: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const recentlyFailed = (failedAt: Date | null, now: Date) => failedAt !== null && now.getTime() - failedAt.getTime() < RETRY_AFTER_FAILURE_MS;
  /** Activity needs telling once a day rather than at every try. */
  const saidToday = (failedAt: Date | null, now: Date) => failedAt !== null && readDay(failedAt) === readDay(now);
  const logCouldNotTakeIn = (url: string, error: unknown) =>
    logError(new Error(`Discovery couldn't take in ${url}: ${error instanceof Error ? error.message : "unknown error"}`));

  /**
   * The first page shows which way the list can be read, and the rest go the same way. Without that, the
   * empty page past the list's end would look like one that needs the browser, every day.
   */
  async function readEventsList(): Promise<{ events: ListedEvent[]; cancelled: string[] } | null> {
    const understand = (html: string) => {
      const read = readEventsPage(html);
      return read.understood ? read : null;
    };
    const byFetch = await fetchPublicPage(readers, eventListPage(0), understand);
    const first = byFetch ?? (await openPublicPage(readers, eventListPage(0), understand));
    if (!first) return null;

    const byAddress = new Map(first.events.map((event) => [event.url, event]));
    const cancelled = [...first.cancelled];
    for (let index = 1; index < MOST_EVENT_LIST_PAGES; index++) {
      const page = await (byFetch ? fetchPublicPage : openPublicPage)(readers, eventListPage(index), understand);
      if (!page) break;
      for (const event of page.events) byAddress.set(event.url, event);
      cancelled.push(...page.cancelled);
    }
    return { events: [...byAddress.values()], cancelled };
  }

  /** Whether it could read the list. */
  async function readEvents(now: Date): Promise<boolean> {
    const list = await readEventsList();
    if (!list) {
      const { failedAt } = data.lastRun(EVENTS_RUN);
      data.recordRunFailed(THE_STUDENT, EVENTS_RUN, now, saidToday(failedAt, now) ? null : eventsFailed(clock.now()));
      return false;
    }
    for (const url of list.cancelled) data.removePage(url);

    const today = todayInPhiladelphia(now);
    const couldNotRead: string[] = [];
    for (const event of list.events) {
      // It's still on the list, so whatever happens to its own page, it hasn't gone from its Source.
      data.confirmSeen(event.url, now);
      if ((event.endDate ?? event.date) < today) continue;
      try {
        const page = await readPublicPage(readers, event.url, readEventPage);
        if (page) await takeInOpportunityPage(takeInDeps, { url: event.url, page, event, goal: null }, now);
        else couldNotRead.push(event.url);
      } catch (error) {
        couldNotRead.push(event.url);
        logCouldNotTakeIn(event.url, error);
      }
    }
    data.recordRunDone(THE_STUDENT, EVENTS_RUN, now, eventsRead(list.events.length, couldNotRead, clock.now()));
    return true;
  }

  /**
   * What a search found stays as long as its page says it, whatever later searches pick. So its page gets
   * read again once a week, and one that has stopped answering is left to go after two weeks. An event's
   * Source is the list, which gets read each day.
   */
  async function readSearchedPagesAgain(now: Date): Promise<void> {
    const urls = data.pagesLastSeenBefore(new Date(now.getTime() - SEARCH_EVERY_MS)).filter((url) => !isNowTempleEvent(url));
    if (urls.length === 0) return;
    const couldNotRead: string[] = [];
    for (const url of urls) {
      try {
        const page = await readPublicPage(readers, url, readWholePage);
        if (page) await takeInOpportunityPage(takeInDeps, { url, page, event: null, goal: null }, now);
        else couldNotRead.push(url);
      } catch (error) {
        couldNotRead.push(url);
        logCouldNotTakeIn(url, error);
      }
    }
    store.addActivity(THE_STUDENT, pagesReadAgain(urls.length, couldNotRead, clock.now()));
  }

  async function searchGoal(text: string, now: Date): Promise<void> {
    const key = goalKey(text);
    const failed = (pages: string[]) => {
      const { failedAt } = data.lastRun(goalRun(key));
      data.recordRunFailed(THE_STUDENT, goalRun(key), now, saidToday(failedAt, now) ? null : goalSearchFailed(text, pages, clock.now()));
    };
    let addresses: string[];
    try {
      addresses = await searchForGoal(claude, model, text, todayInPhiladelphia(now));
    } catch (error) {
      logError(new Error(`Discovery couldn't search for a Goal: ${error instanceof Error ? error.message : "unknown error"}`));
      failed([]);
      return;
    }
    const goal = { studentId: THE_STUDENT, key, text };
    const couldNotRead: string[] = [];
    for (const url of addresses) {
      try {
        const page = await readPublicPage(readers, url, readWholePage);
        if (page) await takeInOpportunityPage(takeInDeps, { url, page, event: null, goal }, now);
        else couldNotRead.push(url);
      } catch (error) {
        couldNotRead.push(url);
        logCouldNotTakeIn(url, error);
      }
    }
    // Waiting a week would be wrong if nothing it picked could be read, as when Haiku is down.
    if (addresses.length > 0 && couldNotRead.length === addresses.length) failed(couldNotRead);
    else data.recordRunDone(THE_STUDENT, goalRun(key), now, goalSearched(text, addresses.length, couldNotRead, clock.now()));
  }

  async function readEventsIfDue(): Promise<void> {
    const now = clock.now();
    const { doneAt, failedAt } = data.lastRun(EVENTS_RUN);
    if ((doneAt && readDay(doneAt) === readDay(now)) || recentlyFailed(failedAt, now)) return;
    // Only once it's clear this laptop is on the web. If it isn't, that says nothing about any page.
    if (await readEvents(now)) {
      await readSearchedPagesAgain(now);
      data.removeMissing(new Date(now.getTime() - MISSING_FOR_MS));
    }
  }

  async function searchGoalsIfDue(): Promise<void> {
    const now = clock.now();
    // A Goal said twice in other spacing is one search.
    const goals = new Map(store.roadmap.listGoals(THE_STUDENT).map((goal) => [goalKey(goal.text), goal.text]));
    for (const [key, text] of goals) {
      const { doneAt, failedAt } = data.lastRun(goalRun(key));
      const due = !doneAt || now.getTime() - doneAt.getTime() >= SEARCH_EVERY_MS;
      if (due && !recentlyFailed(failedAt, now)) await searchGoal(text, now);
    }
  }

  async function runDue(): Promise<void> {
    readingEvents ??= readEventsIfDue()
      .catch(logError)
      .finally(() => {
        readingEvents = undefined;
      });
    searching ??= searchGoalsIfDue()
      .catch(logError)
      .finally(() => {
        searching = undefined;
      });
    await Promise.all([readingEvents, searching]);
  }

  return {
    runDue,

    startSchedule(everyMs = SCHEDULE_CHECK_EVERY_MS) {
      const check = () => void runDue();
      timer = setInterval(check, everyMs);
      timer.unref();
      check();
    },

    stopSchedule() {
      clearInterval(timer);
    },
  };
}
