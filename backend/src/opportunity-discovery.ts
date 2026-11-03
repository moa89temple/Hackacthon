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
   * Does whatever has come due: today's read of now.temple.edu, and a search for each Goal that's new,
   * has changed, or was last searched a week ago. Two at once share the first one's trip. Never throws.
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

function eventsRead(listed: number, couldNotRead: string[], at: Date): NewActivityEntry {
  const problems = couldNotRead.length > 0 ? ` Couldn't read: ${couldNotRead.join(", ")}` : "";
  return { kind: "opportunities_read", title: "Buddy read Temple's events", detail: `Read ${listed - couldNotRead.length} of ${listed} events on now.temple.edu.${problems}`, at };
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
  const problems = couldNotRead.length > 0 ? ` Couldn't read: ${couldNotRead.join(", ")}` : "";
  return { kind: "opportunity_search", title: `Buddy searched the web for your Goal: ${goal}`, detail: `Read ${pages - couldNotRead.length} of the ${pages} pages it picked.${problems}`, at };
}

function goalSearchFailed(goal: string, at: Date): NewActivityEntry {
  return { kind: "opportunity_search_failed", title: `Buddy couldn't search the web for your Goal: ${goal}`, detail: "Buddy tries again each hour.", at };
}

export function createOpportunityDiscovery(deps: OpportunityDiscoveryDeps): OpportunityDiscovery {
  const { claude, web, browserAccess, clock, store, model, logError } = deps;
  const data = store.opportunities;
  const pages = { web, browserAccess };
  const takeInDeps = { claude, store: data, model, logError };
  let underWay: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const recentlyFailed = (failedAt: Date | null, now: Date) => failedAt !== null && now.getTime() - failedAt.getTime() < RETRY_AFTER_FAILURE_MS;
  /** Activity needs telling once a day rather than at every try. */
  const saidToday = (failedAt: Date | null, now: Date) => failedAt !== null && readDay(failedAt) === readDay(now);

  /**
   * The first page shows which way the list can be read, and the rest go the same way. Without that, the
   * empty page past the list's end would look like one that needs the browser, every day.
   */
  async function listedEvents(): Promise<ListedEvent[] | null> {
    const understand = (html: string) => {
      const read = readEventsPage(html);
      return read.understood ? read : null;
    };
    const byFetch = await fetchPublicPage(pages, eventListPage(0), understand);
    const first = byFetch ?? (await openPublicPage(pages, eventListPage(0), understand));
    if (!first) return null;

    const byAddress = new Map(first.events.map((event) => [event.url, event]));
    for (let index = 1; index < MOST_EVENT_LIST_PAGES; index++) {
      const page = await (byFetch ? fetchPublicPage : openPublicPage)(pages, eventListPage(index), understand);
      if (!page) break;
      for (const event of page.events) byAddress.set(event.url, event);
    }
    return [...byAddress.values()];
  }

  /** Whether it could read the list. */
  async function readEvents(now: Date): Promise<boolean> {
    const events = await listedEvents();
    if (!events) {
      const { failedAt } = data.run(EVENTS_RUN);
      data.recordRunFailed(THE_STUDENT, EVENTS_RUN, now, saidToday(failedAt, now) ? null : eventsFailed(clock.now()));
      return false;
    }
    const today = todayInPhiladelphia(now);
    const couldNotRead: string[] = [];
    for (const event of events) {
      // It's still on the list, so whatever happens to its own page, it hasn't gone from its Source.
      data.confirmPage(event.url, event.name, now, null);
      if ((event.endDate ?? event.date) < today) continue;
      try {
        const page = await readPublicPage(pages, event.url, readEventPage);
        if (page) await takeInOpportunityPage(takeInDeps, { url: event.url, page, event, goal: null }, now);
        else couldNotRead.push(event.url);
      } catch (error) {
        couldNotRead.push(event.url);
        logError(new Error(`Discovery couldn't take in ${event.url}: ${error instanceof Error ? error.message : "unknown error"}`));
      }
    }
    data.recordRunDone(THE_STUDENT, EVENTS_RUN, now, eventsRead(events.length, couldNotRead, clock.now()));
    return true;
  }

  /**
   * What a search found stays as long as its page says it, whatever later searches pick. So its page gets
   * read again once a week, and one that has stopped answering is left to go after two weeks. An event's
   * Source is the list, which gets read each day.
   */
  async function readSearchedPagesAgain(now: Date): Promise<void> {
    for (const url of data.pagesLastSeenBefore(new Date(now.getTime() - SEARCH_EVERY_MS))) {
      if (isNowTempleEvent(url)) continue;
      try {
        const page = await readPublicPage(pages, url, readWholePage);
        if (page) await takeInOpportunityPage(takeInDeps, { url, page, event: null, goal: null }, now);
      } catch (error) {
        logError(new Error(`Discovery couldn't take in ${url}: ${error instanceof Error ? error.message : "unknown error"}`));
      }
    }
  }

  async function searchGoal(text: string, now: Date): Promise<void> {
    const key = goalKey(text);
    let addresses: string[];
    try {
      addresses = await searchForGoal(claude, model, text, todayInPhiladelphia(now));
    } catch (error) {
      logError(new Error(`Discovery couldn't search for a Goal: ${error instanceof Error ? error.message : "unknown error"}`));
      const { failedAt } = data.run(goalRun(key));
      data.recordRunFailed(THE_STUDENT, goalRun(key), now, saidToday(failedAt, now) ? null : goalSearchFailed(text, clock.now()));
      return;
    }
    const goal = { studentId: THE_STUDENT, key, text };
    const couldNotRead: string[] = [];
    for (const url of addresses) {
      try {
        const page = await readPublicPage(pages, url, readWholePage);
        if (page) await takeInOpportunityPage(takeInDeps, { url, page, event: null, goal }, now);
        else couldNotRead.push(url);
      } catch (error) {
        couldNotRead.push(url);
        logError(new Error(`Discovery couldn't take in ${url}: ${error instanceof Error ? error.message : "unknown error"}`));
      }
    }
    data.recordRunDone(THE_STUDENT, goalRun(key), now, goalSearched(text, addresses.length, couldNotRead, clock.now()));
  }

  async function doWhatsDue(): Promise<void> {
    const now = clock.now();
    const events = data.run(EVENTS_RUN);
    const eventsDue = (!events.doneAt || readDay(events.doneAt) !== readDay(now)) && !recentlyFailed(events.failedAt, now);
    const listAnswered = eventsDue ? await readEvents(now) : false;

    // A Goal said twice in other spacing is one search.
    const goals = new Map(store.roadmap.listGoals(THE_STUDENT).map((goal) => [goalKey(goal.text), goal.text]));
    for (const [key, text] of goals) {
      const { doneAt, failedAt } = data.run(goalRun(key));
      const searchDue = (!doneAt || now.getTime() - doneAt.getTime() >= SEARCH_EVERY_MS) && !recentlyFailed(failedAt, now);
      if (searchDue) await searchGoal(text, now);
    }

    // Once a day, and only once it's clear this laptop is on the web. If it isn't, that says nothing about any page.
    if (listAnswered) {
      await readSearchedPagesAgain(now);
      data.removeMissing(new Date(now.getTime() - MISSING_FOR_MS));
    }
  }

  function runDue(): Promise<void> {
    underWay ??= doWhatsDue()
      .catch(logError)
      .finally(() => {
        underWay = undefined;
      });
    return underWay;
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
