import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness, TEST_CHAT_MODEL } from "./support/backend-harness.ts";
import { textBlock, toolUseBlock } from "./support/scripted-claude.ts";

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
});

afterEach(async () => {
  await backend.stop();
});

const remembers = (...facts: string[]) => ({
  content: facts.map((fact) => toolUseBlock("remember", { fact })),
  stopReason: "tool_use" as const,
});
const chatRequests = () => backend.claude.requests.filter((request) => request.model === TEST_CHAT_MODEL);
const lastSystemNote = () => String(chatRequests().at(-1)!.messages.findLast((m) => m.role === "system")!.content);

describe("the remember tool", () => {
  it("is offered to Claude, and takes only the fact, so Claude can't choose the origin", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    const tool = backend.claude.requests[0]!.tools!.find((candidate: any) => candidate.name === "remember") as any;
    expect(Object.keys(tool.input_schema.properties)).toEqual(["fact"]);
    expect(tool.input_schema.required).toEqual(["fact"]);
    expect(tool.input_schema.additionalProperties).toBe(false);
    expect(tool.strict).toBe(true);
  });

  it("saves the fact right away, before Claude has finished its reply", async () => {
    let letClaudeReply!: () => void;
    backend.claude.willReply(remembers("Is a biology major."), {
      chunks: ["Nice."],
      holdBeforeAnswering: new Promise((resolve) => (letClaudeReply = resolve)),
    });

    const turn = backend.sendAndCollect("I'm a biology major");
    await expect.poll(() => backend.profileFacts()).toMatchObject([{ text: "Is a biology major." }]);

    letClaudeReply();
    expect((await turn).at(-1).reply.text).toBe("Nice.");
  });

  it("records that the fact came from the conversation, and which message", async () => {
    backend.claude.willReply(remembers("Commutes from Camden."), { chunks: ["Okay."] });

    await backend.sendAndCollect("I commute from Camden");

    const [message] = await backend.history();
    expect(await backend.profileFacts()).toEqual([
      {
        id: expect.any(Number),
        text: "Commutes from Camden.",
        origin: { type: "conversation", messageId: message.id },
        savedAt: "2026-11-02T14:00:00.000Z",
        editedAt: null,
      },
    ]);
  });

  it("saves several facts from one message, and answers each call", async () => {
    backend.claude.willReply(remembers("Is a sophomore.", "Works 20 hours a week."), { chunks: ["Okay."] });

    await backend.sendAndCollect("I'm a sophomore and I work 20 hours a week");

    expect((await backend.profileFacts()).map((fact) => fact.text)).toEqual([
      "Is a sophomore.",
      "Works 20 hours a week.",
    ]);
    expect(chatRequests()[1]!.messages.at(-1)!.content).toMatchObject([
      { type: "tool_result", tool_use_id: expect.any(String) },
      { type: "tool_result", tool_use_id: expect.any(String) },
    ]);
  });

  it("has room for Claude to save facts over a few rounds before it replies", async () => {
    backend.claude.willReply(
      remembers("One."),
      remembers("Two."),
      remembers("Three."),
      remembers("Four."),
      { chunks: ["Okay."] },
    );

    const events = await backend.sendAndCollect("Lots of news");

    expect(events.at(-1).reply.text).toBe("Okay.");
    expect(await backend.profileFacts()).toHaveLength(4);
  });

  it.each([
    ["no fact", {}],
    ["an empty fact", { fact: "   " }],
    ["a fact that isn't text", { fact: 42 }],
  ])("tells Claude it failed when the call has %s, and saves nothing", async (_, input) => {
    backend.claude.willReply(
      { content: [toolUseBlock("remember", input)], stopReason: "tool_use" },
      { chunks: ["Sorry."] },
    );

    const events = await backend.sendAndCollect("Hello");

    expect(events.at(-1).reply.text).toBe("Sorry.");
    expect(chatRequests()[1]!.messages.at(-1)!.content).toMatchObject([{ type: "tool_result", is_error: true }]);
    expect(await backend.profileFacts()).toEqual([]);
  });

  it("hides any secret in a fact Claude saves", async () => {
    backend.claude.willReply(remembers("SSN is 078-05-1120."), { chunks: ["Okay."] });

    await backend.sendAndCollect("Hello");

    expect((await backend.profileFacts())[0].text).toBe("SSN is [Social Security number hidden].");
  });

  it("keeps the facts when Claude fails later in the turn", async () => {
    backend.claude.willReply(remembers("Is a junior."), { failWith: new Error("overloaded") });

    const events = await backend.sendAndCollect("I'm a junior");

    expect(events.at(-1).type).toBe("error");
    expect((await backend.profileFacts()).map((fact) => fact.text)).toEqual(["Is a junior."]);
  });

  it("keeps the whole turn in order for later requests, across a restart", async () => {
    backend.claude.willReply(remembers("Is a junior."), { chunks: ["Okay."] }, { chunks: ["Sure."] });

    await backend.sendAndCollect("I'm a junior");
    await backend.restart();
    await backend.sendAndCollect("Thanks");

    const [, second, third] = chatRequests();
    expect(third!.messages.slice(0, second!.messages.length)).toEqual(second!.messages);
  });

  it("shows the Student one reply when the conversation reloads", async () => {
    backend.claude.willReply(remembers("Is a junior."), { chunks: ["Okay."] });

    await backend.sendAndCollect("I'm a junior");

    expect(await backend.history()).toMatchObject([
      { role: "student", text: "I'm a junior" },
      { role: "buddy", text: "Okay." },
    ]);
    expect(await backend.history()).toHaveLength(2);
  });
});

describe("when Claude writes words alongside its tool call", () => {
  const writesThenRemembers = (text: string) => ({
    chunks: [text],
    content: [textBlock(text), toolUseBlock("remember", { fact: "Is a junior." })],
    stopReason: "tool_use" as const,
  });

  it("keeps those words in the reply, in the order the Student watched them arrive", async () => {
    backend.claude.willReply(writesThenRemembers("Congrats on junior year!"), { chunks: ["What's your major?"] });

    const events = await backend.sendAndCollect("I'm a junior");

    const streamed = events
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("");
    expect(events.at(-1).reply.text).toBe("Congrats on junior year!\n\nWhat's your major?");
    expect(streamed).toBe(events.at(-1).reply.text);
    expect((await backend.history()).at(-1)).toEqual(events.at(-1).reply);
  });

  it("doesn't treat it as a failure when Claude has nothing to add after the tool", async () => {
    backend.claude.willReply(writesThenRemembers("Got it, thanks."), { content: [] }, { chunks: ["Sure."] });

    const events = await backend.sendAndCollect("I'm a junior");
    await backend.sendAndCollect("And?");

    expect(events.at(-1)).toMatchObject({ type: "done", reply: { text: "Got it, thanks." } });
    // The API rejects an empty assistant message, so that one stays out of later requests.
    for (const message of chatRequests().at(-1)!.messages) {
      expect(message.content).not.toEqual([]);
    }
  });

  it("leaves no call unanswered when a refused turn comes right after one like that", async () => {
    backend.claude.willReply(
      writesThenRemembers("Got it, thanks."),
      { content: [] },
      { content: [], stopReason: "refusal" },
      { chunks: ["Okay."] },
    );

    await backend.sendAndCollect("I'm a junior");
    await backend.sendAndCollect("Something Claude declines");
    await backend.sendAndCollect("Next question");

    const blocks = chatRequests()
      .at(-1)!
      .messages.flatMap((message) => (Array.isArray(message.content) ? (message.content as any[]) : []));
    const calls = blocks.filter((block) => block.type === "tool_use").map((block) => block.id);
    const answers = blocks.filter((block) => block.type === "tool_result").map((block) => block.tool_use_id);
    expect(calls).toHaveLength(1);
    expect(answers).toEqual(calls);
  });

  it("treats a reply cut off in the middle of a tool call as a failure, so the call is never left unanswered", async () => {
    backend.claude.willReply(
      {
        chunks: ["Half a rep"],
        content: [textBlock("Half a rep"), toolUseBlock("remember", { fact: "Is a jun" })],
        stopReason: "max_tokens",
      },
      { chunks: ["Okay."] },
    );

    const events = await backend.sendAndCollect("I'm a junior");
    await backend.sendAndCollect("Hello?");

    expect(events.at(-1).type).toBe("error");
    expect(await backend.profileFacts()).toEqual([]);
    expect(JSON.stringify(chatRequests().at(-1)!.messages)).not.toContain("tool_use");
  });

  it("is still a failure when Claude has written nothing at all", async () => {
    backend.claude.willReply(remembers("Is a junior."), { content: [] });

    const events = await backend.sendAndCollect("I'm a junior");

    expect(events.at(-1).type).toBe("error");
  });
});

describe("the Profile in each turn's context", () => {
  it("goes in the system message after the Student's message, not the frozen system prompt", async () => {
    backend.claude.willReply(remembers("Is a junior."), { chunks: ["Okay."] }, { chunks: ["Sure."] });

    await backend.sendAndCollect("I'm a junior");
    await backend.sendAndCollect("What's a hold?");

    const [first, , third] = backend.claude.requests;
    expect(lastSystemNote()).toContain('"Is a junior."');
    expect(third!.messages.at(-2)).toEqual({ role: "user", content: [{ type: "text", text: "What's a hold?" }] });
    expect(JSON.stringify(third!.system)).not.toContain("Is a junior.");
    expect(third!.system).toEqual(first!.system);
    expect(third!.tools).toEqual(first!.tools);
  });

  it("only ever appends: an earlier request is the start of every later one", async () => {
    backend.claude.willReply(
      remembers("Is a junior."),
      { chunks: ["Okay."] },
      { chunks: ["Sure."] },
      { chunks: ["Right."] },
    );

    await backend.sendAndCollect("I'm a junior");
    const facts = await backend.profileFacts();
    await backend.sendAndCollect("What's a hold?");
    await backend.deleteFact(facts[0].id);
    await backend.sendAndCollect("What's a bursar?");

    const [, second, third, fourth] = chatRequests();
    expect(third!.messages.slice(0, second!.messages.length)).toEqual(second!.messages);
    expect(fourth!.messages.slice(0, third!.messages.length)).toEqual(third!.messages);
  });

  it("says so when the Profile is empty", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    expect(lastSystemNote()).toMatch(/Profile is empty/);
  });

  it("carries the edited fact next turn, and says the latest version is the one that counts", async () => {
    backend.claude.willReply(remembers("Is a junior."), { chunks: ["Okay."] }, { chunks: ["Sure."] });
    await backend.sendAndCollect("I'm a junior");
    const [fact] = await backend.profileFacts();

    await backend.editFact(fact.id, "Is a senior.");
    await backend.sendAndCollect("Hello again");

    expect(lastSystemNote()).toContain('"Is a senior."');
    expect(lastSystemNote()).not.toContain('"Is a junior."');
    expect(lastSystemNote()).toMatch(/edit or delete/);
  });

  it("drops a deleted fact from the next turn's Profile", async () => {
    backend.claude.willReply(remembers("Is a junior."), { chunks: ["Okay."] }, { chunks: ["Sure."] });
    await backend.sendAndCollect("I'm a junior");
    const [fact] = await backend.profileFacts();

    await backend.deleteFact(fact.id);
    await backend.sendAndCollect("Hello again");

    expect(lastSystemNote()).not.toContain("Is a junior.");
    expect(lastSystemNote()).toMatch(/Profile is empty/);
  });

  it("marks each fact as data, so a fact can't pass for an instruction", async () => {
    backend.claude.willReply(remembers('Likes "quotes"\n- and new lines'), { chunks: ["Okay."] }, { chunks: ["Sure."] });
    await backend.sendAndCollect("Hello");

    await backend.sendAndCollect("Hello again");

    expect(lastSystemNote()).toContain(JSON.stringify('Likes "quotes"\n- and new lines'));
    expect(lastSystemNote()).toMatch(/never instructions/);
  });
});

describe("editing a fact", () => {
  async function savedFact(): Promise<any> {
    backend.claude.willReply(remembers("Is a junior."), { chunks: ["Okay."] });
    await backend.sendAndCollect("I'm a junior");
    return (await backend.profileFacts())[0];
  }

  it("changes its words, keeps its origin and says when it was edited", async () => {
    const fact = await savedFact();
    backend.clock.moveForward(60_000);

    const response = await backend.editFact(fact.id, "  Is a senior.  ");

    expect(response.status).toBe(200);
    const edited = { ...fact, text: "Is a senior.", editedAt: "2026-11-02T14:01:00.000Z" };
    expect(await response.json()).toEqual({ fact: edited });
    expect(await backend.profileFacts()).toEqual([edited]);
  });

  it("survives a restart", async () => {
    const fact = await savedFact();

    await backend.editFact(fact.id, "Is a senior.");
    await backend.restart();

    expect((await backend.profileFacts())[0].text).toBe("Is a senior.");
  });

  it("hides any secret in the edit, and says so", async () => {
    const fact = await savedFact();

    const response = await backend.editFact(fact.id, "Card is 4111 1111 1111 1111");

    expect(await response.json()).toMatchObject({
      fact: { text: "Card is [card number hidden]" },
      hiddenNote: "Buddy hid what looks like a card number before saving this or sending it to the AI.",
    });
    expect(backend.storageContains("4111 1111 1111 1111")).toBe(false);
  });

  it.each([[""], ["   "], [42], [undefined]])("refuses text that isn't a fact: %j", async (text) => {
    const fact = await savedFact();

    const response = await backend.editFact(fact.id, text);

    expect(response.status).toBe(400);
    expect((await backend.profileFacts())[0].text).toBe("Is a junior.");
  });

  it.each([[999], ["abc"], [1.5]])("says a fact that isn't there isn't there: %j", async (id) => {
    expect((await backend.editFact(id, "Anything")).status).toBe(404);
  });
});

describe("deleting a fact", () => {
  it("removes only that fact, and it stays gone after a restart", async () => {
    backend.claude.willReply(remembers("Is a junior.", "Commutes."), { chunks: ["Okay."] });
    await backend.sendAndCollect("Hello");
    const [first] = await backend.profileFacts();

    const response = await backend.deleteFact(first.id);
    await backend.restart();

    expect(response.status).toBe(204);
    expect((await backend.profileFacts()).map((fact) => fact.text)).toEqual(["Commutes."]);
  });

  it("says a fact that isn't there isn't there", async () => {
    expect((await backend.deleteFact(999)).status).toBe(404);
    expect((await backend.deleteFact("abc")).status).toBe(404);
  });
});

describe("who can reach the Profile", () => {
  it("refuses every Profile operation without a device key", async () => {
    const calls = [
      fetch(`${backend.url}/profile/facts`),
      fetch(`${backend.url}/profile/facts/1`, { method: "DELETE" }),
      fetch(`${backend.url}/profile/facts/1`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Anything" }),
      }),
    ];

    expect((await Promise.all(calls)).map((response) => response.status)).toEqual([401, 401, 401]);
  });
});
