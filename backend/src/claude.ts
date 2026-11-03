import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type ClaudeRequest = BetaMessageStreamParams;
export type ClaudeMessage = Anthropic.Beta.Messages.BetaMessage;

export type ClaudeEvent =
  | { type: "text"; text: string }
  | { type: "message"; message: ClaudeMessage };

/** Runs one streamed Claude request. The last event is always the complete message. */
export interface Claude {
  stream(request: ClaudeRequest, options?: { signal?: AbortSignal }): AsyncIterable<ClaudeEvent>;
}

/** The words in a message, leaving out thinking, tool calls and the rest. */
export function textOf(blocks: ClaudeMessage["content"]): string {
  return blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

/**
 * After a fallback model takes over mid-reply, the API wants thinking and tool calls from
 * before the final fallback block left out. Buddy's tools run on its own side, so only text
 * and the fallback marker itself survive from before that point.
 */
export function blocksToResend(blocks: ClaudeMessage["content"]): ClaudeMessage["content"] {
  const lastFallback = blocks.findLastIndex((block) => block.type === "fallback");
  return blocks.filter(
    (block, index) => index > lastFallback || block.type === "text" || block.type === "fallback",
  );
}

export function anthropicClaude(apiKey: string): Claude {
  const client = new Anthropic({ apiKey });
  return {
    async *stream(request, options) {
      const stream = client.beta.messages.stream(request, options);
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      yield { type: "message", message: await stream.finalMessage() };
    },
  };
}
