import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type ClaudeRequest = BetaMessageStreamParams;
export type ClaudeMessage = Anthropic.Beta.Messages.BetaMessage;

export type ClaudeEvent =
  | { type: "text"; text: string }
  | { type: "message"; message: ClaudeMessage };

/** Runs one streamed Claude request. The last event is always the complete message. */
export interface Claude {
  stream(request: ClaudeRequest): AsyncIterable<ClaudeEvent>;
}

export function anthropicClaude(apiKey: string): Claude {
  const client = new Anthropic({ apiKey });
  return {
    async *stream(request) {
      const stream = client.beta.messages.stream(request);
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      yield { type: "message", message: await stream.finalMessage() };
    },
  };
}
