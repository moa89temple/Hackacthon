import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness, CALENDAR, SECRET_ADDRESS, TEST_SITE } from "./support/backend-harness.ts";
import { classifierAnswer, textBlock, toolUseBlock } from "./support/scripted-claude.ts";

const studentCalendar = readFileSync(new URL("fixtures/student-calendar.ics", import.meta.url), "utf8");
const HOUR = 3_600_000;

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
  backend.web.save(SECRET_ADDRESS, studentCalendar);
});

afterEach(async () => {
  await backend.stop();
});

const connect = () => backend.giveReadPermission(CALENDAR, SECRET_ADDRESS);

describe("Read Permissions in Activity", () => {
  it("starts empty", async () => {
    expect(await backend.activity()).toEqual([]);
  });

  it("records a Read Permission given", async () => {
    await connect();

    expect((await backend.activity()).at(-1)).toMatchObject({
      kind: "read_permission_given",
      title: "You gave Buddy a Read Permission for Google Calendar",
      at: "2026-11-02T14:00:00.000Z",
    });
  });

  it("records nothing when the address is refused", async () => {
    await backend.giveReadPermission(CALENDAR, "https://example.test/not-a-calendar.ics");

    expect(await backend.activity()).toEqual([]);
  });

  it("records a Read Permission revoked, and says what went with it", async () => {
    await connect();

    await backend.revokeReadPermission(CALENDAR);

    const [newest] = await backend.activity();
    expect(newest).toMatchObject({
      kind: "read_permission_revoked",
      title: "You revoked the Read Permission for Google Calendar",
    });
    expect(newest.detail).toMatch(/deleted the address and every fact/);
  });

  it("records a revoke only when there was a Read Permission to revoke", async () => {
    await backend.revokeReadPermission(CALENDAR);

    expect(await backend.activity()).toEqual([]);
  });

  it("keeps each giving and revoking, however many times", async () => {
    await connect();
    await backend.revokeReadPermission(CALENDAR);
    await connect();

    const kinds = (await backend.activity()).map((entry) => entry.kind).filter((kind) => kind.startsWith("read_permission"));
    expect(kinds).toEqual(["read_permission_given", "read_permission_revoked", "read_permission_given"]);
  });
});

describe("Connection reads in Activity", () => {
  const reads = async () => (await backend.activity()).filter((entry) => entry.kind.startsWith("connection_read"));

  it("records the read that follows giving the Read Permission, and why it happened", async () => {
    await connect();

    expect(await reads()).toEqual([
      expect.objectContaining({
        kind: "connection_read",
        title: "Buddy read Google Calendar",
        detail: "You had just given its Read Permission.",
      }),
    ]);
  });

  it("records a read the Student asked for", async () => {
    await connect();

    await backend.readNow(CALENDAR);

    expect((await reads())[0].detail).toBe("You tapped Read now.");
  });

  it("records a read on the schedule", async () => {
    await connect();
    backend.clock.moveForward(6 * HOUR);

    await backend.readDueConnections();

    expect((await reads())[0]).toMatchObject({
      detail: "It was one of Buddy's regular read times.",
      at: "2026-11-02T20:00:00.000Z",
    });
  });

  it("records a read that failed, with what went wrong", async () => {
    await connect();
    backend.web.unreachable = true;

    await backend.readNow(CALENDAR);

    const [newest] = await reads();
    expect(newest).toMatchObject({ kind: "connection_read_failed", title: "Buddy couldn't read Google Calendar" });
    expect(newest.detail).toMatch(/^You tapped Read now\. Buddy couldn't reach Google Calendar/);
  });

  it("records one read when two share a trip to the web", async () => {
    await connect();
    let finish!: () => void;
    backend.web.hold = new Promise((resolve) => (finish = resolve));
    const before = (await reads()).length;

    const both = Promise.all([backend.readNow(CALENDAR), backend.readNow(CALENDAR)]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    finish();
    await both;

    expect((await reads()).length).toBe(before + 1);
  });

  it("records a read that finished after the Student revoked, because Buddy did read it", async () => {
    await connect();
    let finish!: () => void;
    backend.web.hold = new Promise((resolve) => (finish = resolve));

    const reading = backend.readNow(CALENDAR);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await backend.revokeReadPermission(CALENDAR);
    finish();
    await reading;

    expect((await backend.activity())[0]).toMatchObject({ kind: "connection_read", detail: "You tapped Read now." });
  });

  it("keeps nothing from the calendar for a read alone, so that revoking still removes it from the disk", async () => {
    await connect();

    await backend.revokeReadPermission(CALENDAR);

    expect(JSON.stringify(await backend.activity())).not.toContain("Shift at CVS");
    expect(backend.storageContains("Shift at CVS")).toBe(false);
  });

  it("never keeps the secret address, even when a read fails", async () => {
    await connect();
    backend.web.saved.delete(SECRET_ADDRESS);
    await backend.readNow(CALENDAR);
    await backend.revokeReadPermission(CALENDAR);

    expect(JSON.stringify(await backend.activity())).not.toContain("private-");
    expect(backend.storageContains("private-0123")).toBe(false);
  });

  it("records nothing for a read that was refused", async () => {
    await backend.readNow(CALENDAR);

    expect(await backend.activity()).toEqual([]);
  });
});

describe("how Buddy decided a reply", () => {
  const calls = (name: string, input: unknown) => ({
    content: [toolUseBlock(name, input)],
    stopReason: "tool_use" as const,
  });
  const latestDecision = async () => (await backend.activity()).find((entry) => entry.kind === "reply").decision;
  const replies = async () => (await backend.activity()).filter((entry) => entry.kind === "reply");

  /** A turn where Claude saves one fact, so that later turns have it in the Profile. */
  async function tellBuddy(fact: string): Promise<void> {
    backend.claude.willReply(calls("remember", { fact }), { chunks: ["Got it."] });
    await backend.sendAndCollect("Something about me");
  }

  it("records a plain reply, with no tools, Sources or facts", async () => {
    backend.claude.willReply({ chunks: ["Hi ", "there."] });

    await backend.sendAndCollect("Hello");

    expect((await backend.activity())[0]).toEqual({
      id: expect.any(Number),
      kind: "reply",
      title: "Buddy replied",
      detail: null,
      at: "2026-11-02T14:00:00.000Z",
      decision: { reply: "Hi there.", tools: [], sources: [], facts: [] },
    });
  });

  it("gives each reply its own record", async () => {
    backend.claude.willReply({ chunks: ["One."] }, { chunks: ["Two."] });

    await backend.sendAndCollect("Hello");
    await backend.sendAndCollect("Hello again");

    expect((await replies()).map((entry) => entry.decision.reply)).toEqual(["Two.", "One."]);
  });

  it("shows the words the Student saw when Claude wrote before and after a tool", async () => {
    backend.claude.willReply(
      { content: [textBlock("Let me save that."), toolUseBlock("remember", { fact: "Is a junior." })], stopReason: "tool_use" },
      { chunks: ["Done."] },
    );

    await backend.sendAndCollect("I'm a junior");

    expect((await latestDecision()).reply).toBe("Let me save that.\n\nDone.");
  });

  it("names a fact Buddy saved as something it did, not something it had to go on", async () => {
    await tellBuddy("Is a junior.");

    expect(await latestDecision()).toMatchObject({
      tools: ['Saved this to your Profile: "Is a junior."'],
      facts: [],
    });
  });

  it("says so when a fact couldn't be saved because Claude gave none", async () => {
    backend.claude.willReply(calls("remember", { fact: "  " }), { chunks: ["Okay."] });

    await backend.sendAndCollect("Hello");

    expect((await latestDecision()).tools).toEqual(["Tried to save something to your Profile, but couldn't."]);
  });

  it("lists the Profile facts Buddy had when it wrote the reply", async () => {
    await tellBuddy("Is a junior.");
    backend.claude.willReply({ chunks: ["Okay."] });

    await backend.sendAndCollect("What next?");

    expect((await latestDecision()).facts).toEqual([{ text: "Is a junior.", from: "From your chat" }]);
  });

  it("keeps the fact as it was, even after the Student edits or deletes it", async () => {
    await tellBuddy("Is a junior.");
    await tellBuddy("Commutes.");
    backend.claude.willReply({ chunks: ["Okay."] });
    await backend.sendAndCollect("What next?");
    const [junior, commutes] = await backend.profileFacts();

    await backend.editFact(junior.id, "Is a senior.");
    await backend.deleteFact(commutes.id);

    expect((await latestDecision()).facts.map((fact: any) => fact.text)).toEqual(["Is a junior.", "Commutes."]);
  });

  it("keeps a secret out, because facts are masked before they're saved", async () => {
    await tellBuddy("My password is hunter2swordfish");
    backend.claude.willReply({ chunks: ["Okay."] });
    await backend.sendAndCollect("What next?");

    expect(JSON.stringify(await backend.activity())).not.toContain("hunter2swordfish");
  });

  it("has no Sources yet, because Buddy has no Source to look at until the Guidebook", async () => {
    await connect();
    backend.claude.willReply(calls("check_calendar", { read_again: false }), { chunks: ["Okay."] });

    await backend.sendAndCollect("When am I free?");

    expect((await latestDecision()).sources).toEqual([]);
  });

  describe("with the calendar", () => {
    const checkCalendar = async (input: unknown = { read_again: false }) => {
      backend.claude.willReply(calls("check_calendar", input), { chunks: ["Okay."] });
      await backend.sendAndCollect("When am I free?");
    };

    it("says Buddy looked, and lists what it saw as facts from the calendar", async () => {
      await connect();

      await checkCalendar();

      const { tools, facts } = await latestDecision();
      expect(tools).toEqual(["Looked at what Buddy has from your Google Calendar."]);
      expect(facts).toContainEqual({
        text: "Shift at CVS",
        detail: expect.stringContaining("2:00 PM"),
        from: "From Google Calendar",
      });
    });

    it("leaves the calendar out of a reply that didn't look at it", async () => {
      await connect();
      backend.claude.willReply({ chunks: ["Hi."] });

      await backend.sendAndCollect("Hello");

      expect(await latestDecision()).toMatchObject({ tools: [], facts: [] });
    });

    it("lists each event once when Buddy looks twice in one reply", async () => {
      await connect();
      backend.claude.willReply(
        calls("check_calendar", { read_again: false }),
        calls("check_calendar", { read_again: true }),
        { chunks: ["Okay."] },
      );

      await backend.sendAndCollect("When am I free?");

      const shifts = (await latestDecision()).facts.filter((fact: any) => fact.text === "Shift at CVS");
      expect(shifts).toHaveLength(1);
    });

    it("says Buddy read again, and adds the read itself to Activity", async () => {
      await connect();

      await checkCalendar({ read_again: true });

      expect((await latestDecision()).tools).toEqual(["Read your Google Calendar again and looked at it."]);
      expect((await backend.activity()).find((entry) => entry.kind === "connection_read").detail).toBe(
        "Buddy looked again during your conversation.",
      );
    });

    it("says so when reading again failed and Buddy fell back on the last reading", async () => {
      await connect();
      backend.web.unreachable = true;

      await checkCalendar({ read_again: true });

      expect((await latestDecision()).tools).toEqual([
        "Tried to read your Google Calendar again but couldn't, so looked at the last reading.",
      ]);
    });

    it("says so when the calendar isn't connected, and lists nothing from it", async () => {
      await checkCalendar();

      expect(await latestDecision()).toMatchObject({
        tools: ["Tried to look at your Google Calendar, but it isn't connected."],
        facts: [],
      });
    });

    it("says it showed the Read Permission card", async () => {
      backend.claude.willReply(calls("suggest_connection", { connection: CALENDAR }), { chunks: ["It would help."] });

      await backend.sendAndCollect("When should I study?");

      expect((await latestDecision()).tools).toEqual(["Showed you the Read Permission card for Google Calendar."]);
    });

    it("doesn't claim a card it didn't show", async () => {
      await connect();
      backend.claude.willReply(calls("suggest_connection", { connection: CALENDAR }), { chunks: ["Okay."] });

      await backend.sendAndCollect("When should I study?");

      expect((await latestDecision()).tools).toEqual([
        "Didn't show the Read Permission card for Google Calendar, because it's already connected.",
      ]);
    });

    it("keeps what a reply looked at after the Read Permission is revoked, as the app says it will", async () => {
      await connect();
      await checkCalendar();

      await backend.revokeReadPermission(CALENDAR);

      expect((await replies())[0].decision.facts.map((fact: any) => fact.text)).toContain("Shift at CVS");
    });
  });

  describe("when the safety check or Claude changes the turn", () => {
    const CLEAR = "I want to kill myself";

    it("says the safety check showed the Crisis card", async () => {
      backend.claude.willReply({ chunks: ["I'm here."] });

      await backend.sendAndCollect(CLEAR);

      expect((await latestDecision()).tools).toEqual(["Buddy's safety check showed you the Crisis card."]);
    });

    it("says the safety check asked Buddy to check in", async () => {
      backend.claude.willReply(classifierAnswer("check-in"), { chunks: ["How are you doing?"] });

      await backend.sendAndCollect("I can't do this anymore");

      expect((await latestDecision()).tools).toEqual(["Buddy's safety check asked it to check in with you."]);
    });

    it("says Buddy showed the Crisis card with its tool", async () => {
      backend.claude.willReply(calls("show_crisis_card", {}), { chunks: ["I'm here."] });

      await backend.sendAndCollect("Hello");

      expect((await latestDecision()).tools).toEqual(["Showed you the Crisis card."]);
    });

    it("records the note the Student saw when Claude refuses, and the tools that had already run", async () => {
      backend.claude.willReply(calls("remember", { fact: "Is a junior." }), { content: [], stopReason: "refusal" });

      const events = await backend.sendAndCollect("Hello");

      const decision = await latestDecision();
      expect(decision.reply).toBe(events.at(-1).reply.text);
      expect(decision.tools).toEqual([
        'Saved this to your Profile: "Is a junior."',
        "The AI declined to answer, so Buddy showed a note of its own.",
      ]);
    });

    it("records Buddy's own note when Claude fails beside a Crisis card", async () => {
      backend.claude.willReply({ failWith: new Error("overloaded") });

      const events = await backend.sendAndCollect(CLEAR);

      const decision = await latestDecision();
      expect(decision.reply).toBe(events.at(-1).reply.text);
      expect(decision.tools).toEqual([
        "Buddy's safety check showed you the Crisis card.",
        "The AI's reply didn't come through, so Buddy wrote this note itself.",
      ]);
    });

    it("keeps a record of a turn that ended with no reply, and of what its tools had already done", async () => {
      backend.claude.willReply(calls("remember", { fact: "Is a junior." }), { failWith: new Error("overloaded") });

      const events = await backend.sendAndCollect("Hello");

      expect(events.at(-1).type).toBe("error");
      expect(await replies()).toEqual([]);
      expect((await backend.activity())[0]).toMatchObject({
        kind: "reply_failed",
        title: "Buddy couldn't finish a reply",
        decision: { reply: events.at(-1).message, tools: ['Saved this to your Profile: "Is a junior."'] },
      });
    });

    it("says so when Claude asks for a tool Buddy doesn't have", async () => {
      backend.claude.willReply(calls("send_email", { to: "someone" }), { chunks: ["Okay."] });

      await backend.sendAndCollect("Hello");

      expect((await latestDecision()).tools).toEqual(["Tried to use a tool Buddy doesn't have."]);
    });
  });
});

describe("the login check after a Takeover", () => {
  it("records that Buddy opened the site, but not what was on the page", async () => {
    backend.browser.savedPages.set(TEST_SITE.homeUrl, {
      title: "Private dashboard title",
      text: "",
      accessibilitySnapshot: "",
    });
    await backend.startTakeover("canvas");
    expect(await backend.activity()).toEqual([]);

    await backend.finishTakeover();

    const entries = await backend.activity();
    expect(entries).toEqual([
      expect.objectContaining({ kind: "login_check", title: "Buddy opened Canvas to check your login" }),
    ]);
    expect(JSON.stringify(entries)).not.toContain("Private dashboard title");
  });

  it("records nothing when Buddy couldn't open the site", async () => {
    await backend.startTakeover("canvas");
    backend.browser.unreachable = true;

    await backend.finishTakeover();

    expect(await backend.activity()).toEqual([]);
  });
});

describe("Activity only ever grows", () => {
  const request = (method: string, path: string) =>
    fetch(`${backend.url}${path}`, {
      method,
      headers: backend.deviceHeaders,
    });

  it("has no way to change, remove or add an entry", async () => {
    await connect();
    const before = await backend.activity();
    const id = before[0].id;

    const statuses = await Promise.all([
      request("PATCH", `/activity/${id}`),
      request("PUT", `/activity/${id}`),
      request("DELETE", `/activity/${id}`),
      request("DELETE", "/activity"),
      request("POST", "/activity"),
    ]);

    expect(statuses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
    expect(await backend.activity()).toEqual(before);
  });

  it("is still there after a restart", async () => {
    await connect();
    const before = await backend.activity();

    await backend.restart();

    expect(await backend.activity()).toEqual(before);
  });

  it("is still there after the Read Permission it describes is gone", async () => {
    await connect();
    const before = await backend.activity();

    await backend.revokeReadPermission(CALENDAR);

    expect((await backend.activity()).slice(1)).toEqual(before);
  });

  it("is refused without a device key", async () => {
    expect((await fetch(`${backend.url}/activity`)).status).toBe(401);
  });
});
