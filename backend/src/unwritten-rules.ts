import type { Season } from "./bulletin-plan.ts";

/**
 * What college expects a Student to know and nobody says. Written here rather than by Claude, so that a quick reply
 * can't leave one out. These are about college in general, so nothing here is a Temple fact needing a Source.
 */
export interface UnwrittenRule {
  name: string;
  detail: string;
  /** Soon, or by a certain point in the Student's time at Temple. */
  timing: { earlyInNextTerm: true } | { planYear: number; season: Season };
  /** Past this year of study it no longer helps. */
  lastYear: number;
}

export const UNWRITTEN_RULES: UnwrittenRule[] = [
  {
    name: "Go to office hours in your first few weeks of class",
    detail: "Office hours are times professors set aside to talk with students, and you don't need a problem to go. If you go early, they know you before you need help.",
    timing: { earlyInNextTerm: true },
    lastYear: 6,
  },
  {
    name: "Meet your academic advisor before you register",
    detail: "An advisor helps you choose courses and spot problems early. Most students wait until something goes wrong, and going before you register is how you avoid that.",
    timing: { earlyInNextTerm: true },
    lastYear: 6,
  },
  {
    name: "Start your internship search",
    detail: "Many students start looking in sophomore year, because summer internships often fill up months ahead.",
    timing: { planYear: 2, season: "Fall" },
    lastYear: 3,
  },
  {
    name: "Get to know a professor who could write you a recommendation",
    detail: "Jobs and graduate schools often ask for one, and a professor who knows you can write a far better one.",
    timing: { planYear: 2, season: "Spring" },
    lastYear: 3,
  },
];
