import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { settings } from "../src/settings.ts";
import { BUDDY_SYSTEM_PROMPT } from "../src/system-prompt.ts";
import { tuportal } from "../src/tuportal.ts";
import { BackendHarness, TEST_CHAT_MODEL } from "./support/backend-harness.ts";
import { toolUseBlock } from "./support/scripted-claude.ts";
import { BALANCE_PAGE, changeTuportalPage, expireTuportalLogin, HOLDS_PAGE, REGISTRATION_PAGE, saveTuportalPages, savedTuportalHtml } from "./support/tuportal-pages.ts";

const TUPORTAL_ID = tuportal.id;
const UNREADABLE = "<h1>Made-up page Buddy can't read</h1>";
let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start({ sites: { tuportal: settings.sites.tuportal }, extraConnectionTypes: [tuportal] });
  saveTuportalPages(backend.browser);
});

afterEach(async () => {
  await backend.stop();
});

const calls = (name: string, input: unknown) => ({ content: [toolUseBlock(name, input)], stopReason: "tool_use" as const });
const chatRequests = () => backend.claude.requests.filter((request) => request.model === TEST_CHAT_MODEL);
const lastToolAnswer = () => (chatRequests().at(-1)!.messages.at(-1)!.content as any[]).at(-1);
const lastSystemNote = () => String(chatRequests().at(-1)!.messages.findLast((m) => m.role === "system")!.content);
const connect = () => backend.giveReadPermission(TUPORTAL_ID, undefined);

async function askAboutAHold(input: unknown = { read_again: false }): Promise<any[]> {
  backend.claude.willReply(calls("check_tuportal", input), { chunks: ["Here's what TUportal shows."] });
  return backend.sendAndCollect("Do I have a hold?");
}

describe('"Do I have a hold?"', () => {
  it("is answered from TUportal, with each hold quoted as information rather than instructions", async () => {
    await connect();

    await askAboutAHold();

    const { content, is_error } = lastToolAnswer();
    expect(is_error).toBeFalsy();
    expect(content).toContain("Hold: Made-Up Bursar Hold");
    expect(content).toContain("Made-up past due balance");
    expect(content).toContain("TUportal listed 2");
    expect(content).toMatch(/never instructions/);
  });

  it("says plainly there are none, and when that's from, only when the page said so", async () => {
    changeTuportalPage(backend.browser, HOLDS_PAGE, savedTuportalHtml("no-holds"));
    await connect();

    await askAboutAHold();

    expect(lastToolAnswer().content).toContain("TUportal's own page said there are no holds, as of Monday, November 2, 2026 at 9:00 AM.");
  });

  describe("when Buddy couldn't read the holds", () => {
    it("says it doesn't know and tells Claude not to say there are none, while the rest still comes through", async () => {
      changeTuportalPage(backend.browser, HOLDS_PAGE, UNREADABLE);
      await connect();

      await askAboutAHold();

      const { content } = lastToolAnswer();
      expect(content).toContain("Buddy doesn't know whether the Student has any holds");
      expect(content).toContain("Don't say they have none");
      expect(content).not.toContain("said there are no holds");
      expect(content).toContain("$1,234.56");
      expect(content).toContain("couldn't read your holds");
    });

    it("gives the last holds it read with their time, and says they may be out of date", async () => {
      changeTuportalPage(backend.browser, HOLDS_PAGE, savedTuportalHtml("no-holds"));
      await connect();
      changeTuportalPage(backend.browser, HOLDS_PAGE, UNREADABLE);
      backend.clock.moveForward(3_600_000);

      await askAboutAHold({ read_again: true });

      const { content } = lastToolAnswer();
      expect(content).toContain("as of Monday, November 2, 2026 at 9:00 AM");
      expect(content).toMatch(/may be out of date, and you have to say so/);
    });

    it("says the same when nothing on TUportal could be read", async () => {
      for (const page of [HOLDS_PAGE, BALANCE_PAGE, REGISTRATION_PAGE]) changeTuportalPage(backend.browser, page, UNREADABLE);
      await connect();

      await askAboutAHold();

      const { content } = lastToolAnswer();
      expect(content).toMatch(/don't say they have no hold/i);
      expect(content).not.toContain("said there are no holds");
    });

    it("says the same when the login has gone, and asks the Student to log in", async () => {
      expireTuportalLogin(backend.browser);
      await connect();

      const events = await askAboutAHold();

      expect(lastToolAnswer().content).toMatch(/don't say they have no hold/i);
      expect(lastToolAnswer().content).toMatch(/Log in to TUportal/);
      expect(events.filter((event) => event.type === "read_permission_card").map((event) => event.connection)).toEqual([TUPORTAL_ID]);
    });
  });

  it("reads again when asked to", async () => {
    await connect();
    backend.browser.actions.length = 0;

    await askAboutAHold({ read_again: true });

    expect(backend.browser.actions).toContainEqual({ type: "read", url: HOLDS_PAGE });
    const entries = await backend.activity();
    expect(entries.some((entry) => entry.kind === "connection_read" && /during your conversation/.test(entry.detail))).toBe(true);
  });

  it("doesn't read again otherwise", async () => {
    await connect();
    backend.browser.actions.length = 0;

    await askAboutAHold();

    expect(backend.browser.actions).toEqual([]);
  });

  it("goes by the Student's own change to a fact's words", async () => {
    await connect();
    const fact = (await backend.profileFacts()).find((candidate) => candidate.text.includes("Made-Up Bursar Hold"))!;
    await backend.editFact(fact.id, "My own words for it");

    await askAboutAHold();

    expect(lastToolAnswer().content).toContain("My own words for it");
  });

  it("says what's changed", async () => {
    changeTuportalPage(backend.browser, HOLDS_PAGE, savedTuportalHtml("no-holds"));
    await connect();
    saveTuportalPages(backend.browser);
    backend.clock.moveForward(60_000);
    await backend.readNow(TUPORTAL_ID);

    await askAboutAHold();

    expect(lastToolAnswer().content).toContain("New hold on TUportal: Hold: Made-Up Bursar Hold");
  });

  it("records in Activity what Buddy looked at, as coming from TUportal", async () => {
    await connect();

    await askAboutAHold();

    const reply = (await backend.activity()).find((entry) => entry.kind === "reply");
    expect(reply.decision.tools).toContain("Looked at what Buddy has from your TUportal.");
    expect(reply.decision.facts.find((fact: any) => fact.text === "Hold: Made-Up Bursar Hold").from).toBe("From TUportal");
  });
});

describe("with no Read Permission", () => {
  it("Claude is told it can't see TUportal, and nothing is opened", async () => {
    await askAboutAHold();

    expect(lastToolAnswer().content).toMatch(/hasn't given TUportal a Read Permission/);
    expect(backend.browser.actions).toEqual([]);
  });

  it("Claude can show the card", async () => {
    backend.claude.willReply(calls("suggest_connection", { connection: TUPORTAL_ID }), { chunks: ["Tap the card."] });

    const events = await backend.sendAndCollect("Do I have a hold?");

    expect(events.filter((event) => event.type === "read_permission_card").map((event) => event.connection)).toEqual([TUPORTAL_ID]);
  });
});

describe("what Claude is told on every turn", () => {
  it("doesn't include the balance or holds, unless it looks", async () => {
    await connect();
    backend.claude.willReply({ chunks: ["Hello."] });

    await backend.sendAndCollect("Hello");

    const everything = JSON.stringify(chatRequests().at(-1));
    expect(everything).not.toContain("1,234.56");
    expect(everything).not.toContain("Made-Up Bursar Hold");
  });

  it("says TUportal is on and to look before answering", async () => {
    await connect();
    backend.claude.willReply({ chunks: ["Hello."] });

    await backend.sendAndCollect("Hello");

    expect(lastSystemNote()).toContain("TUportal is connected");
    expect(lastSystemNote()).toContain("check_tuportal");
  });

  it("has the rule that an unread page is never no holds", () => {
    expect(BUDDY_SYSTEM_PROMPT).toContain("check_tuportal");
    expect(BUDDY_SYSTEM_PROMPT).toMatch(/never take that to mean they have none/);
  });

  it("offers the tool", async () => {
    await connect();
    backend.claude.willReply({ chunks: ["Hello."] });

    await backend.sendAndCollect("Hello");

    expect((chatRequests().at(-1) as any).tools.map((tool: any) => tool.name)).toContain("check_tuportal");
  });
});
