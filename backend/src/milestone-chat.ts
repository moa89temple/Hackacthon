import { noteSourcesLookedAt, type TurnRecord } from "./activity.ts";
import type { StandardMilestone, StandardMilestones } from "./standard-milestones.ts";
import { THE_STUDENT, type Store } from "./store.ts";

/** What a tool call gets back. */
export interface ToolOutcome {
  content: string;
  isError: boolean;
}

const NOTHING_FOUND =
  "There's nothing among the Standard Milestones on that, so there's no Source for it. Tell the Student you couldn't find a Source, and don't answer from memory.";

/**
 * Standard Milestones for one turn of the conversation. It remembers what Claude looked up, so that a
 * reply giving one of those dates gets its Source whatever Claude did about cards.
 */
export function newMilestoneTurn(deps: {
  milestones: StandardMilestones;
  store: Store;
  logError: (error: unknown) => void;
  afterMessageId: number;
  now: Date;
  turn: TurnRecord;
}) {
  const { milestones, store, logError, afterMessageId, now, turn } = deps;
  const lookedUp = new Map<number, StandardMilestone>();
  const shown = new Set<number>();

  /** Saved so that they come back with the conversation. */
  function addCards(cards: StandardMilestone[]): StandardMilestone[] {
    const fresh = cards.filter((milestone) => !shown.has(milestone.id));
    for (const milestone of fresh) {
      shown.add(milestone.id);
      turn.tools.push(`Showed you the date for ${JSON.stringify(milestone.name)}.`);
      noteSourcesLookedAt(turn, milestone.sources);
      try {
        store.addMilestoneCard(THE_STUDENT, { milestoneId: milestone.id, afterMessageId, createdAt: now });
      } catch (error) {
        logError(error);
      }
    }
    return fresh;
  }

  return {
    find(input: unknown): ToolOutcome {
      const query = (input as { query?: unknown } | null)?.query;
      if (typeof query !== "string" || query.trim() === "") {
        turn.tools.push("Looked up dates, but with nothing to look for.");
        return { content: "query must be a non-empty string.", isError: true };
      }
      try {
        const found = milestones.search(query);
        turn.tools.push(`Looked up dates for ${JSON.stringify(query)} and found ${found.length}.`);
        for (const milestone of found) lookedUp.set(milestone.id, milestone);
        noteSourcesLookedAt(turn, found.flatMap((milestone) => milestone.sources));
        return { content: found.length > 0 ? milestones.describeForClaude(found) : NOTHING_FOUND, isError: false };
      } catch (error) {
        logError(error);
        turn.tools.push("Looked up dates, but something went wrong.");
        return { content: "The dates couldn't be searched, so you have no Source. Tell the Student, and don't answer from memory.", isError: true };
      }
    },

    show(input: unknown): ToolOutcome & { cards: StandardMilestone[] } {
      const asked = (input as { milestone_ids?: unknown } | null)?.milestone_ids;
      const ids = Array.isArray(asked) ? asked.filter((id): id is number => typeof id === "number") : [];
      const found = milestones.withIds(ids);
      const cards = addCards(found);
      if (ids.length === 0 || found.length < new Set(ids).size) {
        return { cards, content: "At least one of those isn't among the Standard Milestones any more. Don't mention it.", isError: true };
      }
      return { cards, content: "The cards are on the Student's screen, each with its date and Source. Now reply to them.", isError: false };
    },

    /** The cards a finished reply still needs. */
    cardsForReply(words: string): StandardMilestone[] {
      try {
        return addCards(milestones.inReply(words, [...lookedUp.values()]));
      } catch (error) {
        logError(error);
        return [];
      }
    },
  };
}
