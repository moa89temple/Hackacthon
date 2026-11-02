import ICAL from "ical.js";
import { PHILADELPHIA } from "./clock.ts";

const MAX_NAME_LENGTH = 200;
/**
 * Anyone can put an event on someone's calendar by inviting them, and its repeat rule can ask for
 * a meeting every second since 1990. Daily for 50 years still fits under this.
 */
const MAX_REPEATS_PER_EVENT = 20_000;
const NO_TITLE = "(No title)";

export interface EventTime {
  start: string;
  end: string;
  allDay: boolean;
  /** False when the event is set to "free" in the calendar, as most all-day events are. */
  busy: boolean;
}

/** One event or repeating series. Nothing else in the feed, such as descriptions or guests, is kept. */
export interface CalendarEvent {
  /** The calendar's own id for it, which stays the same when the event changes. */
  key: string;
  title: string;
  place: string | null;
  times: EventTime[];
}

export class NotACalendar extends Error {
  constructor() {
    super("What came back wasn't a calendar");
  }
}

/** The events with at least one moment between from and to. Soonest first, with times in order. */
export function readCalendarFeed(text: string, window: { from: Date; to: Date }): CalendarEvent[] {
  const parts = groupByEvent(parseCalendar(text));
  const events = [...parts.entries()].flatMap(([key, components]): CalendarEvent[] => {
    try {
      const event = readEvent(key, components, window);
      return event.times.length > 0 ? [event] : [];
    } catch {
      // One event a stranger sent shouldn't cost the Student the rest of their calendar.
      return [];
    }
  });
  return events.sort((a, b) => a.times[0]!.start.localeCompare(b.times[0]!.start));
}

function parseCalendar(text: string): ICAL.Component {
  let parsed: ReturnType<typeof ICAL.parse>;
  try {
    parsed = ICAL.parse(text);
  } catch {
    throw new NotACalendar();
  }
  const root = new ICAL.Component(parsed as unknown as any[]);
  if (root.name !== "vcalendar") throw new NotACalendar();
  return root;
}

function groupByEvent(root: ICAL.Component): Map<string, ICAL.Component[]> {
  const parts = new Map<string, ICAL.Component[]>();
  root.getAllSubcomponents("vevent").forEach((component, index) => {
    const uid = component.getFirstPropertyValue("uid");
    const key = typeof uid === "string" && uid ? uid : `no-id-${index}`;
    parts.set(key, [...(parts.get(key) ?? []), component]);
  });
  return parts;
}

function readEvent(key: string, components: ICAL.Component[], window: { from: Date; to: Date }): CalendarEvent {
  const series = components.find((component) => !component.hasProperty("recurrence-id"));
  const changed = components.filter((component) => component !== series);
  const named = series ?? changed[0]!;

  const times = [
    ...(series ? timesOfSeries(series, changed, window) : []),
    ...changed.flatMap((component) => meetingsOf(component)(new ICAL.Event(component).startDate)),
  ]
    .filter((time) => new Date(time.end) > window.from && new Date(time.start) < window.to)
    .sort((a, b) => a.start.localeCompare(b.start));

  return {
    key,
    title: shortText(named.getFirstPropertyValue("summary")) ?? NO_TITLE,
    place: shortText(named.getFirstPropertyValue("location")),
    times,
  };
}

/** The series' own meetings. A changed meeting replaces the one it came from, and lists itself. */
function timesOfSeries(series: ICAL.Component, changed: ICAL.Component[], window: { to: Date }): EventTime[] {
  const event = new ICAL.Event(series);
  const meeting = meetingsOf(series);
  if (!event.isRecurring()) return meeting(event.startDate);

  const zone = zoneOf(series.getFirstProperty("dtstart"));
  // By the moment, because a feed can name the same meeting in a different zone from the series.
  const replacedOrRemoved = new Set(
    [
      ...changed.map((component) => component.getFirstProperty("recurrence-id")!),
      ...series.getAllProperties("exdate"),
    ].flatMap((property) =>
      property
        .getValues()
        .map((time) => toMoment(time as unknown as ICAL.Time, zoneOf(property)).getTime()),
    ),
  );

  const times: EventTime[] = [];
  const iterator = event.iterator();
  for (let repeat = 0; repeat < MAX_REPEATS_PER_EVENT; repeat++) {
    const start = iterator.next();
    if (!start) break;
    const moment = toMoment(start, zone);
    if (moment >= window.to) break;
    if (!replacedOrRemoved.has(moment.getTime())) times.push(...meeting(start));
  }
  return times;
}

/**
 * Works out what every meeting of this event shares, once, and returns what makes one from its
 * start. A cancelled one has no meetings.
 */
function meetingsOf(component: ICAL.Component): (start: ICAL.Time) => EventTime[] {
  if (component.getFirstPropertyValue("status") === "CANCELLED") return () => [];
  const event = new ICAL.Event(component);
  const zone = zoneOf(component.getFirstProperty("dtstart"));
  const busy = component.getFirstPropertyValue("transp") !== "TRANSPARENT";
  const length = lengthOf(component, event);

  return (start) => {
    const startMoment = toMoment(start, zone);
    if (!start.isDate) {
      return [
        {
          start: startMoment.toISOString(),
          end: new Date(startMoment.getTime() + length).toISOString(),
          allDay: false,
          busy,
        },
      ];
    }
    // All-day events go by the calendar, because a day isn't always 24 hours long.
    const end = start.clone();
    end.addDuration(event.duration);
    // A date-only event with no end has a duration of nothing, but the rules give it the whole day.
    if (end.compare(start) <= 0) end.day += 1;
    return [{ start: startMoment.toISOString(), end: toMoment(end, zone).toISOString(), allDay: true, busy }];
  };
}

/** Each end of the event is read in its own zone, because the two can differ. */
function lengthOf(component: ICAL.Component, event: ICAL.Event): number {
  const dtstart = component.getFirstProperty("dtstart")!;
  const dtend = component.getFirstProperty("dtend");
  if (!dtend) return event.duration.toSeconds() * 1000;
  const length =
    toMoment(dtend.getFirstValue() as ICAL.Time, zoneOf(dtend)).getTime() -
    toMoment(dtstart.getFirstValue() as ICAL.Time, zoneOf(dtstart)).getTime();
  return Math.max(length, 0);
}

function shortText(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim().slice(0, MAX_NAME_LENGTH);
}

/** The zone named on this time, or Philadelphia when none is named or it isn't a real one. */
function zoneOf(property: ICAL.Property | null): string {
  const named = property?.getParameter("tzid");
  return typeof named === "string" && isKnownZone(named) ? named : PHILADELPHIA;
}

function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The moment it's this hour on this date on Philadelphia's clock. */
export function wallClockInPhiladelphia(year: number, month: number, day: number, hour: number): number {
  return wallClockToMoment(Date.UTC(year, month - 1, day, hour), PHILADELPHIA).getTime();
}

/**
 * Goes by the wall-clock time and the zone's name, rather than the rules in the feed or this
 * laptop's own time zone, so that it comes out the same wherever it runs, and a repeating class
 * stays at 10:00 when the clocks change.
 */
function toMoment(time: ICAL.Time, zone: string): Date {
  const wallClock = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  if (time.zone === ICAL.Timezone.utcTimezone) return new Date(wallClock);
  return wallClockToMoment(wallClock, zone);
}

function wallClockToMoment(wallClock: number, zone: string): Date {
  // The offset can differ between the guess and the real moment, close to a clock change.
  const guess = wallClock - offsetAt(wallClock, zone);
  return new Date(wallClock - offsetAt(guess, zone));
}

/** How far ahead of UTC this zone's clocks are at this moment. */
function offsetAt(moment: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(moment)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asIfUtc - (moment - (moment % 1000));
}
