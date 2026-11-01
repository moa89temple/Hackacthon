import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendHarness, TEST_CHAT_MODEL } from "./support/backend-harness.ts";
import { textBlock } from "./support/scripted-claude.ts";

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
});

afterEach(async () => {
  await backend.stop();
});

describe("sending a message", () => {
  it("streams Buddy's reply while Claude is still writing it", async () => {
    let finishWriting!: () => void;
    backend.claude.willReply({
      chunks: ["Office hours ", "are for you."],
      holdAfterFirstChunk: new Promise((resolve) => (finishWriting = resolve)),
    });

    const events = backend.send("What are office hours?");

    // Claude is held after its first chunk, so this can only pass if it streams.
    expect((await events.next()).value).toEqual({ type: "text", text: "Office hours " });

    finishWriting();
    const rest = await Array.fromAsync(events);
    expect(rest.map((event) => event.type)).toEqual(["text", "done"]);
    expect(rest[0].text).toBe("are for you.");
    expect(rest[1].reply).toMatchObject({ role: "buddy", text: "Office hours are for you." });
  });

  it.each([[""], ["   "], [42], [undefined]])("refuses an empty or malformed message: %j", async (text) => {
    const response = await backend.post(text);

    expect(response.status).toBe(400);
    expect(backend.claude.requests).toEqual([]);
    expect(await backend.history()).toEqual([]);
  });
});

describe("what Claude is sent", () => {
  it("follows the API constraints for chat", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    const request = backend.claude.requests[0]!;
    expect(request.model).toBe(TEST_CHAT_MODEL);
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.output_config).toEqual({ effort: "low" });
    expect(request.cache_control).toEqual({ type: "ephemeral" });
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    // Leaving tool_choice unset is automatic tool choice. A forced choice is rejected by the API.
    expect(request.tool_choice).toBeUndefined();
  });

  it("keeps the system prompt and tool list frozen across turns and over time", async () => {
    backend.claude.willReply({ chunks: ["One."] }, { chunks: ["Two."] });

    await backend.sendAndCollect("First");
    backend.clock.moveForward(24 * 60 * 60 * 1000);
    await backend.sendAndCollect("Second");

    const [first, second] = backend.claude.requests;
    expect(first!.system).toBeTruthy();
    expect(second!.system).toEqual(first!.system);
    expect(second!.tools).toEqual(first!.tools);
  });

  it("puts the current time in a system message after the Student's message", async () => {
    backend.claude.willReply({ chunks: ["One."] }, { chunks: ["Two."] });

    await backend.sendAndCollect("First");
    backend.clock.moveForward(24 * 60 * 60 * 1000);
    await backend.sendAndCollect("Second");

    const [first, second] = backend.claude.requests;
    expect(first!.messages.at(-2)).toEqual({ role: "user", content: [{ type: "text", text: "First" }] });
    expect(first!.messages.at(-1)).toMatchObject({ role: "system" });
    expect(first!.messages.at(-1)!.content).toContain("Monday, November 2, 2026");
    expect(second!.messages.at(-1)!.content).toContain("Tuesday, November 3, 2026");
  });

  it("only ever appends to the history, returning Claude's blocks exactly as they came", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-abc" } as const;
    backend.claude.willReply(
      { chunks: ["One."], content: [thinking, textBlock("One.")] },
      { chunks: ["Two."] },
      { chunks: ["Three."] },
    );

    await backend.sendAndCollect("First");
    await backend.sendAndCollect("Second");
    await backend.restart();
    await backend.sendAndCollect("Third");

    const [first, second, third] = backend.claude.requests;
    expect(second!.messages.slice(0, first!.messages.length)).toEqual(first!.messages);
    expect(third!.messages.slice(0, second!.messages.length)).toEqual(second!.messages);
    expect(second!.messages[first!.messages.length]).toEqual({
      role: "assistant",
      content: [thinking, textBlock("One.")],
    });
  });
});

describe("when Claude declines", () => {
  it("ends the turn gracefully, replacing anything partly written with Buddy's own note", async () => {
    backend.claude.willReply({
      chunks: ["Partial wor"],
      content: [textBlock("Partial wor")],
      stopReason: "refusal",
    });

    const events = await backend.sendAndCollect("Something Claude declines");

    expect(events.map((event) => event.type)).toEqual(["text", "done"]);
    expect(events[1].reply.text).toMatch(/can't help with that/i);
    expect(events[1].reply.text).not.toContain("Partial wor");
    expect(await backend.history()).toMatchObject([
      { role: "student", text: "Something Claude declines" },
      { role: "buddy", text: events[1].reply.text },
    ]);
  });

  it("leaves the declined turn out of what Claude sees next, so one refusal can't block the chat", async () => {
    backend.claude.willReply(
      { chunks: ["Fine."] },
      { content: [], stopReason: "refusal" },
      { chunks: ["Back on track."] },
    );

    await backend.sendAndCollect("Fine question");
    await backend.sendAndCollect("Declined question");
    await backend.sendAndCollect("Next question");

    const [first, , third] = backend.claude.requests;
    expect(JSON.stringify(third!.messages)).not.toContain("Declined question");
    expect(third!.messages.slice(0, first!.messages.length)).toEqual(first!.messages);
    expect(third!.messages.at(-2)).toEqual({ role: "user", content: [{ type: "text", text: "Next question" }] });
  });

  it("drops only what the API says to drop when a fallback model took over mid-reply", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-abc" } as const;
    const fallback = { type: "fallback", from: { model: "a" }, to: { model: "b" } } as any;
    const lateThinking = { type: "thinking", thinking: "", signature: "sig-late" } as const;
    backend.claude.willReply(
      {
        chunks: ["Started. ", "Finished."],
        content: [thinking, textBlock("Started. "), fallback, lateThinking, textBlock("Finished.")],
      },
      { chunks: ["Next."] },
    );

    const events = await backend.sendAndCollect("First");
    await backend.sendAndCollect("Second");

    expect(events.at(-1).reply.text).toBe("Started. Finished.");
    expect(backend.claude.requests[1]!.messages[2]).toEqual({
      role: "assistant",
      content: [textBlock("Started. "), fallback, lateThinking, textBlock("Finished.")],
    });
  });
});

describe("when Claude fails", () => {
  it("sends an error event, keeps the Student's message, and saves no partial reply", async () => {
    backend.claude.willReply({ chunks: ["Half a rep"], failWith: new Error("overloaded") });

    const events = await backend.sendAndCollect("Are you there?");

    expect(events.map((event) => event.type)).toEqual(["text", "error"]);
    expect(events[1].message).not.toContain("overloaded");
    expect(await backend.history()).toMatchObject([{ role: "student", text: "Are you there?" }]);
    expect(await backend.history()).toHaveLength(1);
  });

  it("includes the unanswered message next turn, in a shape the API accepts", async () => {
    backend.claude.willReply({ failWith: new Error("overloaded") }, { chunks: ["Sorry about that."] });

    await backend.sendAndCollect("Are you there?");
    await backend.sendAndCollect("Hello?");

    // A mid-conversation system message must be followed by an assistant turn or be last.
    const roles = backend.claude.requests[1]!.messages.map((message) => message.role);
    expect(roles).toEqual(["user", "user", "system"]);
  });

  it("treats a reply with nothing in it as a failure", async () => {
    backend.claude.willReply({ content: [] }, { chunks: ["Okay."] });

    const events = await backend.sendAndCollect("Hello");
    await backend.sendAndCollect("Hello?");

    expect(events.map((event) => event.type)).toEqual(["error"]);
    const roles = backend.claude.requests[1]!.messages.map((message) => message.role);
    expect(roles).toEqual(["user", "user", "system"]);
  });
});

describe("when the app isn't there to the end", () => {
  it("still saves Buddy's reply if the app disconnects partway through", async () => {
    let finishWriting!: () => void;
    let replySaved = false;
    backend.claude.willReply({
      chunks: ["Started. ", "Finished."],
      holdAfterFirstChunk: new Promise((resolve) => (finishWriting = resolve)),
    });

    const abort = new AbortController();
    const response = await backend.post("Hello", abort.signal);
    await response.body!.getReader().read();
    abort.abort();
    finishWriting();

    await vi.waitFor(async () => {
      replySaved = (await backend.history()).length === 2;
      expect(replySaved).toBe(true);
    });
    expect((await backend.history())[1].text).toBe("Started. Finished.");
  });

  it("answers messages sent at the same moment one at a time, in order", async () => {
    let finishFirst!: () => void;
    backend.claude.willReply(
      {
        chunks: ["First ", "reply."],
        holdAfterFirstChunk: new Promise((resolve) => (finishFirst = resolve)),
      },
      { chunks: ["Second reply."] },
    );

    const first = backend.send("One");
    await first.next();
    const second = backend.sendAndCollect("Two");
    await new Promise((resolve) => setTimeout(resolve, 50));
    finishFirst();
    await Array.fromAsync(first);
    await second;

    expect((await backend.history()).map((message) => message.text)).toEqual([
      "One",
      "First reply.",
      "Two",
      "Second reply.",
    ]);
    expect(JSON.stringify(backend.claude.requests[1]!.messages)).toContain("First reply.");
  });
});

describe("reloading the conversation", () => {
  it("returns both sides of the conversation in order", async () => {
    backend.claude.willReply({ chunks: ["Hi, I'm Buddy."] }, { chunks: ["Glad to help."] });

    await backend.sendAndCollect("Hello");
    backend.clock.moveForward(60_000);
    await backend.sendAndCollect("Thanks");

    expect(await backend.history()).toMatchObject([
      { role: "student", text: "Hello", sentAt: "2026-11-02T14:00:00.000Z" },
      { role: "buddy", text: "Hi, I'm Buddy.", sentAt: "2026-11-02T14:00:00.000Z" },
      { role: "student", text: "Thanks", sentAt: "2026-11-02T14:01:00.000Z" },
      { role: "buddy", text: "Glad to help.", sentAt: "2026-11-02T14:01:00.000Z" },
    ]);
  });

  it("is still there after the backend restarts", async () => {
    backend.claude.willReply({ chunks: ["Before the restart."] }, { chunks: ["After the restart."] });
    await backend.sendAndCollect("First");

    await backend.restart();

    expect(await backend.history()).toMatchObject([
      { role: "student", text: "First" },
      { role: "buddy", text: "Before the restart." },
    ]);

    await backend.sendAndCollect("Second");
    const request = backend.claude.requests[1]!;
    expect(request.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "First" }] });
    expect(JSON.stringify(request.messages)).toContain("Before the restart.");
  });

  it("gives the done event the same message the history later returns", async () => {
    backend.claude.willReply({ chunks: ["Hello there."] });

    const events = await backend.sendAndCollect("Hi");

    expect((await backend.history())[1]).toEqual(events.at(-1).reply);
  });
});
