import type { Claude } from "./claude.ts";
import { goalKey } from "./opportunities.ts";
import type { OfficePage } from "./office-page.ts";
import { takeInOpportunityPage } from "./opportunity-reading.ts";
import type { GoalMatch } from "./opportunity-store.ts";
import { THE_STUDENT, type Store } from "./store.ts";

const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * Where a Connection puts pages that may hold Opportunities, so that they go through the same checks as
 * every other page: a date has to be in the page's words, a fee needs its amount and its reason, and it
 * has to fit one of the Student's Goals. A Connection only ever finds the pages.
 */
export interface OpportunityPagesFromConnection {
  /** Whether there's anything to match a page against. With no Goal, there's no reason to open one. */
  wanted(): boolean;
  /**
   * True if this page was read lately and for all the Student's Goals, so it needn't be opened again. It's
   * still on its list, so that counts as seeing it there.
   */
  confirmIfRecent(url: string, now: Date): boolean;
  /** Brings what's kept of this page into line with it. A failure changes nothing, and is thrown. */
  takeIn(url: string, page: OfficePage, now: Date): Promise<void>;
}

/** For a Connection that has none. */
export const NO_OPPORTUNITY_PAGES: OpportunityPagesFromConnection = {
  wanted: () => false,
  confirmIfRecent: () => true,
  takeIn: async () => {},
};

export function createOpportunityPagesFromConnection(deps: {
  connection: string;
  claude: Claude;
  store: Store;
  model: string;
  logError: (error: unknown) => void;
}): OpportunityPagesFromConnection {
  const { connection, claude, store, model, logError } = deps;
  const data = store.opportunities;

  /** A Goal said twice in other spacing is one Goal. */
  function currentGoals(): GoalMatch[] {
    const goals = new Map(store.roadmap.listGoals(THE_STUDENT).map((goal) => [goalKey(goal.text), goal.text]));
    return [...goals].map(([key, text]) => ({ studentId: THE_STUDENT, key, text }));
  }

  return {
    wanted: () => currentGoals().length > 0,

    confirmIfRecent(url, now) {
      const lastRead = data.pageLastReadAt(url);
      if (!lastRead || now.getTime() - lastRead.getTime() >= WEEK_MS) return false;
      const readFor = new Set(data.goalsOfPage(THE_STUDENT, url).map(({ key }) => key));
      if (!currentGoals().every(({ key }) => readFor.has(key))) return false;
      data.confirmSeen(url, now);
      return true;
    },

    async takeIn(url, page, now) {
      const permission = store.readPermission(THE_STUDENT, connection)?.id;
      /** The model takes a while, and the Student may revoke meanwhile. What's asked after that mustn't be kept. */
      const stillStands = () => permission !== undefined && store.readPermission(THE_STUDENT, connection)?.id === permission;
      const whileItStands = {
        ...data,
        savePage: (...args: Parameters<typeof data.savePage>) => {
          if (stillStands()) data.savePage(...args);
        },
        confirmPage: (...args: Parameters<typeof data.confirmPage>) => {
          if (stillStands()) data.confirmPage(...args);
        },
      };
      await takeInOpportunityPage({ claude, store: whileItStands, model, logError }, { url, page, event: null, goal: null, goals: currentGoals() }, now);
    },
  };
}
