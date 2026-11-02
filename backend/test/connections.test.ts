import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness, CALENDAR, SECRET_ADDRESS, WARNED_CONNECTION } from "./support/backend-harness.ts";

const studentCalendar = readFileSync(new URL("fixtures/student-calendar.ics", import.meta.url), "utf8");

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
  backend.web.save(SECRET_ADDRESS, studentCalendar);
});

afterEach(async () => {
  await backend.stop();
});

const HOUR = 3_600_000;
const calendarStatus = async () => (await backend.connections()).find((connection) => connection.id === CALENDAR);
const connect = () => backend.giveReadPermission(CALENDAR, SECRET_ADDRESS);
const calendarFacts = async () => (await backend.profileFacts()).filter((fact) => fact.origin.type === "connection");
const factCalled = async (start: string) => (await calendarFacts()).find((fact) => fact.text.startsWith(start));

function oneEventFeed(uid: string, summary: string, date = "20261103"): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    `DTSTART:${date}T150000Z`,
    `DTEND:${date}T160000Z`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

describe("the list of Connections", () => {
  it("shows Google Calendar as off until the Student gives a Read Permission", async () => {
    expect(await calendarStatus()).toMatchObject({
      id: CALENDAR,
      name: "Google Calendar",
      on: false,
      lastReadAt: null,
      lastReadProblem: null,
    });
  });

  it("carries a card that says exactly what Buddy will read, and how to find the address", async () => {
    const { card } = (await calendarStatus())!;

    expect(card.reads.join(" ")).toMatch(/name, time and place of each event/);
    expect(card.reads.join(" ")).toMatch(/14 days/);
    expect(card.notes.join(" ")).toMatch(/descriptions and guest lists/);
    expect(card.notes.join(" ")).toMatch(/Claude/);
    expect(card.notes.join(" ")).toMatch(/7 a\.m\., 1 p\.m\. and 7 p\.m\./);
    expect(card.notes.join(" ")).toMatch(/can't change/);
    // Says what revoking leaves behind, so that the card doesn't promise more than happens.
    expect(card.notes.join(" ")).toMatch(/already shown to Claude stays in your conversation/);
    expect(card.notes.join(" ")).toMatch(/asleep/);
    expect(card.warning).toBeNull();
    expect(card.address.label).toBe("Secret address in iCal format");
    expect(card.address.steps.join(" ")).toMatch(/Integrate calendar/);
  });

  it("has room on the card for a warning about a service's rules", async () => {
    const warned = (await backend.connections()).find((connection) => connection.id === WARNED_CONNECTION);

    expect(warned.card.warning).toMatch(/forbid automated tools/);
  });

  it("refuses every Connection operation without a device key", async () => {
    const calls = [
      fetch(`${backend.url}/connections`),
      fetch(`${backend.url}/connections/${CALENDAR}/read`, { method: "POST" }),
      fetch(`${backend.url}/connections/${CALENDAR}/read-permission`, { method: "DELETE" }),
      fetch(`${backend.url}/connections/${CALENDAR}/read-permission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: SECRET_ADDRESS }),
      }),
    ];

    expect((await Promise.all(calls)).map((response) => response.status)).toEqual([401, 401, 401, 401]);
    expect(backend.web.requests).toEqual([]);
  });
});

describe("reading without a Read Permission", () => {
  it("is refused when the Student asks to read now, and nothing is fetched", async () => {
    const response = await backend.readNow(CALENDAR);

    expect(response.status).toBe(403);
    expect(backend.web.requests).toEqual([]);
  });

  it("doesn't happen on the schedule", async () => {
    backend.clock.moveForward(24 * HOUR);

    await backend.readDueConnections();

    expect(backend.web.requests).toEqual([]);
  });

  it("is refused again once the Read Permission is revoked", async () => {
    await connect();
    backend.web.requests.length = 0;

    await backend.revokeReadPermission(CALENDAR);
    const response = await backend.readNow(CALENDAR);
    backend.clock.moveForward(24 * HOUR);
    await backend.readDueConnections();

    expect(response.status).toBe(403);
    expect(backend.web.requests).toEqual([]);
  });

  it("says a Connection that doesn't exist doesn't exist", async () => {
    expect((await backend.readNow("nothing-like-this")).status).toBe(404);
    expect((await backend.giveReadPermission("nothing-like-this", SECRET_ADDRESS)).status).toBe(404);
    expect((await backend.revokeReadPermission("constructor")).status).toBe(404);
  });
});

describe("giving the Read Permission", () => {
  it("turns the Connection on and reads it right away", async () => {
    const response = await connect();

    expect(response.status).toBe(200);
    expect(backend.web.requests).toEqual([SECRET_ADDRESS]);
    expect(await response.json()).toMatchObject({
      connection: { id: CALENDAR, on: true, lastReadAt: "2026-11-02T14:00:00.000Z", lastReadProblem: null },
    });
    expect(await calendarStatus()).toMatchObject({ on: true });
  });

  it("stays on after a restart", async () => {
    await connect();

    await backend.restart();

    expect(await calendarStatus()).toMatchObject({ on: true, lastReadAt: "2026-11-02T14:00:00.000Z" });
  });

  it("forgives spaces around a pasted address", async () => {
    await backend.giveReadPermission(CALENDAR, `  ${SECRET_ADDRESS}\n`);

    expect(backend.web.requests).toEqual([SECRET_ADDRESS]);
  });

  it.each([
    ["not an address at all", "my calendar"],
    ["nothing", ""],
    ["not text", 42],
    ["the calendar's public address", "https://calendar.google.com/calendar/ical/student%40example.test/public/basic.ics"],
    ["the calendar's page", "https://calendar.google.com/calendar/u/0/r/settings"],
    ["plain http", SECRET_ADDRESS.replace("https:", "http:")],
    ["another site", SECRET_ADDRESS.replace("calendar.google.com", "calendar.google.com.example.test")],
    ["an address on this laptop", "https://127.0.0.1:6080/calendar/ical/a/private-b/basic.ics"],
    ["a login before the host", SECRET_ADDRESS.replace("calendar.google.com", "someone@calendar.google.com")],
    ["another port", SECRET_ADDRESS.replace("calendar.google.com", "calendar.google.com:8443")],
    ["extras after the address", `${SECRET_ADDRESS}?redirect=https://example.test`],
    ["a path that climbs out", SECRET_ADDRESS.replace("/calendar/ical/", "/other/../../calendar/ical/x/y/")],
  ])("refuses %s, saves nothing and fetches nothing", async (_, address) => {
    const response = await backend.giveReadPermission(CALENDAR, address);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/secret/i);
    expect(backend.web.requests).toEqual([]);
    expect(await calendarStatus()).toMatchObject({ on: false });
  });

  it("refuses to give it twice, so a second address can't quietly replace the first", async () => {
    await connect();

    const response = await backend.giveReadPermission(CALENDAR, SECRET_ADDRESS.replace("private-", "private-9"));

    expect(response.status).toBe(409);
    expect(backend.web.requests).toEqual([SECRET_ADDRESS]);
  });
});

describe("the secret address", () => {
  it("never comes back from the backend", async () => {
    const given = await (await connect()).text();
    const read = await (await backend.readNow(CALENDAR)).text();
    const list = JSON.stringify(await backend.connections());
    const facts = JSON.stringify(await backend.profileFacts());

    for (const answer of [given, read, list, facts]) expect(answer).not.toContain("private-");
  });

  it("isn't in what Claude is sent", async () => {
    await connect();
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    expect(JSON.stringify(backend.claude.requests)).not.toContain("private-");
  });

  it("is off the disk once the Read Permission is revoked", async () => {
    await connect();
    expect(backend.storageContains(SECRET_ADDRESS)).toBe(true);

    await backend.revokeReadPermission(CALENDAR);

    expect(backend.storageContains(SECRET_ADDRESS)).toBe(false);
  });
});

describe("what a read saves", () => {
  it("saves one Profile fact per event, with its times, marked as coming from the calendar", async () => {
    await connect();

    expect(await factCalled("BIO 1111 lecture")).toEqual({
      id: expect.any(Number),
      text: "BIO 1111 lecture, Beury Hall 160, Philadelphia",
      detail: "Tue, Nov 3, 10:00 AM–10:50 AM · Tue, Nov 10, 11:00 AM–11:50 AM",
      origin: { type: "connection", connection: CALENDAR, name: "Google Calendar" },
      savedAt: "2026-11-02T14:00:00.000Z",
      editedAt: null,
    });
    expect((await calendarFacts()).length).toBe(7);
  });

  it("describes all-day and free events in the times", async () => {
    await connect();

    expect((await factCalled("Mom's birthday"))?.detail).toBe("Sat, Nov 7, all day, marked free");
    expect((await factCalled("Trip to New York"))?.detail).toBe("Sat, Nov 14–Sun, Nov 15, all day");
    expect((await factCalled("Optional study group"))?.detail).toBe("Thu, Nov 5, 6:00 PM–7:00 PM, marked free");
  });

  it("hides any secret in what comes from the calendar, as with every other fact", async () => {
    backend.web.save(SECRET_ADDRESS, oneEventFeed("a@google.com", "Zoom password: hunter2swordfish"));

    await connect();

    expect((await calendarFacts())[0].text).toBe("Zoom password: [password hidden]");
    expect(backend.storageContains("hunter2swordfish")).toBe(false);
  });

  it("keeps the same fact from one read to the next, and removes one that's gone from the calendar", async () => {
    backend.web.save(SECRET_ADDRESS, oneEventFeed("a@google.com", "Stays"));
    await connect();
    const [before] = await calendarFacts();

    backend.web.save(SECRET_ADDRESS, oneEventFeed("b@google.com", "New"));
    await backend.readNow(CALENDAR);
    expect((await calendarFacts()).map((fact) => fact.text)).toEqual(["New"]);

    backend.web.save(SECRET_ADDRESS, oneEventFeed("b@google.com", "New, renamed"));
    backend.clock.moveForward(HOUR);
    const read = await backend.readNow(CALENDAR);

    expect((await read.json()).connection.lastReadAt).toBe("2026-11-02T15:00:00.000Z");
    const [after] = await calendarFacts();
    expect(after).toMatchObject({ text: "New, renamed", savedAt: "2026-11-02T15:00:00.000Z" });
    expect(after.id).not.toBe(before.id);
  });

  it("leaves what the Student told Buddy alone", async () => {
    backend.claude.willReply(
      { content: [{ type: "tool_use", id: "toolu_chat", name: "remember", input: { fact: "Is a junior." } }], stopReason: "tool_use" },
      { chunks: ["Okay."] },
    );
    await backend.sendAndCollect("I'm a junior");

    await connect();
    await backend.readNow(CALENDAR);

    expect((await backend.profileFacts()).map((fact) => fact.text)).toContain("Is a junior.");
  });
});

describe("the Student's changes to a calendar fact", () => {
  beforeEach(() => backend.web.save(SECRET_ADDRESS, oneEventFeed("therapy@google.com", "Therapy")));

  it("keeps an edit through later reads, while the times stay up to date", async () => {
    await connect();
    const [fact] = await calendarFacts();

    await backend.editFact(fact.id, "An appointment");
    backend.web.save(SECRET_ADDRESS, oneEventFeed("therapy@google.com", "Therapy", "20261104"));
    await backend.readNow(CALENDAR);

    expect(await calendarFacts()).toMatchObject([
      { id: fact.id, text: "An appointment", detail: "Wed, Nov 4, 10:00 AM–11:00 AM", editedAt: expect.any(String) },
    ]);
  });

  it("keeps an edit even when the event is out of the window for now", async () => {
    await connect();
    const [fact] = await calendarFacts();
    await backend.editFact(fact.id, "An appointment");

    backend.web.save(SECRET_ADDRESS, oneEventFeed("therapy@google.com", "Therapy", "20270301"));
    await backend.readNow(CALENDAR);
    backend.web.save(SECRET_ADDRESS, oneEventFeed("therapy@google.com", "Therapy", "20261104"));
    await backend.readNow(CALENDAR);

    expect(await calendarFacts()).toMatchObject([{ id: fact.id, text: "An appointment" }]);
  });

  it("keeps a deleted fact deleted through later reads", async () => {
    await connect();
    const [fact] = await calendarFacts();

    expect((await backend.deleteFact(fact.id)).status).toBe(204);
    await backend.readNow(CALENDAR);
    await backend.restart();
    await backend.readNow(CALENDAR);

    expect(await calendarFacts()).toEqual([]);
  });

  it("forgets those changes when the Read Permission is revoked and given again", async () => {
    await connect();
    const [fact] = await calendarFacts();
    await backend.deleteFact(fact.id);

    await backend.revokeReadPermission(CALENDAR);
    await connect();

    expect((await calendarFacts()).map((kept) => kept.text)).toEqual(["Therapy"]);
  });
});

describe("when a read fails", () => {
  it.each([
    ["Google no longer knows the address", () => backend.web.save(SECRET_ADDRESS, "Not found", 404), /doesn't work any more/],
    ["Google refuses it", () => backend.web.save(SECRET_ADDRESS, "Forbidden", 403), /doesn't work any more/],
    ["Google has a problem", () => backend.web.save(SECRET_ADDRESS, "Oops", 500), /try again/],
    ["what comes back isn't a calendar", () => backend.web.save(SECRET_ADDRESS, "<html>Sign in</html>"), /wasn't a calendar/],
    ["the laptop has no connection", () => void (backend.web.unreachable = true), /couldn't reach/],
  ])("keeps the last reading and says what happened when %s", async (_, breakIt, message) => {
    await connect();
    const facts = await calendarFacts();
    breakIt();
    backend.clock.moveForward(HOUR);

    const response = await backend.readNow(CALENDAR);

    expect(response.status).toBe(200);
    const { connection } = await response.json();
    expect(connection).toMatchObject({ on: true, lastReadAt: "2026-11-02T14:00:00.000Z" });
    expect(connection.lastReadProblem).toMatch(message);
    expect(connection.lastReadProblem).not.toContain("private-");
    expect(await calendarFacts()).toEqual(facts);
  });

  it("stays on when the very first read fails, and says why", async () => {
    backend.web.save(SECRET_ADDRESS, "Not found", 404);

    const { connection } = await (await connect()).json();

    expect(connection).toMatchObject({ on: true, lastReadAt: null });
    expect(connection.lastReadProblem).toMatch(/doesn't work any more/);
  });

  it("clears the problem once a read works", async () => {
    backend.web.save(SECRET_ADDRESS, "Oops", 500);
    await connect();
    backend.web.save(SECRET_ADDRESS, studentCalendar);

    const { connection } = await (await backend.readNow(CALENDAR)).json();

    expect(connection.lastReadProblem).toBeNull();
  });
});

describe("two reads at once", () => {
  it("share one trip to the web", async () => {
    await connect();
    backend.web.requests.length = 0;
    let finish!: () => void;
    backend.web.hold = new Promise((resolve) => (finish = resolve));

    const reads = [backend.readNow(CALENDAR), backend.readNow(CALENDAR)];
    await expect.poll(() => backend.web.requests.length).toBe(1);
    finish();

    expect((await Promise.all(reads)).map((response) => response.status)).toEqual([200, 200]);
    expect(backend.web.requests).toHaveLength(1);
  });
});

describe("revoking the Read Permission", () => {
  it("deletes the facts that came from the calendar, and only those", async () => {
    backend.claude.willReply(
      { content: [{ type: "tool_use", id: "toolu_chat", name: "remember", input: { fact: "Is a junior." } }], stopReason: "tool_use" },
      { chunks: ["Okay."] },
    );
    await backend.sendAndCollect("I'm a junior");
    await connect();
    expect((await calendarFacts()).length).toBeGreaterThan(0);

    const response = await backend.revokeReadPermission(CALENDAR);
    await backend.restart();

    expect(response.status).toBe(200);
    expect((await response.json()).connection).toMatchObject({ on: false, lastReadAt: null, lastReadProblem: null });
    expect((await backend.profileFacts()).map((fact) => fact.text)).toEqual(["Is a junior."]);
    expect(await calendarStatus()).toMatchObject({ on: false });
  });

  it("removes the facts from the disk", async () => {
    await connect();
    expect(backend.storageContains("Shift at CVS")).toBe(true);

    await backend.revokeReadPermission(CALENDAR);

    expect(backend.storageContains("Shift at CVS")).toBe(false);
  });

  it("is fine to do twice", async () => {
    await connect();

    await backend.revokeReadPermission(CALENDAR);

    expect((await backend.revokeReadPermission(CALENDAR)).status).toBe(200);
  });

  it("can't be undone by a read already under way", async () => {
    await connect();
    let finish!: () => void;
    backend.web.hold = new Promise((resolve) => (finish = resolve));

    const read = backend.readNow(CALENDAR);
    await expect.poll(() => backend.web.requests.length).toBe(2);
    await backend.revokeReadPermission(CALENDAR);
    finish();
    await read;

    expect(await calendarFacts()).toEqual([]);
    expect(await calendarStatus()).toMatchObject({ on: false, lastReadAt: null });
  });

  it("doesn't let an old read land on a new Read Permission", async () => {
    await connect();
    backend.web.save(SECRET_ADDRESS, oneEventFeed("old@google.com", "From before"));
    let finish!: () => void;
    backend.web.hold = new Promise((resolve) => (finish = resolve));

    const oldRead = backend.readNow(CALENDAR);
    await expect.poll(() => backend.web.requests.length).toBe(2);
    await backend.revokeReadPermission(CALENDAR);
    backend.web.hold = undefined;
    backend.web.save(SECRET_ADDRESS, oneEventFeed("new@google.com", "From now on"));
    await connect();
    finish();
    await oldRead;

    expect((await calendarFacts()).map((fact) => fact.text)).toEqual(["From now on"]);
  });
});

describe("the schedule", () => {
  /** Walks the clock forward half an hour at a time, and notes each moment a read happened. */
  async function readsDuring(hours: number): Promise<string[]> {
    const readsAt: string[] = [];
    for (let step = 0; step < hours * 2; step++) {
      backend.clock.moveForward(HOUR / 2);
      const before = backend.web.requests.length;
      await backend.readDueConnections();
      if (backend.web.requests.length > before) readsAt.push(backend.clock.now().toISOString());
    }
    return readsAt;
  }

  it("reads at 7 a.m., 1 p.m. and 7 p.m. in Philadelphia, and at no other time", async () => {
    await connect();

    // From 9 a.m. on Monday November 2, when Philadelphia is five hours behind UTC.
    expect(await readsDuring(24)).toEqual([
      "2026-11-02T18:00:00.000Z",
      "2026-11-03T00:00:00.000Z",
      "2026-11-03T12:00:00.000Z",
    ]);
  });

  it("stays on Philadelphia's clock when the clocks change", async () => {
    await connect();
    // To Saturday morning, March 13, the weekend the clocks go forward.
    backend.clock.moveForward(new Date("2027-03-13T14:00:00Z").getTime() - backend.clock.now().getTime());
    await backend.readDueConnections();
    backend.web.requests.length = 0;

    const reads = await readsDuring(48);

    expect(reads).toEqual([
      "2027-03-13T18:00:00.000Z",
      "2027-03-14T00:00:00.000Z",
      "2027-03-14T11:00:00.000Z", // 7 a.m. is now four hours behind UTC
      "2027-03-14T17:00:00.000Z",
      "2027-03-14T23:00:00.000Z",
      "2027-03-15T11:00:00.000Z",
    ]);
  });

  it("catches up once when the laptop wakes after missing a read", async () => {
    await connect();
    backend.web.requests.length = 0;
    backend.clock.moveForward(30 * HOUR);

    await backend.readDueConnections();
    await backend.readDueConnections();

    expect(backend.web.requests).toHaveLength(1);
  });

  it("counts a read the Student asked for, so the next one waits for the next time", async () => {
    await connect();
    backend.clock.moveForward(5 * HOUR); // 2 p.m., and 1 p.m. was missed
    await backend.readNow(CALENDAR);
    backend.web.requests.length = 0;

    await backend.readDueConnections();

    expect(backend.web.requests).toEqual([]);
  });

  it("waits for the next time after a read fails, rather than trying every minute", async () => {
    await connect();
    backend.web.requests.length = 0;
    backend.web.unreachable = true;
    backend.clock.moveForward(5 * HOUR);

    await backend.readDueConnections();
    await backend.readDueConnections();
    expect(backend.web.requests).toHaveLength(1);

    backend.web.unreachable = false;
    backend.clock.moveForward(6 * HOUR);
    await backend.readDueConnections();
    expect(backend.web.requests).toHaveLength(2);
  });

  it("runs by itself once the backend starts its timer", async () => {
    await connect();
    backend.web.requests.length = 0;
    backend.clock.moveForward(5 * HOUR);

    backend.startSchedule(5);

    await expect.poll(() => backend.web.requests.length).toBe(1);
  });

  it("keeps going if one Connection's read goes wrong", async () => {
    await connect();
    await backend.giveReadPermission(WARNED_CONNECTION, undefined);
    backend.web.requests.length = 0;
    backend.web.unreachable = true;
    backend.clock.moveForward(5 * HOUR);

    await expect(backend.readDueConnections()).resolves.toBeUndefined();
    expect(backend.web.requests).toHaveLength(1);
  });
});
