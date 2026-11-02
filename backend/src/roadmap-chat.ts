import { noteSourcesLookedAt, type TurnRecord } from "./activity.ts";
import type { ToolOutcome } from "./milestone-chat.ts";
import { PROPOSE_ROADMAP_TOOL, READ_PLAN_TOOL, ROADMAP_TOOLS, SAVE_GOAL_TOOL, SUGGEST_CHANGE_TOOL } from "./roadmap-tools.ts";
import { RoadmapRefused, type Roadmap, type RoadmapCard } from "./roadmap.ts";

const NAMES = new Set(ROADMAP_TOOLS.map((tool) => tool.name));

const CARD_SHOWN =
  "The card is on the Student's screen. Nothing has changed: only their tap on Accept does that. Don't recite the card. Now reply to them in a sentence or two.";

/** Goals and the Roadmap for one turn of the conversation. It can show a card, and nothing it does can accept one. */
export function newRoadmapTurn(deps: { roadmap: Roadmap; afterMessageId: number; turn: TurnRecord; logError: (error: unknown) => void }) {
  const { roadmap, afterMessageId, turn, logError } = deps;

  /** Claude reads why a request was refused, and anything else is Buddy's own failure. */
  function refusal(error: unknown, tried: string): ToolOutcome {
    turn.tools.push(tried);
    if (error instanceof RoadmapRefused) return { content: error.message, isError: true };
    logError(error);
    return { content: "That couldn't be done. Nothing changed and no card was shown, so tell the Student.", isError: true };
  }

  async function answer(name: string, input: any): Promise<ToolOutcome & { card?: RoadmapCard }> {
    if (name === SAVE_GOAL_TOOL.name) {
      try {
        const goal = roadmap.addGoal(input?.goal);
        turn.tools.push(`Saved this as one of your Goals: ${JSON.stringify(goal.text)}`);
        return { content: `Saved as Goal ${goal.id}. They can see and change it on the You tab. Carry on with your reply.`, isError: false };
      } catch (error) {
        return refusal(error, "Tried to save a Goal, but couldn't.");
      }
    }
    if (name === READ_PLAN_TOOL.name) {
      try {
        const reading = await roadmap.readPlan(input?.major, input?.major_fact);
        if (reading.outcome === "found") {
          turn.tools.push(`Read the Suggested Academic Plan for ${reading.program} in the Bulletin.`);
          noteSourcesLookedAt(turn, reading.sources);
        } else {
          turn.tools.push("Looked in the Bulletin for your major's Suggested Academic Plan, and didn't get to one.");
        }
        return { content: reading.description, isError: false };
      } catch (error) {
        return refusal(error, "Tried to read a Suggested Academic Plan, but couldn't.");
      }
    }
    try {
      const card = name === PROPOSE_ROADMAP_TOOL.name ? roadmap.propose(input, afterMessageId) : roadmap.suggestChange(input, afterMessageId);
      turn.tools.push(name === PROPOSE_ROADMAP_TOOL.name ? "Showed you a card proposing your first Roadmap." : "Showed you a card suggesting a change to your Roadmap.");
      noteSourcesLookedAt(turn, card.milestones.flatMap((milestone) => milestone.sources));
      return { content: CARD_SHOWN, isError: false, card };
    } catch (error) {
      return refusal(error, name === SUGGEST_CHANGE_TOOL.name ? "Tried to suggest a change to your Roadmap, but no card was shown." : "Tried to propose a Roadmap, but no card was shown.");
    }
  }

  return { handles: (name: string) => NAMES.has(name), answer };
}
