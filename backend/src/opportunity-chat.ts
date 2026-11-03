import { noteSourcesLookedAt, type TurnRecord } from "./activity.ts";
import type { ToolOutcome } from "./milestone-chat.ts";
import type { Opportunities, Opportunity } from "./opportunities.ts";
import { THE_STUDENT, type Store } from "./store.ts";

/**
 * The one tool Opportunities add. Not strict, because it adds nothing here: its code checks the one string
 * it takes, and with every tool strict the real API refuses every reply ("The compiled grammar is too large").
 * It shows the cards itself, so that no second tool is needed and nothing on a card can come from the model.
 */
export const FIND_OPPORTUNITIES_TOOL = {
  name: "find_opportunities",
  description:
    "Searches the Guidebook's Opportunities: events at Temple, and things with a deadline or a date that Buddy found for the Student's Goals, such as scholarships and programs. It shows the Student a card for each match, with its date, what it costs, its Source and a way to save it. Use it before you say anything about what's on or what they could apply for.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Everyday English words for what they're after, whatever language they write in, such as 'scholarship nursing'. Leave it empty to see what's coming up soonest.",
      },
    },
    required: ["query"],
  },
};

export const OPPORTUNITIES_PROMPT = `Opportunities are things with a deadline or a date that a Student could miss. Buddy reads Temple's events from now.temple.edu, and searches the web for what fits each of the Student's Goals. When they ask what's on, or what they could apply for or go to, such as "Are there any scholarships for me?", call ${FIND_OPPORTUNITIES_TOOL.name} first, then say only what it gives. It shows a card for each one it gives, with its date, its cost, its Source and a Save button, so don't repeat the Source and never mention an id. Temple's come first. One with outside_temple true isn't Temple's: say so, and never speak for Temple about it. Always say what one costs when it has a fee, along with the reason it gives for being worth it. They save one by tapping Save on its card, which you can't do for them, and what they've saved shows on the Today tab. If it finds nothing, say plainly that you couldn't find a Source for that, and don't fill the gap from memory.`;

const NOTHING_FOUND =
  "There's nothing among the Opportunities on that, so there's no Source for it. Tell the Student you couldn't find one, and don't answer from memory.";

/** By number, because a system message shouldn't carry a page's words. */
export function reportedOpportunitiesNote(ids: number[]): string {
  if (ids.length === 0) return "";
  const list = ids.map((id) => `Opportunity ${id}`).join(", ");
  return ` These were reported as wrong or out of date, so don't use or mention what you saw about them earlier in this conversation: ${list}.`;
}

/** Opportunities for one turn of the conversation. Each card goes up once, however often Claude looks. */
export function newOpportunityTurn(deps: {
  opportunities: Opportunities;
  store: Store;
  logError: (error: unknown) => void;
  afterMessageId: number;
  now: Date;
  turn: TurnRecord;
}) {
  const { opportunities, store, logError, afterMessageId, now, turn } = deps;
  const shown = new Set<number>();

  /** Saved so that they come back with the conversation. */
  function addCards(found: Opportunity[]): Opportunity[] {
    const fresh = found.filter((opportunity) => !shown.has(opportunity.id));
    for (const opportunity of fresh) {
      shown.add(opportunity.id);
      turn.tools.push(`Showed you the card for ${JSON.stringify(opportunity.name)}.`);
      try {
        store.opportunities.addCard(THE_STUDENT, { opportunityId: opportunity.id, afterMessageId, createdAt: now });
      } catch (error) {
        logError(error);
      }
    }
    return fresh;
  }

  return {
    find(input: unknown): ToolOutcome & { cards: Opportunity[] } {
      const query = (input as { query?: unknown } | null)?.query;
      if (typeof query !== "string") {
        turn.tools.push("Looked for Opportunities, but with nothing to look for.");
        return { cards: [], content: "query must be a string.", isError: true };
      }
      try {
        const found = opportunities.search(query);
        turn.tools.push(`Looked for Opportunities for ${JSON.stringify(query)} and found ${found.length}.`);
        noteSourcesLookedAt(turn, found.flatMap((opportunity) => opportunity.sources));
        return { cards: addCards(found), content: found.length > 0 ? opportunities.describeForClaude(found) : NOTHING_FOUND, isError: false };
      } catch (error) {
        logError(error);
        turn.tools.push("Looked for Opportunities, but something went wrong.");
        return { cards: [], content: "The Opportunities couldn't be searched, so you have no Source. Tell the Student, and don't answer from memory.", isError: true };
      }
    },
  };
}
