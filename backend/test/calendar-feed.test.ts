import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NotACalendar, readCalendarFeed } from "../src/calendar-feed.ts";

const saved = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

// A Monday morning in Philadelphia, the day after the clocks went back.
const from = new Date("2026-11-02T14:00:00Z");
const to = new Date("2026-11-16T14:00:00Z");

const studentEvents = () => readCalendarFeed(saved("student-calendar.ics"), { from, to });
const eventCalled = (title: string) => studentEvents().find((event) => event.title === title);
const startsOf = (title: string) => eventCalled(title)?.times.map((time) => time.start);

function calendar(...events: string[][]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap((lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
const oneEvent = (...lines: string[]) => calendar(lines);

describe("which events it keeps", () => {
  it("keeps what overlaps the window, soonest first, and nothing over, cancelled or too far off", () => {
    expect(studentEvents().map((event) => event.title)).toEqual([
      "BIO 1111 lecture",
      "Shift at CVS",
      "Call with my cousin in LA",
      "Optional study group",
      "Mom's birthday",
      "Reunión con mi asesora sobre el plan de estudios para la primavera de 2027, con café",
      "Trip to New York",
    ]);
  });

  it("keeps an event still going when the window opens", () => {
    const feed = oneEvent("UID:a@google.com", "SUMMARY:Long shift", "DTSTART:20261102T130000Z", "DTEND:20261102T150000Z");

    expect(readCalendarFeed(feed, { from, to })[0]?.times[0]?.end).toBe("2026-11-02T15:00:00.000Z");
  });

  it("drops an event that ended just as the window opened", () => {
    const feed = oneEvent("UID:a@google.com", "DTSTART:20261102T130000Z", "DTEND:20261102T140000Z");

    expect(readCalendarFeed(feed, { from, to })).toEqual([]);
  });

  it("gives an event with no name a name, so it still counts", () => {
    const feed = oneEvent("UID:a@google.com", "DTSTART:20261103T150000Z", "DTEND:20261103T160000Z");

    expect(readCalendarFeed(feed, { from, to })[0]?.title).toBe("(No title)");
  });

  it("cuts an absurdly long name or place down to size", () => {
    const feed = oneEvent(
      "UID:a@google.com",
      `SUMMARY:${"x".repeat(5000)}`,
      `LOCATION:${"y".repeat(5000)}`,
      "DTSTART:20261103T150000Z",
      "DTEND:20261103T160000Z",
    );

    const [event] = readCalendarFeed(feed, { from, to });
    expect(event!.title.length).toBeLessThanOrEqual(200);
    expect(event!.place!.length).toBeLessThanOrEqual(200);
  });

  it("keeps only the name, the place and the times, whatever else the feed holds", () => {
    expect(JSON.stringify(studentEvents())).not.toMatch(/lab notebook|classmate/);
    expect(Object.keys(eventCalled("BIO 1111 lecture")!).sort()).toEqual(["key", "place", "times", "title"]);
  });

  it("reads the place, undoing the feed's escaping", () => {
    expect(eventCalled("BIO 1111 lecture")?.place).toBe("Beury Hall 160, Philadelphia");
    expect(eventCalled("Shift at CVS")?.place).toBeNull();
  });
});

describe("times", () => {
  it("turns each time zone in the feed into the right moment", () => {
    expect(eventCalled("Shift at CVS")?.times[0]).toMatchObject({
      start: "2026-11-03T19:00:00.000Z",
      end: "2026-11-03T22:00:00.000Z",
    });
    // Its zone is named, but only New York's rules are in the feed.
    expect(eventCalled("Call with my cousin in LA")?.times[0]).toMatchObject({
      start: "2026-11-04T17:00:00.000Z",
      end: "2026-11-04T17:30:00.000Z",
    });
  });

  it("treats an unknown zone or no zone as Philadelphia time", () => {
    const unknownZone = oneEvent(
      "UID:a@google.com",
      "DTSTART;TZID=Eastern Standard Time:20261103T100000",
      "DTEND;TZID=Eastern Standard Time:20261103T110000",
    );
    const noZone = oneEvent("UID:b@google.com", "DTSTART:20261103T100000", "DTEND:20261103T110000");

    expect(readCalendarFeed(unknownZone, { from, to })[0]?.times[0]?.start).toBe("2026-11-03T15:00:00.000Z");
    expect(readCalendarFeed(noZone, { from, to })[0]?.times[0]?.start).toBe("2026-11-03T15:00:00.000Z");
  });

  it("marks an event set to free as not busy", () => {
    expect(eventCalled("Optional study group")?.times[0]?.busy).toBe(false);
    expect(eventCalled("Shift at CVS")?.times[0]?.busy).toBe(true);
  });

  it("runs an all-day event from midnight to midnight in Philadelphia", () => {
    expect(eventCalled("Mom's birthday")?.times).toEqual([
      { start: "2026-11-07T05:00:00.000Z", end: "2026-11-08T05:00:00.000Z", allDay: true, busy: false },
    ]);
    expect(eventCalled("Trip to New York")?.times).toEqual([
      { start: "2026-11-14T05:00:00.000Z", end: "2026-11-16T05:00:00.000Z", allDay: true, busy: true },
    ]);
  });

  it("gives an all-day event with no end one day", () => {
    const feed = oneEvent("UID:a@google.com", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261105");

    expect(readCalendarFeed(feed, { from, to })[0]?.times[0]).toMatchObject({
      start: "2026-11-05T05:00:00.000Z",
      end: "2026-11-06T05:00:00.000Z",
    });
  });

  it("works out the end in the end's own zone, when it differs from the start's", () => {
    const feed = oneEvent(
      "UID:a@google.com",
      "DTSTART;TZID=America/New_York:20261103T100000",
      "DTEND;TZID=America/Los_Angeles:20261103T130000",
    );

    expect(readCalendarFeed(feed, { from, to })[0]?.times[0]).toMatchObject({
      start: "2026-11-03T15:00:00.000Z",
      end: "2026-11-03T21:00:00.000Z",
    });
  });

  it("gives a timed event with a duration instead of an end its proper end", () => {
    const feed = oneEvent("UID:a@google.com", "DTSTART:20261103T150000Z", "DURATION:PT90M");

    expect(readCalendarFeed(feed, { from, to })[0]?.times[0]?.end).toBe("2026-11-03T16:30:00.000Z");
  });
});

describe("repeating events", () => {
  it("lists each meeting in the window, skipping removed and cancelled ones and moving moved ones", () => {
    expect(startsOf("BIO 1111 lecture")).toEqual([
      "2026-11-03T15:00:00.000Z",
      // November 5 was removed from the series.
      "2026-11-10T16:00:00.000Z", // moved from 10:00 to 11:00
      // November 12 was cancelled.
    ]);
  });

  const tuesdaysAtTen = [
    "UID:a@google.com",
    "SUMMARY:Tuesdays",
    "DTSTART;TZID=America/New_York:20261103T100000",
    "DTEND;TZID=America/New_York:20261103T105000",
    "RRULE:FREQ=WEEKLY;COUNT=2",
  ];

  it("removes a meeting whose removal is written in another zone", () => {
    const feed = oneEvent(...tuesdaysAtTen, "EXDATE:20261103T150000Z");

    expect(readCalendarFeed(feed, { from, to })[0]?.times.map((time) => time.start)).toEqual([
      "2026-11-10T15:00:00.000Z",
    ]);
  });

  it("removes every meeting named on one line", () => {
    const feed = oneEvent(...tuesdaysAtTen, "EXDATE;TZID=America/New_York:20261103T100000,20261110T100000");

    expect(readCalendarFeed(feed, { from, to })).toEqual([]);
  });

  it("replaces a meeting whose change is written in another zone, rather than keeping both", () => {
    const feed = calendar(tuesdaysAtTen, [
      "UID:a@google.com",
      "SUMMARY:Tuesdays",
      "RECURRENCE-ID:20261103T150000Z",
      "DTSTART;TZID=America/New_York:20261103T110000",
      "DTEND;TZID=America/New_York:20261103T115000",
    ]);

    expect(readCalendarFeed(feed, { from, to })[0]?.times.map((time) => time.start)).toEqual([
      "2026-11-03T16:00:00.000Z",
      "2026-11-10T15:00:00.000Z",
    ]);
  });

  it("keeps a class at the same local time after the clocks change", () => {
    const feed = oneEvent(
      "UID:a@google.com",
      "DTSTART;TZID=America/New_York:20260901T100000",
      "DTEND;TZID=America/New_York:20260901T105000",
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
    );

    const before = readCalendarFeed(feed, {
      from: new Date("2026-10-26T00:00:00Z"),
      to: new Date("2026-10-30T00:00:00Z"),
    });
    const after = readCalendarFeed(feed, { from, to: new Date("2026-11-06T00:00:00Z") });

    expect(before[0]?.times[0]?.start).toBe("2026-10-27T14:00:00.000Z");
    expect(after[0]?.times[0]?.start).toBe("2026-11-03T15:00:00.000Z");
  });

  it("lists a meeting moved into the window from outside it", () => {
    const feed = calendar(
      ["UID:a@google.com", "SUMMARY:Monthly", "DTSTART:20261001T150000Z", "DTEND:20261001T160000Z", "RRULE:FREQ=MONTHLY"],
      [
        "UID:a@google.com",
        "SUMMARY:Monthly",
        "RECURRENCE-ID:20261201T150000Z",
        "DTSTART:20261110T150000Z",
        "DTEND:20261110T160000Z",
      ],
    );

    expect(readCalendarFeed(feed, { from, to })[0]?.times.map((time) => time.start)).toEqual([
      "2026-11-10T15:00:00.000Z",
    ]);
  });

  it("drops a meeting moved out of the window", () => {
    const feed = calendar(
      ["UID:a@google.com", "SUMMARY:Weekly", "DTSTART:20261103T150000Z", "DTEND:20261103T160000Z", "RRULE:FREQ=WEEKLY;COUNT=1"],
      [
        "UID:a@google.com",
        "SUMMARY:Weekly",
        "RECURRENCE-ID:20261103T150000Z",
        "DTSTART:20261203T150000Z",
        "DTEND:20261203T160000Z",
      ],
    );

    expect(readCalendarFeed(feed, { from, to })).toEqual([]);
  });

  it("keeps a single changed meeting whose series isn't in the feed", () => {
    const feed = oneEvent(
      "UID:a@google.com",
      "SUMMARY:One meeting I was invited to",
      "RECURRENCE-ID:20261103T150000Z",
      "DTSTART:20261103T160000Z",
      "DTEND:20261103T170000Z",
    );

    expect(readCalendarFeed(feed, { from, to })[0]?.times[0]?.start).toBe("2026-11-03T16:00:00.000Z");
  });

  it("gives up on a rule that would repeat forever at a silly rate, and still finishes", () => {
    const feed = oneEvent(
      "UID:a@google.com",
      "SUMMARY:Sent by a stranger",
      "DTSTART:19900101T000000Z",
      "DTEND:19900101T000001Z",
      "RRULE:FREQ=SECONDLY",
    );

    expect(readCalendarFeed(feed, { from, to })).toEqual([]);
  });
});

describe("what isn't a calendar", () => {
  it.each([
    ["an HTML page", "<!DOCTYPE html><html><body>Sign in</body></html>"],
    ["nothing", ""],
    ["another kind of file", "BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD\r\n"],
  ])("refuses %s", (_, text) => {
    expect(() => readCalendarFeed(text, { from, to })).toThrow(NotACalendar);
  });

  it("skips one broken event and keeps the rest", () => {
    const feed = calendar(
      ["UID:broken@google.com", "SUMMARY:Broken", "DTSTART:not-a-time"],
      ["UID:fine@google.com", "SUMMARY:Fine", "DTSTART:20261103T150000Z", "DTEND:20261103T160000Z"],
    );

    expect(readCalendarFeed(feed, { from, to }).map((event) => event.title)).toEqual(["Fine"]);
  });
});

describe("a saved copy of a real Google feed", () => {
  it("reads it, keeping just the event in the window", () => {
    const events = readCalendarFeed(saved("google-public-holidays.ics"), {
      from: new Date("2026-11-10T00:00:00Z"),
      to: new Date("2026-11-13T00:00:00Z"),
    });

    expect(events.map((event) => event.title)).toEqual(["Veterans Day"]);
    expect(events[0]?.times).toEqual([
      { start: "2026-11-11T05:00:00.000Z", end: "2026-11-12T05:00:00.000Z", allDay: true, busy: false },
    ]);
  });
});
