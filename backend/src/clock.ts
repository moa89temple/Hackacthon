export const PHILADELPHIA = "America/New_York";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** The date and hour on Philadelphia's clock at this moment. */
export function philadelphiaClock(moment: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PHILADELPHIA,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
  }).formatToParts(moment);
  const part = (type: string) => Number(parts.find((candidate) => candidate.type === type)!.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour") };
}

/** Such as "Monday, November 2, 2026 at 9:00 AM", on Philadelphia's clock. */
export function describeInPhiladelphia(moment: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHILADELPHIA,
    dateStyle: "full",
    timeStyle: "short",
  })
    .format(moment)
    .replaceAll("\u202f", " ");
}
