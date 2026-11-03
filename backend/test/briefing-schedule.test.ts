import { describe, expect, it } from "vitest";
import { latestScheduled, nextScheduled } from "../src/briefing-schedule.ts";

const USUAL = { weekdays: "08:00", sunday: "18:00" };

describe("when Briefings are due, on Philadelphia's clock", () => {
  it("is 8 a.m. on a weekday while Philadelphia is on daylight time", () => {
    // Friday, October 30, 2026, just after 8 a.m. EDT, which is UTC-4.
    expect(latestScheduled(new Date("2026-10-30T12:00:01Z"), USUAL)).toEqual({ kind: "weekday", at: new Date("2026-10-30T12:00:00Z") });
  });

  it("is 8 a.m. on a weekday while Philadelphia is on standard time", () => {
    // Monday, November 2, 2026, just after 8 a.m. EST, which is UTC-5.
    expect(latestScheduled(new Date("2026-11-02T13:00:01Z"), USUAL)).toEqual({ kind: "weekday", at: new Date("2026-11-02T13:00:00Z") });
  });

  it("keeps to 6 p.m. on the Sunday the clocks go back", () => {
    // November 1, 2026. EDT ends at 2 a.m., so 6 p.m. is EST.
    expect(latestScheduled(new Date("2026-11-01T23:30:00Z"), USUAL)).toEqual({ kind: "week_ahead", at: new Date("2026-11-01T23:00:00Z") });
  });

  it("keeps to 6 p.m. on the Sunday the clocks go forward", () => {
    // March 14, 2027. EST ends at 2 a.m., so 6 p.m. is EDT.
    expect(latestScheduled(new Date("2027-03-14T22:30:00Z"), USUAL)).toEqual({ kind: "week_ahead", at: new Date("2027-03-14T22:00:00Z") });
  });

  it("keeps to 8 a.m. on the Monday after the clocks go forward", () => {
    expect(latestScheduled(new Date("2027-03-15T12:00:00Z"), USUAL)).toEqual({ kind: "weekday", at: new Date("2027-03-15T12:00:00Z") });
  });

  it("isn't due a moment before its time", () => {
    // Just before 8 a.m. on Monday, November 2: the latest is still Sunday's.
    expect(latestScheduled(new Date("2026-11-02T12:59:59Z"), USUAL)).toEqual({ kind: "week_ahead", at: new Date("2026-11-01T23:00:00Z") });
  });

  it("has nothing on a Saturday, so Friday's is still the latest", () => {
    // Saturday, November 7, 2026, in the evening.
    expect(latestScheduled(new Date("2026-11-07T23:30:00Z"), USUAL)).toEqual({ kind: "weekday", at: new Date("2026-11-06T13:00:00Z") });
  });

  it("goes by the times the Student chose", () => {
    const chosen = { weekdays: "07:15", sunday: "20:45" };

    expect(latestScheduled(new Date("2026-11-03T12:15:00Z"), chosen)).toEqual({ kind: "weekday", at: new Date("2026-11-03T12:15:00Z") });
    expect(latestScheduled(new Date("2026-11-09T01:45:00Z"), chosen)).toEqual({ kind: "week_ahead", at: new Date("2026-11-09T01:45:00Z") });
  });

  it("moves a time the clocks skip to just past the skipped hour", () => {
    // 2:30 a.m. doesn't exist on March 14, 2027. An hour on from 1:30 EST is 3:30 EDT, which is 07:30Z.
    const skipped = { weekdays: "08:00", sunday: "02:30" };

    expect(latestScheduled(new Date("2027-03-14T07:30:00Z"), skipped)).toEqual({ kind: "week_ahead", at: new Date("2027-03-14T07:30:00Z") });
    expect(latestScheduled(new Date("2027-03-14T07:29:59Z"), skipped).kind).toBe("weekday");
  });

  it("uses the first of a time the clocks repeat", () => {
    // 1:30 a.m. comes twice on November 1, 2026: 05:30Z in EDT and 06:30Z in EST.
    const repeated = { weekdays: "08:00", sunday: "01:30" };

    expect(latestScheduled(new Date("2026-11-01T05:30:00Z"), repeated)).toEqual({ kind: "week_ahead", at: new Date("2026-11-01T05:30:00Z") });
    expect(latestScheduled(new Date("2026-11-01T06:30:00Z"), repeated)).toEqual({ kind: "week_ahead", at: new Date("2026-11-01T05:30:00Z") });
  });
});

describe("the next Briefing", () => {
  it("is later today when today's time is still to come", () => {
    expect(nextScheduled(new Date("2026-11-02T12:00:00Z"), USUAL)).toEqual({ kind: "weekday", at: new Date("2026-11-02T13:00:00Z") });
  });

  it("is tomorrow once today's has gone", () => {
    expect(nextScheduled(new Date("2026-11-02T13:00:00Z"), USUAL)).toEqual({ kind: "weekday", at: new Date("2026-11-03T13:00:00Z") });
  });

  it("is Sunday's after Friday's", () => {
    expect(nextScheduled(new Date("2026-11-06T14:00:00Z"), USUAL)).toEqual({ kind: "week_ahead", at: new Date("2026-11-08T23:00:00Z") });
  });
});
