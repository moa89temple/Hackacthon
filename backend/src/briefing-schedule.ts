import { PHILADELPHIA, todayInPhiladelphia } from "./clock.ts";

/** Times of day on Philadelphia's clock, as HH:MM. */
export interface BriefingTimes {
  weekdays: string;
  sunday: string;
}

export type BriefingKind = "weekday" | "week_ahead";

export interface ScheduledBriefing {
  kind: BriefingKind;
  at: Date;
}

export const USUAL_BRIEFING_TIMES: BriefingTimes = { weekdays: "08:00", sunday: "18:00" };

const DAY_MS = 24 * 3_600_000;
const SUNDAY = 0;
const SATURDAY = 6;
/** Every week has a Briefing, so this always finds one. */
const DAYS_TO_LOOK = 8;

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_OF_DAY.test(value);
}

/** What Philadelphia's clock says at this moment, written as if it were UTC, so that two can be compared. */
function clockReading(moment: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PHILADELPHIA,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(moment));
  const part = (type: string) => Number(parts.find((candidate) => candidate.type === type)!.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}

/**
 * The moment Philadelphia's clock says this. A time the clocks repeat means the first of the two. A time
 * they skip means as long after the skip as it would have been, so a Briefing never goes missing.
 */
function philadelphiaMoment(day: string, time: string): Date {
  const wanted = Date.parse(`${day}T${time}:00Z`);
  const offsetAround = (moment: number) => clockReading(moment) - moment;
  const before = wanted - offsetAround(wanted - DAY_MS);
  const after = wanted - offsetAround(wanted + DAY_MS);
  const fits = [before, after].filter((moment) => clockReading(moment) === wanted);
  return new Date(fits.length > 0 ? Math.min(...fits) : before);
}

/** The Briefing this Philadelphia day has, if any. */
function onDay(day: string, times: BriefingTimes): ScheduledBriefing | null {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === SATURDAY) return null;
  return weekday === SUNDAY
    ? { kind: "week_ahead", at: philadelphiaMoment(day, times.sunday) }
    : { kind: "weekday", at: philadelphiaMoment(day, times.weekdays) };
}

/** Each Philadelphia day's Briefing, from this moment's day onward or backward. */
function* briefingsFrom(now: Date, direction: 1 | -1, times: BriefingTimes): Generator<ScheduledBriefing> {
  const today = Date.parse(`${todayInPhiladelphia(now)}T12:00:00Z`);
  for (let days = 0; days < DAYS_TO_LOOK; days++) {
    const briefing = onDay(new Date(today + direction * days * DAY_MS).toISOString().slice(0, 10), times);
    if (briefing) yield briefing;
  }
}

/** The last time a Briefing was due, at or before this moment. Missed ones before it don't count. */
export function latestScheduled(now: Date, times: BriefingTimes): ScheduledBriefing {
  for (const briefing of briefingsFrom(now, -1, times)) {
    if (briefing.at <= now) return briefing;
  }
  throw new Error("Every week has a Briefing");
}

/** The first time a Briefing is due, after this moment. */
export function nextScheduled(now: Date, times: BriefingTimes): ScheduledBriefing {
  for (const briefing of briefingsFrom(now, 1, times)) {
    if (briefing.at > now) return briefing;
  }
  throw new Error("Every week has a Briefing");
}
