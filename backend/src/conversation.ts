import { textOf, type Claude, type ClaudeMessage, type ClaudeRequest } from "./claude.ts";
import type { Clock } from "./clock.ts";
import type { CrisisCheck, CrisisOutcome } from "./crisis-check.ts";
import { BUDDY_SYSTEM_PROMPT, CRISIS_CARD_TOOL } from "./system-prompt.ts";
import { THE_STUDENT, type NewMessage, type Store, type StoredMessage } from "./store.ts";

const REFUSAL_NOTE =
  "I can't help with that one. Try asking another way, or tell me what you're trying to get done and I'll point you to someone at Temple who can help.";
const FAILURE_NOTE = "Something went wrong and I couldn't finish that reply. Please try again.";
// What Buddy says itself when Claude can't answer a Student who may be struggling. An error
// or "I can't help with that" is the wrong thing to read at that moment.
const CRISIS_NOTE =
  "I'm having trouble writing a reply right now, so please don't wait on me. The people on this card can help right now. You can keep writing to me here too.";
const CHECK_IN_NOTE =
  "It sounds like things might be hard right now. How are you doing? I'm an AI, so I can't take the place of a person, but I'm glad to listen and help you find someone at Temple to talk to.";

const TURN_INSTRUCTIONS: Record<CrisisOutcome, string> = {
  nothing: "",
  "check-in":
    " Buddy's safety check found the Student may be struggling, but it isn't clear. Gently check in and ask how they're doing, in a sentence or two, before anything else. Don't list crisis numbers unless what they say calls for it.",
  crisis: ` Buddy's safety check found the Student's safety may be at risk, and the app has already shown them the Crisis card, so don't call ${CRISIS_CARD_TOOL.name}. Reply briefly and with care, and encourage them to reach out to someone on the card.`,
};

/** A reply takes one request, or a few if Claude uses its tool first. This stops it looping. */
const MAX_REQUESTS_PER_TURN = 3;

type ClaudeMessageParam = ClaudeRequest["messages"][number];
type ContentBlock = ClaudeMessage["content"][number];

export interface ChatMessage {
  id: number;
  role: "student" | "buddy";
  text: string;
  sentAt: string;
}

/** The app draws the card from its own code. This only says where it goes. */
export interface CrisisCardEntry {
  type: "crisis_card";
  sentAt: string;
}

export type ConversationEvent =
  | { type: "text"; text: string }
  | { type: "crisis_card" }
  | { type: "done"; reply: ChatMessage }
  | { type: "error"; message: string };

export interface Conversation {
  /**
   * Takes the Student's message and returns the stream of events for Buddy's turn.
   * Drain it to the end even if the app has gone away, so that the reply is still saved.
   */
  send(text: string): AsyncGenerator<ConversationEvent>;
  history(): (ChatMessage | CrisisCardEntry)[];
}

export interface ConversationDeps {
  claude: Claude;
  clock: Clock;
  store: Store;
  chatModel: string;
  crisisCheck: CrisisCheck;
  logError: (error: unknown) => void;
}

export function createConversation(deps: ConversationDeps): Conversation {
  const { claude, clock, store, chatModel, crisisCheck, logError } = deps;
  const waitForTurn = oneTurnAtATime();

  /** Ends a turn Claude didn't finish. Saving can be what failed, so that can't stop the note. */
  function endTurnWithoutClaude(note: string | null, now: Date): ConversationEvent {
    if (!note) return { type: "error", message: FAILURE_NOTE };
    try {
      const [saved] = store.appendMessages(THE_STUDENT, [
        {
          role: "assistant",
          content: [{ type: "text", text: note, citations: null }],
          stopReason: "end_turn",
          createdAt: now,
        },
      ]);
      return { type: "done", reply: toChatMessage(saved!) };
    } catch (error) {
      logError(error);
      return { type: "error", message: note };
    }
  }

  return {
    async *send(text) {
      const endTurn = await waitForTurn();
      const now = clock.now();
      let cardShown = false;
      let checkingIn = false;
      const noteIfClaudeCant = () => (cardShown ? CRISIS_NOTE : checkingIn ? CHECK_IN_NOTE : null);

      try {
        // A failed save holds until the check has run, because the card doesn't depend on saving.
        let studentMessageId: number | undefined;
        let saveFailure: unknown;
        try {
          [{ id: studentMessageId }] = store.appendMessages(THE_STUDENT, [
            { role: "user", content: [{ type: "text", text }], createdAt: now },
          ]) as [StoredMessage];
        } catch (error) {
          saveFailure = error;
        }

        const showCard = () => {
          cardShown = true;
          try {
            if (studentMessageId !== undefined) {
              store.addCrisisCard(THE_STUDENT, { afterMessageId: studentMessageId, createdAt: now });
            }
          } catch (error) {
            logError(error);
          }
          return { type: "crisis_card" } as const;
        };

        const outcome = await crisisCheck.check(text);
        if (outcome === "crisis") yield showCard();
        checkingIn = outcome === "check-in";
        if (saveFailure) throw saveFailure;

        const turnContext = {
          role: "system" as const,
          content: describeCurrentTime(now) + TURN_INSTRUCTIONS[outcome],
        };
        const history = [...toClaudeMessages(store.listMessages(THE_STUDENT)), turnContext];
        const toolRounds: NewMessage[] = [];

        for (let requests = 0; requests < MAX_REQUESTS_PER_TURN; requests++) {
          const request = chatRequest(chatModel, [...history, ...toClaudeMessages(toolRounds)]);
          for await (const event of claude.stream(request)) {
            if (event.type === "text") {
              yield event;
              continue;
            }

            const { message } = event;
            const reply = {
              role: "assistant" as const,
              content: message.content,
              stopReason: message.stop_reason,
              createdAt: now,
            };
            if (message.stop_reason === "refusal") {
              // Tool rounds are left out too: Claude's history can't end on an unanswered call.
              const [saved] = store.appendMessages(THE_STUDENT, [{ ...reply, shownText: noteIfClaudeCant() }]);
              yield { type: "done", reply: toChatMessage(saved!) };
              return;
            }
            if (message.stop_reason === "tool_use") {
              const calls = toolCallsIn(message.content);
              if (!cardShown && calls.some((call) => call.name === CRISIS_CARD_TOOL.name)) yield showCard();
              toolRounds.push(reply, { role: "user", content: calls.map(toolResult), createdAt: now });
              continue;
            }
            if (textOf(message.content).trim() === "") {
              throw new Error(`Claude's reply had no text (stop reason: ${message.stop_reason})`);
            }
            // Saved together so a system message is always followed by an assistant
            // turn, as the API requires, even when a turn fails partway through.
            const saved = store.appendMessages(THE_STUDENT, [
              { role: "system", content: turnContext.content, createdAt: now },
              ...toolRounds,
              reply,
            ]);
            yield { type: "done", reply: toChatMessage(saved.at(-1)!) };
            return;
          }
        }
        throw new Error(`Claude was still calling tools after ${MAX_REQUESTS_PER_TURN} requests`);
      } catch (error) {
        logError(error);
        yield endTurnWithoutClaude(noteIfClaudeCant(), now);
      } finally {
        endTurn();
      }
    },

    history() {
      const cards = store.listCrisisCards(THE_STUDENT);
      return store
        .listMessages(THE_STUDENT)
        .filter(isShownToStudent)
        .flatMap((message) => [
          toChatMessage(message),
          ...cards
            .filter((card) => card.afterMessageId === message.id)
            .map((card) => ({ type: "crisis_card" as const, sentAt: card.createdAt.toISOString() })),
        ]);
    },
  };
}

/**
 * The constraints here come from the Claude API docs for Sonnet 5.5. The system prompt and
 * tool list stay frozen, and leaving tool_choice unset means automatic tool choice. They can
 * still change between versions of Buddy, which would make the API reject the thinking blocks
 * in a saved conversation. drop_block has it drop them instead, so the conversation carries on.
 */
function chatRequest(model: string, messages: ClaudeMessageParam[]): ClaudeRequest {
  return {
    model,
    max_tokens: 64000,
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
    output_config: { effort: "low" },
    cache_control: { type: "ephemeral" },
    betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
    fallbacks: "default",
    system: BUDDY_SYSTEM_PROMPT,
    tools: [CRISIS_CARD_TOOL],
    messages,
  };
}

/** The calls that need an answer. Any from before a fallback aren't sent back, so they get none. */
function toolCallsIn(blocks: ContentBlock[]) {
  return blocksToResend(blocks).filter((block) => block.type === "tool_use");
}

function toolResult(call: { id: string; name: string }) {
  return call.name === CRISIS_CARD_TOOL.name
    ? {
        type: "tool_result",
        tool_use_id: call.id,
        content: "The Crisis card is on the Student's screen. Now reply to them.",
      }
    : { type: "tool_result", tool_use_id: call.id, is_error: true, content: `There's no tool called ${call.name}.` };
}

/** Tool rounds are for Claude. The Student sees the reply they led to, and the card. */
function isShownToStudent(message: StoredMessage): boolean {
  if (message.role === "system" || message.stopReason === "tool_use") return false;
  return message.role === "assistant" || textOf(message.content as ContentBlock[]) !== "";
}

/**
 * Rebuilds what Claude sees from the stored record. Everything is sent as it was stored, so
 * each request starts with the one before it. A refused turn is left out along with the
 * Student's messages that led to it: the API docs say to remove the turn before continuing,
 * or else later requests keep being refused. The Student's own record keeps it.
 */
function toClaudeMessages(stored: NewMessage[]): ClaudeMessageParam[] {
  const messages: ClaudeMessageParam[] = [];
  let currentTurn: ClaudeMessageParam[] = [];

  for (const message of stored) {
    if (message.stopReason === "refusal") {
      currentTurn = [];
    } else if (message.role === "assistant") {
      const content = blocksToResend(message.content as ContentBlock[]);
      messages.push(...currentTurn, { role: "assistant", content } as ClaudeMessageParam);
      currentTurn = [];
    } else {
      currentTurn.push({ role: message.role, content: message.content } as ClaudeMessageParam);
    }
  }
  return [...messages, ...currentTurn];
}

/**
 * After a fallback model takes over mid-reply, the API wants thinking and tool calls from
 * before the final fallback block left out. Buddy's tools run on its own side, so only text
 * and the fallback marker itself survive from before that point.
 */
function blocksToResend(blocks: ContentBlock[]): ContentBlock[] {
  const lastFallback = blocks.findLastIndex((block) => block.type === "fallback");
  return blocks.filter(
    (block, index) => index > lastFallback || block.type === "text" || block.type === "fallback",
  );
}

function describeCurrentTime(now: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  return `The current time in Philadelphia is ${formatted}.`;
}

function toChatMessage(message: StoredMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role === "user" ? "student" : "buddy",
    text:
      message.shownText ??
      (message.stopReason === "refusal" ? REFUSAL_NOTE : textOf(message.content as ContentBlock[])),
    sentAt: message.createdAt.toISOString(),
  };
}

/** Returns a function that waits for earlier turns to finish, then gives back this turn's release. */
function oneTurnAtATime(): () => Promise<() => void> {
  let lastTurn = Promise.resolve();
  return async () => {
    const previousTurn = lastTurn;
    let release!: () => void;
    lastTurn = new Promise((resolve) => (release = resolve));
    await previousTurn;
    return release;
  };
}
