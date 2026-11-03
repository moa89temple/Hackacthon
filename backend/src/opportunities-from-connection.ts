import type { Claude } from "./claude.ts";
import { goalKey } from "./opportunities.ts";
import type { OfficePage } from "./office-page.ts";
import { takeInOpportunityPage } from "./opportunity-reading.ts";
import type { GoalMatch } from "./opportunity-store.ts";
import { THE_STUDENT, type Store } from "./store.ts";

const WEEK_MS = 7 * 24 * 3_600_000;

/** One page a Connection has opened, for what it may hold. */
export interface PageFromConnection {
  url: string;
  page: OfficePage;
  /** The page is about one event, so a price on it can only be that event's. */
  oneEvent: boolean;
}

/**
 * Where a Connection puts pages that may hold Opportunities, so that they go through the same checks as
 * every other page: a date has to be in the page's words, a fee needs its amount and its reason, and it
 * has to fit one of the Student's Goals. A Connection only ever finds the pages.
 */
export interface OpportunityPagesFromConnection {
  /**
   * Call it for each page a list still shows. It's still there, so this counts as seeing it. True means it
   * needn't be opened: it was read lately for all the Student's Goals, or there's no Goal to read it for.
   */
  confirmIfNothingToAsk(url: string, now: Date): boolean;
  /** What hasn't been seen on its page for a week, wherever it came from, to look at again if a list no longer shows it. */
  pagesNotSeenLately(now: Date): string[];
  /** Brings what's kept of this page into line with it. A failure changes nothing, and is thrown. */
  takeIn(found: PageFromConnection, now: Date): Promise<void>;
}

/** For a Connection that has none. */
export const NO_OPPORTUNITY_PAGES: OpportunityPagesFromConnection = {
  confirmIfNothingToAsk: () => true,
  pagesNotSeenLately: () => [],
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

  function wasReadLatelyForAll(goals: GoalMatch[], url: string, now: Date): boolean {
    const lastRead = data.pageLastReadAt(url);
    if (!lastRead || now.getTime() - lastRead.getTime() >= WEEK_MS) return false;
    const readFor = new Set(data.goalsOfPage(THE_STUDENT, url).map(({ key }) => key));
    return goals.every(({ key }) => readFor.has(key));
  }

  return {
    confirmIfNothingToAsk(url, now) {
      const goals = currentGoals();
      data.confirmSeen(url, now);
      return goals.length === 0 || wasReadLatelyForAll(goals, url, now);
    },

    pagesNotSeenLately: (now) => data.pagesLastSeenBefore(new Date(now.getTime() - WEEK_MS)),

    async takeIn({ url, page, oneEvent }, now) {
      const permission = store.readPermission(THE_STUDENT, connection)?.id;
      // The Student may have revoked while the page was opening, and then none of it goes to the model.
      if (permission === undefined) return;
      /** The model takes a while, and the Student may revoke meanwhile. What it says after that mustn't be kept. */
      const stillStands = () => store.readPermission(THE_STUDENT, connection)?.id === permission;
      const whileItStands = {
        ...data,
        savePage: (...args: Parameters<typeof data.savePage>) => {
          if (stillStands()) data.savePage(...args);
        },
        confirmPage: (...args: Parameters<typeof data.confirmPage>) => {
          if (stillStands()) data.confirmPage(...args);
        },
      };
      await takeInOpportunityPage({ claude, store: whileItStands, model, logError }, { url, page, event: null, goal: null, goals: currentGoals(), oneEvent }, now);
    },
  };
}
