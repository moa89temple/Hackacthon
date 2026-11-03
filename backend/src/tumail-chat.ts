import { noteFactsGiven, type TurnRecord } from "./activity.ts";
import type { ClaudeMessage } from "./claude.ts";
import type { ProfileFact } from "./profile.ts";
import { PROPOSE_ROADMAP_TOOL, SAVE_GOAL_TOOL, SUGGEST_CHANGE_TOOL } from "./roadmap-tools.ts";
import type { NewMessage } from "./store.ts";
import { CONNECT_SERVICE_TOOL } from "./service-chat.ts";
import { START_TASK_TOOL } from "./task-chat.ts";
import { MAKE_HANDOFF_TOOL, REMEMBER_TOOL, REQUEST_ACTION_TOOL, SUGGEST_CONNECTION_TOOL } from "./system-prompt.ts";

type ContentBlock = ClaudeMessage["content"][number];

/**
 * What stops an email from steering Buddy, whatever Claude makes of it. Email is the one place other
 * people's words reach Claude, and anyone can write to a Student. From the moment Claude has read email
 * in a turn until the Student next writes, those words are in the same request as what they wrote, so
 * what could outlast the reply, or ask the Student to agree to something new, is refused. Claude can still
 * look things up and show Buddy's own cards, whose words come from Buddy's own records. That includes
 * the Crisis card, and the card asking the Student to log in again, which only follows a Connection's state.
 */
const STOPPED_AFTER_READING_EMAIL = new Map([
  [REMEMBER_TOOL.name, "saving a fact to your Profile"],
  [MAKE_HANDOFF_TOOL.name, "writing a Draft"],
  [REQUEST_ACTION_TOOL.name, "asking for an Action Permission"],
  [SUGGEST_CONNECTION_TOOL.name, "showing a Read Permission card"],
  [CONNECT_SERVICE_TOOL.name, "connecting to something new"],
  [START_TASK_TOOL.name, "starting a Task"],
  [SAVE_GOAL_TOOL.name, "saving a Goal"],
  [PROPOSE_ROADMAP_TOOL.name, "showing a Roadmap card"],
  [SUGGEST_CHANGE_TOOL.name, "showing a card that changes your Roadmap"],
]);

const refusedAfter = (what: string) =>
  `Refused by Buddy's code, because you've read ${what} in this turn and that can't lead straight to this. Nothing happened. Answer them now, say in your own words what it says if it matters, and offer to do this if they want it. Once they say so in their next message, you can.`;

/** Stored in place of what Claude was shown, so that the words of other people's email aren't kept or sent again. */
export const MAIL_NOT_KEPT =
  "[Buddy showed you recent TUmail here, for that reply only, and doesn't keep the words in the conversation. To see it again, call the check again.]";

/** The same, for what was read from a service the Student connected. Anyone may have written it too. */
export const SERVICE_NOT_KEPT =
  "[Buddy showed you what it read from a service here, for that reply only, and doesn't keep the words in the conversation. To see it again, call the check again.]";

/** The same, for what a Task found, which came from web pages and could have come from their mail. */
export const TASK_NOT_KEPT =
  "[Buddy showed you what a Task found here, for that reply only, and doesn't keep the words in the conversation. To see it again, call the tool again.]";

export function newMailTurn(turn: TurnRecord) {
  const readingCalls = new Set<string>();
  const serviceCalls = new Set<string>();
  const taskCalls = new Set<string>();
  const anyRead = () => readingCalls.size + serviceCalls.size + taskCalls.size > 0;

  return {
    /** The call that showed Claude the Student's email. */
    noteRead(callId: string): void {
      readingCalls.add(callId);
    },

    /** The call that showed Claude what was read from a service the Student connected. */
    noteServiceRead(callId: string): void {
      serviceCalls.add(callId);
    },

    /** The call that showed Claude what a Task found. */
    noteTaskRead(callId: string): void {
      taskCalls.add(callId);
    },

    /** What to answer instead of doing this tool's work, or null if it may go ahead. */
    refusal(toolName: string): string | null {
      const stopped = anyRead() ? STOPPED_AFTER_READING_EMAIL.get(toolName) : undefined;
      if (!stopped) return null;
      const [toStudent, toClaude] =
        readingCalls.size > 0 ? ["your email", "the Student's email"] : serviceCalls.size > 0 ? ["a service you connected", "a service they connected"] : ["what a Task found", "what a Task found"];
      turn.tools.push(`Buddy's code stopped the AI ${stopped}, because it had just read ${toStudent}.`);
      return refusedAfter(toClaude!);
    },

    /**
     * The turn as it's saved. The answers that held email become a mark, and thinking goes too because it
     * could quote them. A later request sends these again without thinking, as the API allows for a past turn.
     */
    forHistory<T extends NewMessage>(messages: T[]): T[] {
      if (!anyRead()) return messages;
      return messages.map((message) => {
        if (!Array.isArray(message.content)) return message;
        const content = (message.content as ContentBlock[])
          .filter((block) => block.type !== "thinking" && block.type !== "redacted_thinking")
          .map((block) => {
            const answer = block as unknown as { type: string; tool_use_id?: string };
            if (answer.type !== "tool_result") return block;
            if (readingCalls.has(answer.tool_use_id ?? "")) return { ...answer, content: MAIL_NOT_KEPT };
            if (taskCalls.has(answer.tool_use_id ?? "")) return { ...answer, content: TASK_NOT_KEPT };
            return serviceCalls.has(answer.tool_use_id ?? "") ? { ...answer, content: SERVICE_NOT_KEPT } : block;
          });
        return { ...message, content };
      });
    },
  };
}

/**
 * Activity keeps what Buddy looked at for good, and revoking doesn't reach it. An email's words stay
 * out of there: who it's from and its subject say what Buddy had in front of it.
 */
export function noteMailGiven(turn: TurnRecord, facts: ProfileFact[]): void {
  noteFactsGiven(turn, facts.map(({ detail: _, ...fact }) => fact));
}
