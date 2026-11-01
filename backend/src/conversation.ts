import type { Claude, ClaudeMessage, ClaudeRequest } from "./claude.ts";
import type { Clock } from "./clock.ts";
import { BUDDY_SYSTEM_PROMPT } from "./system-prompt.ts";
import type { Store, StoredMessage } from "./store.ts";

/** This version has one Student, but all data is keyed by Student so more can come later. */
const THE_STUDENT = "the-student";

const REFUSAL_NOTE =
  "I can't help with that one. Try asking another way, or tell me what you're trying to get done and I'll point you to someone at Temple who can help.";
const FAILURE_NOTE = "Something went wrong and I couldn't finish that reply. Please try again.";

type ClaudeMessageParam = ClaudeRequest["messages"][number];
type ContentBlock = ClaudeMessage["content"][number];

export interface ChatMessage {
  id: number;
  role: "student" | "buddy";
  text: string;
  sentAt: string;
}

export type ConversationEvent =
  | { type: "text"; text: string }
  | { type: "done"; reply: ChatMessage }
  | { type: "error"; message: string };

export interface Conversation {
  /**
   * Takes the Student's message and returns the stream of events for Buddy's turn.
   * Drain it to the end even if the app has gone away, so that the reply is still saved.
   */
  send(text: string): AsyncGenerator<ConversationEvent>;
  history(): ChatMessage[];
}

export interface ConversationDeps {
  claude: Claude;
  clock: Clock;
  store: Store;
  chatModel: string;
  logError: (error: unknown) => void;
}

export function createConversation(deps: ConversationDeps): Conversation {
  const { claude, clock, store, chatModel, logError } = deps;
  const waitForTurn = oneTurnAtATime();

  return {
    async *send(text) {
      const endTurn = await waitForTurn();
      try {
        const now = clock.now();
        store.appendMessages(THE_STUDENT, [
          { role: "user", content: [{ type: "text", text }], createdAt: now },
        ]);

        const turnContext = { role: "system" as const, content: describeCurrentTime(now) };
        const request = chatRequest(chatModel, [
          ...toClaudeMessages(store.listMessages(THE_STUDENT)),
          turnContext,
        ]);

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
            const [saved] = store.appendMessages(THE_STUDENT, [reply]);
            yield { type: "done", reply: toChatMessage(saved!) };
          } else if (textOf(message.content).trim() === "") {
            throw new Error(`Claude's reply had no text (stop reason: ${message.stop_reason})`);
          } else {
            // Saved together so a system message is always followed by an assistant
            // turn, as the API requires, even when a turn fails partway through.
            const saved = store.appendMessages(THE_STUDENT, [
              { role: "system", content: turnContext.content, createdAt: now },
              reply,
            ]);
            yield { type: "done", reply: toChatMessage(saved[1]!) };
          }
        }
      } catch (error) {
        logError(error);
        yield { type: "error", message: FAILURE_NOTE };
      } finally {
        endTurn();
      }
    },

    history() {
      return store
        .listMessages(THE_STUDENT)
        .filter((message) => message.role !== "system")
        .map(toChatMessage);
    },
  };
}

/**
 * The constraints here come from the Claude API docs for Sonnet 5.5. The system prompt and
 * tool list stay frozen, and leaving tool_choice unset means automatic tool choice.
 */
function chatRequest(model: string, messages: ClaudeMessageParam[]): ClaudeRequest {
  return {
    model,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    cache_control: { type: "ephemeral" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: BUDDY_SYSTEM_PROMPT,
    messages,
  };
}

/**
 * Rebuilds what Claude sees from the stored record. Everything is sent as it was stored, so
 * each request starts with the one before it. A refused turn is left out along with the
 * Student's messages that led to it: the API docs say to remove the turn before continuing,
 * or else later requests keep being refused. The Student's own record keeps it.
 */
function toClaudeMessages(stored: StoredMessage[]): ClaudeMessageParam[] {
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
 * After a fallback model takes over mid-reply, the API wants model-internal blocks from
 * before the final fallback block left out. Buddy has no tools yet, so only text and the
 * fallback marker itself survive from before that point.
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
    text: message.stopReason === "refusal" ? REFUSAL_NOTE : textOf(message.content as ContentBlock[]),
    sentAt: message.createdAt.toISOString(),
  };
}

function textOf(blocks: ContentBlock[]): string {
  return blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
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
