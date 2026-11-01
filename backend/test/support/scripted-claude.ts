import type { Claude, ClaudeEvent, ClaudeMessage, ClaudeRequest } from "../../src/claude.ts";

type ContentBlock = ClaudeMessage["content"][number];

export interface ScriptedReply {
  /** Text chunks, streamed in order. */
  chunks?: string[];
  /** Waited on after the first chunk, so a test can look at a reply still being written. */
  holdAfterFirstChunk?: Promise<void>;
  /** Thrown after the chunks, as the SDK does when a request or stream fails. */
  failWith?: Error;
  /** The final message's content. Defaults to one text block holding the chunks. */
  content?: ContentBlock[];
  stopReason?: ClaudeMessage["stop_reason"];
}

export function textBlock(text: string): ContentBlock {
  return { type: "text", text, citations: null };
}

/** Replies from a script, and records every request it was sent. */
export class ScriptedClaude implements Claude {
  readonly requests: ClaudeRequest[] = [];
  readonly #script: ScriptedReply[] = [];

  willReply(...replies: ScriptedReply[]): void {
    this.#script.push(...replies);
  }

  async *stream(request: ClaudeRequest): AsyncGenerator<ClaudeEvent> {
    this.requests.push(structuredClone(request));
    const reply = this.#script.shift();
    if (!reply) throw new Error("ScriptedClaude: no reply scripted for this request");

    const chunks = reply.chunks ?? [];
    for (const [index, text] of chunks.entries()) {
      yield { type: "text", text };
      if (index === 0) await reply.holdAfterFirstChunk;
    }
    if (reply.failWith) throw reply.failWith;

    yield {
      type: "message",
      message: {
        id: `msg_${this.requests.length}`,
        type: "message",
        role: "assistant",
        model: request.model,
        content: reply.content ?? [textBlock(chunks.join(""))],
        stop_reason: reply.stopReason ?? "end_turn",
      } as ClaudeMessage,
    };
  }
}
