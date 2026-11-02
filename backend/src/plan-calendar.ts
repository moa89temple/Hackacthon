import type { Season } from "./bulletin-plan.ts";
import type { UnwrittenRule } from "./unwritten-rules.ts";

const SEASONS: Season[] = ["Fall", "Spring", "Summer"];
/** Buddy's own targets for a term, which the words on the Milestone say are about the term and not a day. */
const TERM_ENDS: Record<Season, string> = { Fall: "12-15", Spring: "05-15", Summer: "08-15" };
const TERM_EARLY: Record<Season, string> = { Fall: "09-15", Spring: "02-01", Summer: "06-01" };

/** A target for a Milestone, in words for the Student and as a day. */
export interface TermTarget {
  when: string;
  dueDate: string;
}

/**
 * Which fall the year of study the Student gives started in, and how many terms past that fall today is.
 * Over the summer, that's the year they're about to start: the term they're in is the last of the year before.
 */
function placeInYear(today: string): { fallYear: number; termsPastFall: number } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (month >= 8) return { fallYear: year, termsPastFall: 0 };
  if (month <= 5) return { fallYear: year - 1, termsPastFall: 1 };
  return { fallYear: year, termsPastFall: -1 };
}

/** Works out which calendar term each year of study falls in, from the year the Student is in now. */
export function planCalendar(currentYear: number, today: string) {
  const { fallYear, termsPastFall } = placeInYear(today);
  /** Counts terms: the same number is the same term. */
  const order = (year: number, seasonIndex: number) => year * SEASONS.length + seasonIndex;
  const nowOrder = order(currentYear, termsPastFall);
  const calendarYear = (year: number, seasonIndex: number) => fallYear + (year - currentYear) + (seasonIndex === 0 ? 0 : 1);
  const label = (year: number, seasonIndex: number) => `${SEASONS[seasonIndex]} ${calendarYear(year, seasonIndex)}`;
  const day = (year: number, seasonIndex: number, targets: Record<Season, string>) =>
    `${calendarYear(year, seasonIndex)}-${targets[SEASONS[seasonIndex]!]}`;

  return {
    /** Null if this term of the plan is already over. */
    endOfPlanTerm(year: number, season: Season): TermTarget | null {
      const seasonIndex = SEASONS.indexOf(season);
      const dueDate = day(year, seasonIndex, TERM_ENDS);
      if (order(year, seasonIndex) < nowOrder || dueDate < today) return null;
      return { when: `By the end of ${label(year, seasonIndex)}`, dueDate };
    },

    /** Null if the rule no longer helps someone in this year of study. */
    forRule({ timing, lastYear }: UnwrittenRule): TermTarget | null {
      if (currentYear > lastYear) return null;
      const byATerm = "planYear" in timing;
      const targets = byATerm ? TERM_ENDS : TERM_EARLY;
      const words = byATerm ? "By the end of" : "Early in";
      const from = byATerm ? order(timing.planYear, SEASONS.indexOf(timing.season)) : nowOrder;
      for (let term = Math.max(from, nowOrder); term < nowOrder + SEASONS.length * 2; term++) {
        const year = Math.floor(term / SEASONS.length);
        const seasonIndex = term % SEASONS.length;
        // Most Students aren't taking classes in the summer, so a rule that's about class waits for fall.
        if (SEASONS[seasonIndex] === "Summer") continue;
        const dueDate = day(year, seasonIndex, targets);
        if (dueDate >= today) return { when: `${words} ${label(year, seasonIndex)}`, dueDate };
      }
      return null;
    },
  };
}
