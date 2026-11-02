import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness, TEST_CHAT_MODEL, TEST_CRISIS_MODEL } from "./support/backend-harness.ts";
import { classifierAnswer, textBlock, toolUseBlock } from "./support/scripted-claude.ts";

const CLEAR = "I want to kill myself";
const UNCLEAR = "I can't do this anymore";
const SLANG = "This exam is killing me";

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
});

afterEach(async () => {
  await backend.stop();
});

const types = (events: any[]) => events.map((event) => event.type);
const chatRequests = () => backend.claude.requests.filter((request) => request.model === TEST_CHAT_MODEL);
const classifierRequests = () => backend.claude.requests.filter((request) => request.model === TEST_CRISIS_MODEL);
const lastSystemNote = () => String(chatRequests().at(-1)!.messages.findLast((m) => m.role === "system")!.content);

describe("a clear risk signal", () => {
  it("brings the Crisis card before Claude has been called at all", async () => {
    let letClaudeAnswer!: () => void;
    backend.claude.willReply({
      chunks: ["I'm so glad you told me."],
      holdBeforeAnswering: new Promise((resolve) => (letClaudeAnswer = resolve)),
    });

    const events = backend.send(CLEAR);

    // Claude is held until after the card has arrived, so this can only pass if nothing waits on it.
    expect((await events.next()).value).toEqual({ type: "crisis_card" });

    letClaudeAnswer();
    expect((await Array.fromAsync(events)).at(-1).reply.text).toBe("I'm so glad you told me.");
  });

  it("doesn't ask the classifier, so nothing can argue it down", async () => {
    backend.claude.willReply({ chunks: ["I'm here."] });

    await backend.sendAndCollect(CLEAR);

    expect(classifierRequests()).toEqual([]);
    expect(chatRequests()).toHaveLength(1);
  });

  it("tells Claude the card is already on the screen", async () => {
    backend.claude.willReply({ chunks: ["I'm here."] });

    await backend.sendAndCollect(CLEAR);

    expect(lastSystemNote()).toMatch(/Crisis card/);
  });

  it("still shows the card when Claude fails, with a note from Buddy instead of an error", async () => {
    backend.claude.willReply({ chunks: ["Half a rep"], failWith: new Error("overloaded") });

    const events = await backend.sendAndCollect(CLEAR);

    expect(types(events)).toEqual(["crisis_card", "text", "done"]);
    expect(events.at(-1).reply.text).toMatch(/card/i);
    expect(events.at(-1).reply.text).not.toContain("Half a rep");
    expect(await backend.history()).toMatchObject([
      { role: "student", text: CLEAR },
      { type: "crisis_card" },
      { role: "buddy", text: events.at(-1).reply.text },
    ]);
  });

  it("still shows the card when Claude refuses, without telling the Student it can't help", async () => {
    backend.claude.willReply({ content: [], stopReason: "refusal" });

    const events = await backend.sendAndCollect(CLEAR);

    expect(types(events)).toEqual(["crisis_card", "done"]);
    expect(events.at(-1).reply.text).toMatch(/card/i);
    expect(events.at(-1).reply.text).not.toMatch(/can't help/i);
    expect((await backend.history()).at(-1)).toEqual(events.at(-1).reply);
  });
});

describe("after the card", () => {
  it("is still there, in its place, when the conversation is reloaded after a restart", async () => {
    backend.claude.willReply({ chunks: ["I'm here."] });

    await backend.sendAndCollect(CLEAR);
    await backend.restart();

    expect(await backend.history()).toMatchObject([
      { role: "student", text: CLEAR },
      { type: "crisis_card", sentAt: "2026-11-02T14:00:00.000Z" },
      { role: "buddy", text: "I'm here." },
    ]);
  });

  it("carries on normally: the next message gets an ordinary reply and no second card", async () => {
    backend.claude.willReply({ chunks: ["I'm here."] }, { chunks: ["A hold stops registration."] });

    await backend.sendAndCollect(CLEAR);
    const events = await backend.sendAndCollect("What is a hold?");

    expect(types(events)).toEqual(["text", "done"]);
    expect(events.at(-1).reply.text).toBe("A hold stops registration.");
    expect(JSON.stringify(chatRequests()[1]!.messages)).toContain(CLEAR);
    expect(chatRequests()[1]!.messages.at(-2)).toEqual({
      role: "user",
      content: [{ type: "text", text: "What is a hold?" }],
    });
  });

  it("can continue after a refused Crisis turn, leaving that turn out of what Claude sees", async () => {
    backend.claude.willReply({ content: [], stopReason: "refusal" }, { chunks: ["Okay."] });

    await backend.sendAndCollect(CLEAR);
    await backend.sendAndCollect("Are you there?");

    expect(JSON.stringify(chatRequests()[1]!.messages)).not.toContain(CLEAR);
  });
});

describe("unclear messages", () => {
  it("are sent to the classifier first, in the shape the API requires", async () => {
    backend.claude.willReply(classifierAnswer("nothing"), { chunks: ["Okay."] });

    await backend.sendAndCollect(UNCLEAR);

    const request = backend.claude.requests[0]!;
    expect(request.model).toBe(TEST_CRISIS_MODEL);
    expect(request.messages).toEqual([{ role: "user", content: UNCLEAR }]);
    expect(request.output_config?.format?.type).toBe("json_schema");
    expect((request as any).temperature).toBeUndefined();
    expect(request.fallbacks).toBeUndefined();
    expect(request.max_tokens).toBeGreaterThanOrEqual(1024);
  });

  it("get an ordinary reply when the classifier says nothing", async () => {
    backend.claude.willReply(classifierAnswer("nothing"), { chunks: ["Okay."] });

    const events = await backend.sendAndCollect(UNCLEAR);

    expect(types(events)).toEqual(["text", "done"]);
    expect(lastSystemNote()).not.toMatch(/check in|Crisis card/i);
  });

  it("get a check-in without the card when the classifier says check-in", async () => {
    backend.claude.willReply(classifierAnswer("check-in"), { chunks: ["How are you doing?"] });

    const events = await backend.sendAndCollect(UNCLEAR);

    expect(types(events)).toEqual(["text", "done"]);
    expect(lastSystemNote()).toMatch(/check in/i);
    expect((await backend.history()).map((item) => item.type)).not.toContain("crisis_card");
  });

  it("get the card when the classifier says Crisis, before Claude writes anything", async () => {
    backend.claude.willReply(classifierAnswer("crisis"), { chunks: ["I'm here."] });

    const events = await backend.sendAndCollect(UNCLEAR);

    expect(types(events)).toEqual(["crisis_card", "text", "done"]);
    expect(lastSystemNote()).toMatch(/Crisis card/);
  });

  it("get a check-in from Buddy's own words if Claude then fails too", async () => {
    backend.claude.willReply(classifierAnswer("check-in"), { failWith: new Error("overloaded") });

    const events = await backend.sendAndCollect(UNCLEAR);

    expect(types(events)).toEqual(["done"]);
    expect(events[0].reply.text).toMatch(/how are you/i);
  });

  it("get a check-in from Buddy's own words if Claude refuses", async () => {
    backend.claude.willReply(classifierAnswer("check-in"), { content: [], stopReason: "refusal" });

    const events = await backend.sendAndCollect(UNCLEAR);

    expect(events[0].reply.text).toMatch(/how are you/i);
    expect((await backend.history()).at(-1).text).toBe(events[0].reply.text);
  });
});

describe("when the classifier can't answer, the check-in stands", () => {
  const cases = {
    "it fails": { failWith: new Error("overloaded") },
    "it refuses": { content: [], stopReason: "refusal" as const },
    "it gets cut off": { content: [textBlock('{"outc')], stopReason: "max_tokens" as const },
    "its answer isn't JSON": { content: [textBlock("crisis, I think")] },
    "its answer isn't an outcome": { content: [textBlock('{"outcome":"maybe"}')] },
  };

  for (const [name, reply] of Object.entries(cases)) {
    it(name, async () => {
      backend.claude.willReply(reply, { chunks: ["How are you doing?"] });

      const events = await backend.sendAndCollect(UNCLEAR);

      expect(types(events)).toEqual(["text", "done"]);
      expect(lastSystemNote()).toMatch(/check in/i);
    });
  }

  it("it runs out of time, which also cancels the request", async () => {
    backend.claude.willReply({ holdBeforeAnswering: new Promise(() => {}) }, { chunks: ["How are you doing?"] });

    const events = await backend.sendAndCollect(UNCLEAR);

    expect(types(events)).toEqual(["text", "done"]);
    expect(lastSystemNote()).toMatch(/check in/i);
    expect(backend.claude.signals[0]!.aborted).toBe(true);
  });
});

describe("everyday exaggeration", () => {
  it.each([[SLANG], ["orgo is literally killing me"], ["I'd rather die than take another 8am"]])(
    "%s gets neither a card nor a check-in, and costs no classifier call",
    async (text) => {
      backend.claude.willReply({ chunks: ["Hang in there."] });

      const events = await backend.sendAndCollect(text);

      expect(types(events)).toEqual(["text", "done"]);
      expect(classifierRequests()).toEqual([]);
      expect(lastSystemNote()).not.toMatch(/check in|Crisis card/i);
    },
  );
});

describe("Claude raising the card mid-conversation", () => {
  const raisesCard = () => ({
    content: [toolUseBlock("show_crisis_card", {})],
    stopReason: "tool_use" as const,
  });

  it("offers Claude a tool that takes nothing from the model, so it can't write the card", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    const tool = chatRequests()[0]!.tools!.find((candidate: any) => candidate.name === "show_crisis_card") as any;
    expect(tool.input_schema.properties).toEqual({});
  });

  it("shows the card as soon as Claude asks, then lets Claude finish its reply", async () => {
    backend.claude.willReply(raisesCard(), { chunks: ["I'm here with you."] });

    const events = await backend.sendAndCollect("Everything feels pointless lately");

    expect(types(events)).toEqual(["crisis_card", "text", "done"]);
    expect(events.at(-1).reply.text).toBe("I'm here with you.");
  });

  it("answers the tool call in the shape the API requires", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-abc" } as const;
    const call = toolUseBlock("show_crisis_card", {});
    backend.claude.willReply({ content: [thinking, call], stopReason: "tool_use" }, { chunks: ["I'm here."] });

    await backend.sendAndCollect("Everything feels pointless lately");

    const messages = chatRequests()[1]!.messages;
    expect(messages.map((message) => message.role)).toEqual(["user", "system", "assistant", "user"]);
    expect(messages[2]!.content).toEqual([thinking, call]);
    expect(messages[3]!.content).toMatchObject([{ type: "tool_result", tool_use_id: call.id }]);
  });

  it("keeps the whole turn in the same order for every later request, across a restart", async () => {
    backend.claude.willReply(raisesCard(), { chunks: ["I'm here."] }, { chunks: ["Okay."] });

    await backend.sendAndCollect("Everything feels pointless lately");
    await backend.restart();
    await backend.sendAndCollect("Thanks");

    const [, second, third] = chatRequests();
    expect(third!.messages.slice(0, second!.messages.length)).toEqual(second!.messages);
    expect(third!.messages.map((message) => message.role)).toEqual([
      "user",
      "system",
      "assistant",
      "user",
      "assistant",
      "user",
      "system",
    ]);
  });

  it("shows the Student one reply, and the card in its place, when the conversation reloads", async () => {
    backend.claude.willReply(raisesCard(), { chunks: ["I'm here."] });

    const events = await backend.sendAndCollect("Everything feels pointless lately");

    expect(await backend.history()).toMatchObject([
      { role: "student", text: "Everything feels pointless lately" },
      { type: "crisis_card" },
      { role: "buddy", text: "I'm here." },
    ]);
    expect((await backend.history()).at(-1)).toEqual(events.at(-1).reply);
  });

  it("shows only one card a turn, however often Claude asks", async () => {
    backend.claude.willReply(raisesCard(), raisesCard(), { chunks: ["I'm here."] });

    const events = await backend.sendAndCollect("Everything feels pointless lately");

    expect(types(events).filter((type) => type === "crisis_card")).toHaveLength(1);
  });

  it("doesn't show a second card when the check has already shown one", async () => {
    backend.claude.willReply(raisesCard(), { chunks: ["I'm here."] });

    const events = await backend.sendAndCollect(CLEAR);

    expect(types(events).filter((type) => type === "crisis_card")).toHaveLength(1);
  });

  it("doesn't let Claude loop on the tool forever, and keeps the card if it tries", async () => {
    backend.claude.willReply(raisesCard(), raisesCard(), raisesCard(), raisesCard(), raisesCard());

    const events = await backend.sendAndCollect("Everything feels pointless lately");

    expect(types(events)).toEqual(["crisis_card", "done"]);
    expect(events.at(-1).reply.text).toMatch(/card/i);
    expect(backend.claude.requests.length).toBeLessThan(5);
  });

  it("uses Buddy's own note if Claude fails after raising the card", async () => {
    backend.claude.willReply(raisesCard(), { failWith: new Error("overloaded") }, { chunks: ["Okay."] });

    const events = await backend.sendAndCollect("Everything feels pointless lately");
    await backend.sendAndCollect("Hello?");

    expect(types(events)).toEqual(["crisis_card", "done"]);
    expect(events.at(-1).reply.text).toMatch(/card/i);
    const roles = chatRequests().at(-1)!.messages.map((message) => message.role);
    expect(roles).toEqual(["user", "assistant", "user", "system"]);
  });

  it("uses Buddy's own note if Claude refuses after raising the card, leaving no unanswered call", async () => {
    backend.claude.willReply(raisesCard(), { content: [], stopReason: "refusal" }, { chunks: ["Okay."] });

    const events = await backend.sendAndCollect("Everything feels pointless lately");
    await backend.sendAndCollect("Hello?");

    expect(events.at(-1).reply.text).not.toMatch(/can't help/i);
    expect(JSON.stringify(chatRequests().at(-1)!.messages)).not.toContain("tool_use");
  });

  it("answers a tool it doesn't know with an error, without showing the card", async () => {
    backend.claude.willReply(
      { content: [toolUseBlock("send_email", { to: "dean@temple.edu" })], stopReason: "tool_use" },
      { chunks: ["Sorry, I can't do that."] },
    );

    const events = await backend.sendAndCollect("Email the dean");

    expect(types(events)).toEqual(["text", "done"]);
    expect(chatRequests()[1]!.messages.at(-1)!.content).toMatchObject([{ type: "tool_result", is_error: true }]);
  });

  it("only answers the calls the API still sees after a fallback model took over", async () => {
    const before = toolUseBlock("show_crisis_card", {});
    const fallback = { type: "fallback", from: { model: "a" }, to: { model: "b" } } as any;
    const after = toolUseBlock("show_crisis_card", {});
    backend.claude.willReply({ content: [before, fallback, after], stopReason: "tool_use" }, { chunks: ["I'm here."] });

    await backend.sendAndCollect("Everything feels pointless lately");

    const messages = chatRequests()[1]!.messages;
    expect(messages.at(-2)!.content).toEqual([fallback, after]);
    expect(messages.at(-1)!.content).toMatchObject([{ type: "tool_result", tool_use_id: after.id }]);
  });
});
