import { isTimeOfDay, latestScheduled, nextScheduled, plusDays, type BriefingKind, type BriefingTimes } from "./briefing-schedule.ts";
import type { BriefingContents, StoredBriefing } from "./briefing-store.ts";
import { PHILADELPHIA, todayInPhiladelphia, type Clock } from "./clock.ts";
import type { Connections, ConnectionType } from "./connections.ts";
import type { GuidebookSource } from "./guidebook.ts";
import type { Notifier, PhoneNotification } from "./notifier.ts";
import type { Opportunities, Opportunity } from "./opportunities.ts";
import type { Roadmap } from "./roadmap.ts";
import type { StandardMilestones } from "./standard-milestones.ts";
import { THE_STUDENT, type NewActivityEntry, type Store } from "./store.ts";

const DAY_MS = 24 * 3_600_000;
const SCHEDULE_CHECK_EVERY_MS = 60_000;
const NEWS_SHOWN_FROM_EACH_CONNECTION = 3;
/** How far ahead each one looks, and how much it holds, so that a weekday's stays short. */
const LOOKS_AHEAD_DAYS: Record<BriefingKind, number> = { weekday: 3, week_ahead: 7 };
const MOST_OF_EACH: Record<BriefingKind, number> = { weekday: 3, week_ahead: 6 };
/** For the first Briefing there is, which has no earlier one to count from. */
const FIRST_NEWS_LOOKS_BACK_MS = 7 * DAY_MS;
const TITLES: Record<BriefingKind, string> = { weekday: "Your Briefing", week_ahead: "Your week ahead" };
const NAMES: Record<BriefingKind, string> = { weekday: "your Briefing", week_ahead: "your week-ahead Briefing" };

/** So that an old notification waiting for the phone gives way to a new one. */
const REPLACES = "briefing";
const BRIEFING_DATA = { type: "briefing" };

/** A Milestone as a Briefing shows it, whichever list it's from. */
export interface BriefingMilestone {
  id: number;
  /** Tells apart a Roadmap Milestone and a Standard Milestone with the same id. */
  key: string;
  name: string;
  term: string | null;
  when: string;
  passed: boolean;
  sources: GuidebookSource[];
  /** What to say in place of a Source, when there's none and why. */
  sourceNote: string | null;
  /** The Goal it belongs to, if any. */
  goal: string | null;
}

export interface BriefingNews {
  id: number;
  connection: string;
  text: string;
  at: string;
}

export interface ShownBriefing {
  id: number;
  kind: BriefingKind;
  title: string;
  madeAt: string;
  /** When Buddy made it, in words on Philadelphia's clock. */
  when: string;
  milestones: BriefingMilestone[];
  opportunities: Opportunity[];
  news: BriefingNews[];
  /** How much more each Connection has than is shown. */
  moreNews: { connection: string; count: number }[];
  /** Nothing was relevant when Buddy looked, so no notification went. */
  hadNothing: boolean;
}

export interface BriefingSettings {
  times: BriefingTimes;
  next: { kind: BriefingKind; at: string; when: string };
  phoneNotifications: { on: boolean; offBecause: string | null };
}

/** The Student's words for a time can't be used. The message is for the Student. */
export class BadBriefingTime extends Error {
  constructor() {
    super("Each time must be a time of day, such as 08:00");
  }
}

export class BadPushToken extends Error {
  constructor() {
    super("That isn't a push token");
  }
}

export interface Briefings {
  /**
   * Does what has come due: makes the latest Briefing, if a time has passed since the last one, and sends it
   * to any phone that hasn't had it. Times missed before the latest are dropped. Two calls at once share a trip. Never throws.
   */
  runDue(): Promise<void>;
  /** Calls runDue from now on. The timer stops when the backend closes. */
  startSchedule(everyMs?: number): void;
  stopSchedule(): void;
  /** The newest Briefing, with each thing in it as it is now. Null until there's been one. */
  latest(): ShownBriefing | null;
  settings(): BriefingSettings;
  /** Throws BadBriefingTime. A time that's already passed today doesn't send anything. */
  changeTimes(input: { weekdays?: unknown; sunday?: unknown }): BriefingSettings;
  /** Throws BadPushToken. */
  savePushToken(deviceKeyHash: string, token: unknown): void;
}

export interface BriefingsDeps {
  store: Store;
  clock: Clock;
  notifier: Notifier;
  milestones: StandardMilestones;
  roadmap: Pick<Roadmap, "milestones">;
  opportunities: Opportunities;
  connections: Pick<Connections, "events">;
  connectionTypes: Pick<ConnectionType, "id" | "name">[];
  logError: (error: unknown) => void;
}

/** Such as "Wednesday, November 4 at 8:00 AM", on Philadelphia's clock. */
function momentInWords(moment: Date): string {
  const date = new Intl.DateTimeFormat("en-US", { timeZone: PHILADELPHIA, weekday: "long", month: "long", day: "numeric" }).format(moment);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: PHILADELPHIA, hour: "numeric", minute: "2-digit" }).format(moment);
  return `${date} at ${time}`.replaceAll(" ", " ");
}

function timeInWords(time: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" })
    .format(new Date(`2026-01-01T${time}:00Z`))
    .replaceAll(" ", " ");
}

const counted = (count: number, one: string, many: string) => (count === 0 ? [] : [`${count} ${count === 1 ? one : many}`]);

/**
 * Only how many of what, because these words go to Firebase, which is outside Buddy. No names, grades,
 * balances or email. Null when there's nothing to say, so that a phone never gets a notification saying so.
 */
function notificationBody({ standardMilestoneIds, roadmapMilestoneIds, opportunityIds, connectionEventIds }: BriefingContents): string | null {
  const parts = [
    ...counted(standardMilestoneIds.length + roadmapMilestoneIds.length, "Milestone", "Milestones"),
    ...counted(opportunityIds.length, "Opportunity", "Opportunities"),
    ...counted(connectionEventIds.length, "thing new in your Connections", "things new in your Connections"),
  ];
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  return `${parts.length > 0 ? `${parts.join(", ")} and ${last}` : last}.`;
}

function briefingMade(briefing: { kind: BriefingKind; body: string | null }, at: Date): NewActivityEntry {
  return briefing.body
    ? { kind: "briefing_made", title: `Buddy made ${NAMES[briefing.kind]}`, detail: `${briefing.body} It's on your Today tab.`, at }
    : { kind: "briefing_empty", title: `Buddy had nothing for ${NAMES[briefing.kind]}`, detail: "Nothing was relevant when it looked, so it sent no phone notification.", at };
}

function briefingSent({ kind, title, body }: StoredBriefing, at: Date): NewActivityEntry {
  return { kind: "briefing_sent", title: `Buddy sent ${NAMES[kind]} to your phone`, detail: `Through Firebase Cloud Messaging, Google's notification service, in these words: ${title}. ${body}`, at };
}

function briefingFailed({ kind }: StoredBriefing, problem: string, at: Date): NewActivityEntry {
  return { kind: "briefing_send_failed", title: `Buddy couldn't send ${NAMES[kind]} to your phone yet`, detail: `It's on your Today tab, and Buddy keeps trying until the next one. ${problem}`, at };
}

function timesChanged({ weekdays, sunday }: BriefingTimes, at: Date): NewActivityEntry {
  return { kind: "briefing_times_changed", title: "You changed your Briefing times", detail: `Weekdays at ${timeInWords(weekdays)} and Sundays at ${timeInWords(sunday)}, Philadelphia time.`, at };
}

export function createBriefings(deps: BriefingsDeps): Briefings {
  const { store, clock, notifier, milestones, roadmap, opportunities, connections, connectionTypes, logError } = deps;
  const data = store.briefings;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const allEvents = () => connectionTypes.flatMap((type) => connections.events(type.id).map((event) => ({ ...event, connectionName: type.name })));

  /** Milestones coming up, soonest first, from the Roadmap and the Standard Milestones, with none twice. */
  function milestonesComingUp(kind: BriefingKind, isSoon: (date: string, endDate?: string | null) => boolean): Pick<BriefingContents, "standardMilestoneIds" | "roadmapMilestoneIds"> {
    const onRoadmap = roadmap.milestones();
    const sameAs = (name: string, dueDate: string) => (other: { name: string; dueDate: string }) => other.name === name && other.dueDate === dueDate;
    const fromRoadmap = onRoadmap.filter(({ done, goneFromSource, dueDate }) => !done && !goneFromSource && isSoon(dueDate)).map(({ id, dueDate }) => ({ id, date: dueDate, list: "roadmap" as const }));
    const stillToShow = (name: string, dueDate: string) => {
      const copy = onRoadmap.find(sameAs(name, dueDate));
      // What's done stays out. What's on the Roadmap but not due yet can still come up by its first day.
      return !copy || (!copy.done && !isSoon(copy.dueDate));
    };
    const standard = milestones
      .upcoming()
      .filter(({ name, date, endDate }) => isSoon(date, endDate) && stillToShow(name, endDate ?? date))
      .map(({ id, date }) => ({ id, date, list: "standard" as const }));
    const chosen = [...fromRoadmap, ...standard].toSorted((a, b) => a.date.localeCompare(b.date)).slice(0, MOST_OF_EACH[kind]);
    return {
      standardMilestoneIds: chosen.filter(({ list }) => list === "standard").map(({ id }) => id),
      roadmapMilestoneIds: chosen.filter(({ list }) => list === "roadmap").map(({ id }) => id),
    };
  }

  /** What the Student saved, then what's for their Goals. Opportunities open to any Student come only in the week-ahead Briefing. */
  function opportunitiesComingUp(kind: BriefingKind, isSoon: (date: string, endDate?: string | null) => boolean): number[] {
    const rank = ({ saved, forGoals }: Opportunity) => (saved ? 0 : forGoals.length > 0 ? 1 : 2);
    return opportunities
      .list()
      .filter((opportunity) => isSoon(opportunity.date, opportunity.endDate) && (kind === "week_ahead" || rank(opportunity) < 2))
      .toSorted((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date))
      .slice(0, MOST_OF_EACH[kind])
      .map(({ id }) => id);
  }

  function collect(kind: BriefingKind, now: Date): BriefingContents {
    const today = todayInPhiladelphia(now);
    const lastDay = plusDays(today, LOOKS_AHEAD_DAYS[kind]);
    const inWindow = (day: string) => day >= today && day <= lastDay;
    const isSoon = (date: string, endDate?: string | null) => inWindow(date) || (endDate ? inWindow(endDate) : false);
    const since = data.latest(THE_STUDENT)?.madeAt ?? new Date(now.getTime() - FIRST_NEWS_LOOKS_BACK_MS);
    return {
      ...milestonesComingUp(kind, isSoon),
      opportunityIds: opportunitiesComingUp(kind, isSoon),
      connectionEventIds: allEvents().filter(({ at }) => at > since).map(({ id }) => id),
    };
  }

  function makeLatest(now: Date): void {
    const handledUpTo = data.handledUpTo(THE_STUDENT);
    // The first time Buddy runs, it has no record of having missed anything.
    if (!handledUpTo) {
      data.startSchedule(THE_STUDENT, now);
      return;
    }
    const due = latestScheduled(now, data.times(THE_STUDENT));
    if (due.at <= handledUpTo) return;
    const contents = collect(due.kind, now);
    const briefing = { kind: due.kind, madeAt: now, contents, title: TITLES[due.kind], body: notificationBody(contents) };
    data.addBriefing(THE_STUDENT, briefing, due.at, briefingMade(briefing, clock.now()));
  }

  async function sendLatest(): Promise<void> {
    if (notifier.offBecause) return;
    const briefing = data.latest(THE_STUDENT);
    if (!briefing?.body) return;
    const notification: PhoneNotification = { title: briefing.title, body: briefing.body, data: BRIEFING_DATA, replaces: REPLACES };
    let { toldFailed } = briefing;
    for (const { token, lastBriefingId } of data.pushTokens(THE_STUDENT)) {
      if (lastBriefingId >= briefing.id) continue;
      const sent = await notifier.send(token, notification);
      if (sent.outcome === "sent") {
        // Each phone's, with its Activity entry, because each is something else that left for Firebase.
        data.markTokenSent(THE_STUDENT, token, briefing.id, briefingSent(briefing, clock.now()));
      } else if (sent.outcome === "token_gone") {
        data.deleteToken(token);
      } else if (!toldFailed) {
        // Once for each Briefing, however many minutes it goes on failing.
        logError(new Error(`Buddy couldn't send a Briefing to the phone: ${sent.problem}`));
        data.noteFailed(THE_STUDENT, briefing.id, briefingFailed(briefing, sent.problem, clock.now()));
        toldFailed = true;
      }
    }
  }

  async function runDue(): Promise<void> {
    running ??= (async () => {
      makeLatest(clock.now());
      await sendLatest();
    })()
      .catch(logError)
      .finally(() => {
        running = undefined;
      });
    await running;
  }

  /** Each thing as it is now, in the order it'll read. What's gone or passed since drops out. */
  function shownMilestones({ standardMilestoneIds, roadmapMilestoneIds }: BriefingContents): BriefingMilestone[] {
    const today = todayInPhiladelphia(clock.now());
    const standard = milestones
      .withIds(standardMilestoneIds)
      .filter(({ passed }) => !passed)
      .map((milestone) => ({
        sortBy: milestone.date,
        shown: { id: milestone.id, key: `standard ${milestone.id}`, name: milestone.name, term: milestone.term, when: milestone.when, passed: false, sources: milestone.sources, sourceNote: null, goal: null },
      }));
    const onRoadmap = roadmap
      .milestones()
      .filter(({ id, done, dueDate }) => roadmapMilestoneIds.includes(id) && !done && dueDate >= today)
      .map((milestone) => ({
        sortBy: milestone.dueDate,
        shown: { id: milestone.id, key: `roadmap ${milestone.id}`, name: milestone.name, term: milestone.detail, when: milestone.when, passed: false, sources: milestone.sources, sourceNote: milestone.sourceNote, goal: milestone.goal?.text ?? null },
      }));
    return [...standard, ...onRoadmap].toSorted((a, b) => a.sortBy.localeCompare(b.sortBy)).map(({ shown }) => shown);
  }

  function shownNews({ connectionEventIds }: BriefingContents): Pick<ShownBriefing, "news" | "moreNews"> {
    const events = allEvents().filter(({ id }) => connectionEventIds.includes(id));
    const news: BriefingNews[] = [];
    const moreNews: ShownBriefing["moreNews"] = [];
    for (const { name } of connectionTypes) {
      const fromThis = events.filter(({ connectionName }) => connectionName === name).toReversed();
      news.push(...fromThis.slice(0, NEWS_SHOWN_FROM_EACH_CONNECTION).map(({ id, text, at }) => ({ id, connection: name, text, at: at.toISOString() })));
      const more = fromThis.length - NEWS_SHOWN_FROM_EACH_CONNECTION;
      if (more > 0) moreNews.push({ connection: name, count: more });
    }
    return { news, moreNews };
  }

  function settings(): BriefingSettings {
    const times = data.times(THE_STUDENT);
    const next = nextScheduled(clock.now(), times);
    return {
      times,
      next: { kind: next.kind, at: next.at.toISOString(), when: momentInWords(next.at) },
      phoneNotifications: { on: notifier.offBecause === null, offBecause: notifier.offBecause },
    };
  }

  return {
    runDue,
    settings,

    startSchedule(everyMs = SCHEDULE_CHECK_EVERY_MS) {
      const check = () => void runDue();
      timer = setInterval(check, everyMs);
      timer.unref();
      check();
    },

    stopSchedule() {
      clearInterval(timer);
    },

    latest() {
      const briefing = data.latest(THE_STUDENT);
      if (!briefing) return null;
      const { contents } = briefing;
      return {
        id: briefing.id,
        kind: briefing.kind,
        title: briefing.title,
        madeAt: briefing.madeAt.toISOString(),
        when: momentInWords(briefing.madeAt),
        milestones: shownMilestones(contents),
        opportunities: opportunities.withIds(contents.opportunityIds),
        ...shownNews(contents),
        hadNothing: briefing.body === null,
      };
    },

    changeTimes({ weekdays, sunday }) {
      if (!isTimeOfDay(weekdays) || !isTimeOfDay(sunday)) throw new BadBriefingTime();
      const was = data.times(THE_STUDENT);
      if (was.weekdays !== weekdays || was.sunday !== sunday) {
        const now = clock.now();
        // One that came due since the timer last looked still counts, before counting from now.
        makeLatest(now);
        data.saveTimes(THE_STUDENT, { weekdays, sunday }, now, timesChanged({ weekdays, sunday }, now));
      }
      return settings();
    },

    savePushToken(deviceKeyHash, token) {
      if (typeof token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(token)) throw new BadPushToken();
      data.savePushToken(THE_STUDENT, deviceKeyHash, token);
    },
  };
}
