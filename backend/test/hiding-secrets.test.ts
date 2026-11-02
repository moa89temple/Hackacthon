import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness, TEST_CHAT_MODEL, TEST_CRISIS_MODEL } from "./support/backend-harness.ts";
import { classifierAnswer } from "./support/scripted-claude.ts";

const SSN = "078-05-1120";
const CARD = "4111 1111 1111 1111";
const PASSWORD = "hunter2swordfish";
const ALL_SECRETS = `my ssn is ${SSN}, my card is ${CARD}, and my password is ${PASSWORD} ok`;
const MASKED =
  "my ssn is [Social Security number hidden], my card is [card number hidden], and my password is [password hidden] ok";
const NOTE =
  "Buddy hid what looks like a password, a Social Security number and a card number before saving this or sending it to the AI.";

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
});

afterEach(async () => {
  await backend.stop();
});

function expectNoSecretsIn(text: string): void {
  expect(text).not.toContain(SSN);
  expect(text).not.toContain(CARD);
  expect(text).not.toContain(PASSWORD);
}

describe("secrets the Student types", () => {
  it("never reach Claude", async () => {
    backend.claude.willReply({ chunks: ["Thanks."] });

    await backend.sendAndCollect(ALL_SECRETS);

    expect(backend.claude.requests[0]!.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: MASKED }] });
    expectNoSecretsIn(JSON.stringify(backend.claude.requests));
  });

  it("never reach the Crisis classifier, which is Claude too", async () => {
    backend.claude.willReply(classifierAnswer("nothing"), { chunks: ["Okay."] });

    await backend.sendAndCollect(`I can't do this anymore, my password is ${PASSWORD}`);

    expect(backend.claude.requests[0]!.model).toBe(TEST_CRISIS_MODEL);
    expect(backend.claude.requests[1]!.model).toBe(TEST_CHAT_MODEL);
    expect(JSON.stringify(backend.claude.requests)).not.toContain(PASSWORD);
  });

  it("never reach storage", async () => {
    backend.claude.willReply({ chunks: ["Thanks."] });

    await backend.sendAndCollect(`${ALL_SECRETS} sophomore-marker`);

    // The marker sat in the same message, so this shows the search can find what was saved.
    expect(backend.storageContains("sophomore-marker")).toBe(true);
    expect(backend.storageContains(SSN)).toBe(false);
    expect(backend.storageContains(CARD)).toBe(false);
    expect(backend.storageContains(PASSWORD)).toBe(false);
  });

  it("stay out of later turns too", async () => {
    backend.claude.willReply({ chunks: ["Thanks."] }, { chunks: ["Sure."] });

    await backend.sendAndCollect(ALL_SECRETS);
    await backend.sendAndCollect("What's a hold?");

    expectNoSecretsIn(JSON.stringify(backend.claude.requests[1]));
  });

  it("stay hidden when Claude fails, so a failed turn saves nothing it shouldn't", async () => {
    backend.claude.willReply({ failWith: new Error("overloaded") });

    await backend.sendAndCollect(ALL_SECRETS);

    expect(backend.storageContains(PASSWORD)).toBe(false);
    expect(await backend.history()).toMatchObject([{ role: "student", text: MASKED }]);
  });
});

describe("the note to the Student", () => {
  it("comes first in the turn, with the message as Buddy kept it", async () => {
    backend.claude.willReply({ chunks: ["Thanks."] });

    const events = await backend.sendAndCollect(ALL_SECRETS);

    expect(events[0]).toEqual({ type: "hidden", text: MASKED, note: NOTE });
    expect(events.map((event) => event.type)).toEqual(["hidden", "text", "done"]);
  });

  it("comes ahead of the Crisis card, which still shows", async () => {
    backend.claude.willReply({ chunks: ["I'm here."] });

    const events = await backend.sendAndCollect(`I want to kill myself, my password is ${PASSWORD}`);

    expect(events.map((event) => event.type)).toEqual(["hidden", "crisis_card", "text", "done"]);
  });

  it("is still there when the conversation is reloaded after a restart", async () => {
    backend.claude.willReply({ chunks: ["Thanks."] });

    await backend.sendAndCollect(ALL_SECRETS);
    await backend.restart();

    expect((await backend.history())[0]).toMatchObject({ role: "student", text: MASKED, hiddenNote: NOTE });
  });

  it("isn't sent when nothing was hidden", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    const events = await backend.sendAndCollect("Hello");

    expect(events.map((event) => event.type)).toEqual(["text", "done"]);
    expect((await backend.history())[0]).not.toHaveProperty("hiddenNote");
  });
});
