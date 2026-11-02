import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConversation } from "../src/conversation.ts";
import { createCrisisCheck } from "../src/crisis-check.ts";
import { openStore, type Store } from "../src/store.ts";
import { MovableClock } from "./support/movable-clock.ts";
import { ScriptedClaude } from "./support/scripted-claude.ts";

const CLEAR = "I want to kill myself";

let directory: string;
let store: Store;
let claude: ScriptedClaude;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "buddy-test-"));
  store = openStore(join(directory, "buddy.sqlite"));
  claude = new ScriptedClaude();
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function send(text: string, storeInUse: Store): Promise<any[]> {
  const logError = () => {};
  const conversation = createConversation({
    claude,
    clock: new MovableClock("2026-11-02T14:00:00Z"),
    store: storeInUse,
    chatModel: "chat",
    crisisCheck: createCrisisCheck({ claude, model: "crisis", timeoutMs: 50, logError }),
    logError,
  });
  return Array.fromAsync(conversation.send(text));
}

describe("when the database can't save", () => {
  it("still shows the card if the card can't be saved, and Claude still replies", async () => {
    claude.willReply({ chunks: ["I'm here."] });
    const failingStore = Object.assign(Object.create(store), {
      addCrisisCard() {
        throw new Error("disk full");
      },
    });

    const events = await send(CLEAR, failingStore);

    expect(events.map((event) => event.type)).toEqual(["crisis_card", "text", "done"]);
  });

  it("still shows the card if the Student's message can't be saved, with Buddy's note", async () => {
    const failingStore = Object.assign(Object.create(store), {
      appendMessages() {
        throw new Error("disk full");
      },
    });

    const events = await send(CLEAR, failingStore);

    expect(events.map((event) => event.type)).toEqual(["crisis_card", "error"]);
    expect(events[1].message).toMatch(/card/i);
    expect(claude.requests).toEqual([]);
  });
});
