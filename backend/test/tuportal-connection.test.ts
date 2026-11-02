import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageBlocked } from "../src/buddys-browser.ts";
import { settings } from "../src/settings.ts";
import { tuportal } from "../src/tuportal.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { saveCanvasPages } from "./support/canvas-pages.ts";
import {
  BALANCE_PAGE,
  changeTuportalPage,
  expireTuportalLogin,
  HOLDS_PAGE,
  HOME_PAGE,
  REGISTRATION_PAGE,
  saveTuportalPages,
  savedTuportalHtml,
  SIGN_ON_PAGE,
  TUPORTAL,
} from "./support/tuportal-pages.ts";

const TUPORTAL_ID = tuportal.id;
const SHARED_HOSTS = ["fim.temple.edu", "duosecurity.com"];
const UNREADABLE = "<h1>Made-up page Buddy can't read</h1>";
const HOUR_MS = 3_600_000;
let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start({ sites: { tuportal: settings.sites.tuportal }, extraConnectionTypes: [tuportal] });
  saveTuportalPages(backend.browser);
});

afterEach(async () => {
  await backend.stop();
});

const statusOf = async () => (await backend.connections()).find((connection) => connection.id === TUPORTAL_ID);
const factsFromTuportal = async () => (await backend.profileFacts()).filter((fact) => fact.origin.connection === TUPORTAL_ID);
const fact = async (textPart: string) => (await factsFromTuportal()).find((candidate) => candidate.text.includes(textPart));
const pagesOpened = () => backend.browser.actions.filter((action) => action.type === "read").map((action: any) => action.url);
const connect = async () => {
  const response = await backend.giveReadPermission(TUPORTAL_ID, undefined);
  expect(response.status).toBe(200);
};
const readAgain = async () => {
  backend.clock.moveForward(60_000);
  await backend.readNow(TUPORTAL_ID);
};
const eventKinds = async () => (await backend.connectionEvents(TUPORTAL_ID)).map((event) => event.kind);

describe("the Read Permission card", () => {
  it("says exactly what will be read", async () => {
    const reads = (await statusOf()).card.reads.join(" ");

    expect(reads).toMatch(/holds/);
    expect(reads).toMatch(/balance/);
    expect(reads).toMatch(/registration status/);
  });

  it("says what Buddy never opens, that the Student logs in themselves, and that the sign-on is shared", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/Takeover/);
    expect(notes).toMatch(/password/);
    expect(notes).toMatch(/TUpay/);
    expect(notes).toMatch(/never submits/);
    expect(notes).toMatch(/single sign-on/);
    expect(notes).toMatch(/7 a\.m\., 1 p\.m\. and 7 p\.m\./);
    expect(notes).toMatch(/Claude/);
  });

  it("warns about Temple's rules on non-public data, and has no address to paste", async () => {
    const { card } = await statusOf();

    expect(card.warning).toMatch(/Guidelines for Generative AI/);
    expect(card.address).toBeNull();
  });

  it("logs in through a Takeover", async () => {
    expect((await statusOf()).logsIn).toBe(true);
  });
});

describe("without a Read Permission", () => {
  it("opens nothing on TUportal, reads nothing on the schedule, and refuses Read now and a Takeover", async () => {
    await expect(backend.browserAccess.read(HOLDS_PAGE)).rejects.toThrow(PageBlocked);
    await backend.readDueConnections();

    expect((await backend.readNow(TUPORTAL_ID)).status).toBe(403);
    expect((await backend.startTakeover(TUPORTAL_ID)).status).toBe(403);
    expect(backend.browser.actions).toEqual([]);
  });
});

describe("a read", () => {
  it("turns holds, balance and registration status into Profile facts, each from TUportal", async () => {
    await connect();

    const facts = await factsFromTuportal();
    expect(facts.map((one) => one.text)).toEqual(
      expect.arrayContaining([
        "TUportal showed 2 holds",
        "Hold: Made-Up Bursar Hold",
        "Hold: Made-Up Advising Hold",
        "Balance on your student account: $1,234.56",
        "Registration status: Made-Up Registered Full Time",
      ]),
    );
    for (const one of facts) expect(one.origin).toEqual({ type: "connection", connection: TUPORTAL_ID, name: "TUportal" });
    expect((await fact("Made-Up Bursar Hold")).detail).toContain("Made-up past due balance");
    expect((await fact("Registration status")).detail).toContain("Spring 2027");
    expect((await statusOf()).lastReadProblem).toBeNull();
  });

  it("opens only the home page and the three pages it reads", async () => {
    await connect();

    expect(pagesOpened().sort()).toEqual([BALANCE_PAGE, HOLDS_PAGE, HOME_PAGE, REGISTRATION_PAGE].sort());
  });

  it("says so when the page says there are no holds", async () => {
    changeTuportalPage(backend.browser, HOLDS_PAGE, savedTuportalHtml("no-holds"));

    await connect();

    expect(await fact("TUportal showed no holds")).toBeDefined();
    expect((await factsFromTuportal()).filter((one) => one.text.startsWith("Hold:"))).toEqual([]);
  });

  it("shows in Activity, without saying what it found", async () => {
    await connect();

    const entries = (await backend.activity()).filter((entry) => entry.kind === "connection_read");
    expect(entries.map((entry) => entry.title)).toEqual(["Buddy read TUportal"]);
    expect(JSON.stringify(entries)).not.toMatch(/Made-Up|1,234/);
  });

  it("happens three times a day", async () => {
    await connect();
    backend.browser.actions.length = 0;

    await backend.readDueConnections();
    expect(pagesOpened()).toEqual([]);

    backend.clock.moveForward(4 * HOUR_MS); // 1 p.m. in Philadelphia
    await backend.readDueConnections();
    expect(pagesOpened()).toContain(HOLDS_PAGE);

    backend.browser.actions.length = 0;
    backend.clock.moveForward(6 * HOUR_MS); // 7 p.m. in Philadelphia
    await backend.readDueConnections();
    expect(pagesOpened()).toContain(HOLDS_PAGE);

    backend.browser.actions.length = 0;
    backend.clock.moveForward(12 * HOUR_MS); // 7 a.m. in Philadelphia
    await backend.readDueConnections();
    expect(pagesOpened()).toContain(HOLDS_PAGE);
  });
});

describe("a page Buddy can't understand is never read as having nothing on it", () => {
  it("on the first read, there's no fact that says anything about holds, and the Student is told", async () => {
    changeTuportalPage(backend.browser, HOLDS_PAGE, UNREADABLE);

    await connect();

    expect(JSON.stringify(await factsFromTuportal())).not.toMatch(/hold/i);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read your holds/);
    expect(await fact("Balance on your student account")).toBeDefined();
  });

  it("says so in Activity too, rather than only that it read TUportal", async () => {
    changeTuportalPage(backend.browser, HOLDS_PAGE, UNREADABLE);

    await connect();

    const entry = (await backend.activity()).find((one) => one.kind === "connection_read");
    expect(entry.detail).toMatch(/couldn't read your holds/);
  });

  it("later, keeps the holds Buddy already has, with no event saying one has gone", async () => {
    await connect();
    changeTuportalPage(backend.browser, HOLDS_PAGE, UNREADABLE);

    await readAgain();

    expect(await fact("Made-Up Bursar Hold")).toBeDefined();
    expect(await fact("TUportal showed 2 holds")).toBeDefined();
    expect(await eventKinds()).toEqual([]);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read your holds/);
  });

  it("a page that ended up somewhere else on the portal isn't the holds page, whatever it says", async () => {
    changeTuportalPage(backend.browser, HOLDS_PAGE, "<p>No holds exist.</p>", { finalUrl: `${TUPORTAL}/group/home` });

    await connect();

    expect(await fact("no holds")).toBeUndefined();
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read your holds/);
  });

  it("a page the guard refuses is a page not read, not an empty one", async () => {
    changeTuportalPage(backend.browser, HOLDS_PAGE, "<p>No holds exist.</p>", { finalUrl: `${TUPORTAL}/group/home/registration` });

    await connect();

    expect(await fact("no holds")).toBeUndefined();
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read your holds/);
    expect((await statusOf()).needsLogin).toBe(false);
  });

  it("when none of the pages can be understood, it's a failed read that keeps what Buddy had", async () => {
    await connect();
    for (const page of [HOLDS_PAGE, BALANCE_PAGE, REGISTRATION_PAGE]) changeTuportalPage(backend.browser, page, UNREADABLE);

    await readAgain();

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense/);
    expect(await fact("Made-Up Bursar Hold")).toBeDefined();
    expect((await backend.activity())[0].kind).toBe("connection_read_failed");
  });

  it("a balance it can't read keeps the last one, and doesn't become zero", async () => {
    await connect();
    changeTuportalPage(backend.browser, BALANCE_PAGE, UNREADABLE);

    await readAgain();

    expect(await fact("$1,234.56")).toBeDefined();
    expect(await eventKinds()).toEqual([]);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read your balance/);
  });
});

describe("what changed between reads", () => {
  const onePlainHold = (name: string) => `<table><tr><th>Hold Type</th></tr><tr><td>${name}</td></tr></table>`;

  it("says nothing on the first read, when everything looks new and none of it is news", async () => {
    await connect();

    expect(await eventKinds()).toEqual([]);
  });

  it("spots a new hold, says it came from TUportal, and counts it in Activity without saying what it is", async () => {
    changeTuportalPage(backend.browser, HOLDS_PAGE, savedTuportalHtml("no-holds"));
    await connect();
    changeTuportalPage(backend.browser, HOLDS_PAGE, onePlainHold("Made-Up New Hold"));

    await readAgain();

    const events = await backend.connectionEvents(TUPORTAL_ID);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "new_hold", connection: TUPORTAL_ID });
    expect(events[0].text).toContain("Made-Up New Hold");
    const entry = (await backend.activity())[0];
    expect(entry.detail).toContain("1 new hold");
    expect(entry.detail).not.toContain("Made-Up New Hold");
  });

  it("spots a hold that's gone, when the page really was read", async () => {
    await connect();
    changeTuportalPage(backend.browser, HOLDS_PAGE, savedTuportalHtml("no-holds"));

    await readAgain();

    expect((await eventKinds()).sort()).toEqual(["hold_cleared", "hold_cleared"]);
    expect(await fact("Made-Up Bursar Hold")).toBeUndefined();
    expect(await fact("TUportal showed no holds")).toBeDefined();
  });

  it("stays quiet about the same hold on the next read, however its reason's spacing or case changes", async () => {
    changeTuportalPage(backend.browser, HOLDS_PAGE, onePlainHold("Made-Up Bursar Hold"));
    await connect();
    changeTuportalPage(backend.browser, HOLDS_PAGE, onePlainHold("made-up  BURSAR hold"));

    await readAgain();

    expect(await eventKinds()).toEqual([]);
  });

  it("spots a changed balance", async () => {
    await connect();
    changeTuportalPage(backend.browser, BALANCE_PAGE, "<p>Current Balance: $20.00</p>");

    await readAgain();

    const [event] = await backend.connectionEvents(TUPORTAL_ID);
    expect(event).toMatchObject({ kind: "balance_changed", data: { from: 123456, to: 2000 } });
    expect(event.text).toContain("$20.00");
    expect((await backend.activity())[0].detail).toContain("1 balance change");
    expect((await backend.activity())[0].detail).not.toContain("$20.00");
  });

  it("spots a changed registration status", async () => {
    await connect();
    changeTuportalPage(backend.browser, REGISTRATION_PAGE, "<p>Registration Status: Made-Up Not Registered</p>");

    await readAgain();

    const [event] = await backend.connectionEvents(TUPORTAL_ID);
    expect(event.kind).toBe("registration_status_changed");
    expect(event.text).toContain("Made-Up Not Registered");
  });

  it("doesn't call a balance changed when it's only the first it could read", async () => {
    changeTuportalPage(backend.browser, BALANCE_PAGE, UNREADABLE);
    await connect();
    saveTuportalPages(backend.browser);

    await readAgain();

    expect(await eventKinds()).toEqual([]);
    expect(await fact("$1,234.56")).toBeDefined();
  });
});

describe("the Student's own changes", () => {
  it("keeps a hold's words as the Student changed them, and it's still a hold", async () => {
    await connect();
    const { id } = await fact("Made-Up Bursar Hold");
    await backend.editFact(id, "My made-up bursar thing");

    await readAgain();

    expect(await fact("My made-up bursar thing")).toBeDefined();
    expect(await fact("Hold: Made-Up Bursar Hold")).toBeUndefined();
    expect(await eventKinds()).toEqual([]);
  });

  it("a hold the Student deleted stays deleted, and doesn't come back as new", async () => {
    await connect();
    const { id } = await fact("Made-Up Bursar Hold");
    await backend.deleteFact(id);

    await readAgain();

    expect(await fact("Made-Up Bursar Hold")).toBeUndefined();
    expect(await eventKinds()).toEqual([]);
  });
});

describe("what's sensitive", () => {
  it("masks a secret on a page before saving it, and keeps no words from the page with the fact", async () => {
    const SSN = "078-05-1120";
    changeTuportalPage(backend.browser, HOLDS_PAGE, `<table><tr><th>Hold</th><th>Reason</th></tr><tr><td>Made-Up Hold</td><td>Made-up, SSN ${SSN}</td></tr></table>`);

    await connect();

    expect((await fact("Made-Up Hold")).detail).toContain("[Social Security number hidden]");
    expect(backend.storageContains(SSN)).toBe(false);
  });

  it("leaves a balance as it is, because masking is for passwords and numbers that identify someone", async () => {
    await connect();

    expect((await fact("Balance on")).text).toBe("Balance on your student account: $1,234.56");
  });

  it("describes a credit as a credit", async () => {
    changeTuportalPage(backend.browser, BALANCE_PAGE, "<p>Current Balance: -$12.50</p>");

    await connect();

    expect((await fact("Balance on")).text).toBe("Balance on your student account: a credit of $12.50");
  });
});

describe("the login", () => {
  it("starts with a Takeover at the page Temple says to log in at, then reads straight away", async () => {
    await connect();
    backend.browser.actions.length = 0;

    expect((await backend.startTakeover(TUPORTAL_ID)).status).toBe(200);
    expect(backend.browser.actions).toContainEqual({ type: "show", url: `${TUPORTAL}/` });
    const done = (await (await backend.finishTakeover()).json()) as { signedIn: boolean };
    await backend.untilReadsFinish(TUPORTAL_ID);

    expect(done.signedIn).toBe(true);
    expect(pagesOpened()).toContain(HOLDS_PAGE);
  });

  it("says it's not logged in when the sign-on is where the browser ends up", async () => {
    expireTuportalLogin(backend.browser);
    await connect();
    backend.browser.actions.length = 0;
    await backend.startTakeover(TUPORTAL_ID);

    const done = (await (await backend.finishTakeover()).json()) as { signedIn: boolean };

    expect(done.signedIn).toBe(false);
  });

  it("asks for a login when one has expired, and keeps what it has", async () => {
    await connect();
    expireTuportalLogin(backend.browser);

    await readAgain();

    const status = await statusOf();
    expect(status.needsLogin).toBe(true);
    expect(status.lastReadProblem).toMatch(/log in to TUportal/);
    expect(await fact("Made-Up Bursar Hold")).toBeDefined();
  });

  it("asks for a login when a page turns out to ask for a password, wherever it is", async () => {
    await connect();
    changeTuportalPage(backend.browser, HOLDS_PAGE, '<form><input type="password" name="made-up"></form>');

    await readAgain();

    expect((await statusOf()).needsLogin).toBe(true);
    expect(await fact("Made-Up Bursar Hold")).toBeDefined();
  });

  it("asks for a login when the portal's home goes somewhere the guard won't follow", async () => {
    backend.browser.savedPages.set(HOME_PAGE, { title: "", text: "", accessibilitySnapshot: "", finalUrl: "https://made-up-sign-on.example.test/" });

    await connect();

    expect((await statusOf()).needsLogin).toBe(true);
  });

  it("doesn't blame the Student's login when the browser can't be reached", async () => {
    await connect();
    backend.browser.unreachable = true;

    await readAgain();

    expect((await statusOf()).needsLogin).toBe(false);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't open TUportal/);
  });

  it("stays out while the Student is in control", async () => {
    await connect();
    await backend.startTakeover(TUPORTAL_ID);
    backend.browser.actions.length = 0;

    await readAgain();

    expect(pagesOpened()).toEqual([]);
    expect((await statusOf()).lastReadProblem).toMatch(/in control/);
  });
});

describe("revoking the Read Permission", () => {
  const forgotten = () => backend.browser.actions.filter((action) => action.type === "forget-login").map((action: any) => action.hosts);

  it("deletes the facts, the events and the login, and says so in Activity", async () => {
    await connect();
    changeTuportalPage(backend.browser, BALANCE_PAGE, "<p>Current Balance: $20.00</p>");
    await readAgain();

    expect((await backend.revokeReadPermission(TUPORTAL_ID)).status).toBe(200);

    expect(await factsFromTuportal()).toEqual([]);
    expect(await backend.connectionEvents(TUPORTAL_ID)).toEqual([]);
    expect(forgotten()).toEqual([expect.arrayContaining(["tuportal6.temple.edu", "tuportal.temple.edu", ...SHARED_HOSTS])]);
    const kinds = (await backend.activity()).map((entry) => entry.kind);
    expect(kinds).toEqual(expect.arrayContaining(["read_permission_revoked", "login_deleted"]));
  });

  it("opens nothing afterwards", async () => {
    await connect();
    await backend.revokeReadPermission(TUPORTAL_ID);
    backend.browser.actions.length = 0;

    await expect(backend.browserAccess.read(HOLDS_PAGE)).rejects.toThrow(PageBlocked);
    await backend.readDueConnections();

    expect(pagesOpened()).toEqual([]);
  });
});

describe("Temple's single sign-on, shared with Canvas", () => {
  const CANVAS = "canvas";
  let shared: BackendHarness;
  const forgotten = () => shared.browser.actions.filter((action) => action.type === "forget-login").map((action: any) => action.hosts);
  const opened = () => shared.browser.actions.filter((action) => action.type === "read").map((action: any) => action.url);

  beforeEach(async () => {
    const canvas = settings.connectionTypes.find((type) => type.id === CANVAS)!;
    shared = await BackendHarness.start({ sites: { canvas: settings.sites.canvas, tuportal: settings.sites.tuportal }, extraConnectionTypes: [canvas, tuportal] });
    saveTuportalPages(shared.browser);
    saveCanvasPages(shared.browser);
  });

  afterEach(async () => {
    await shared.stop();
  });

  it("revoking TUportal leaves the sign-on for Canvas, and clears everything of TUportal's own", async () => {
    await shared.giveReadPermission(CANVAS, undefined);
    await shared.giveReadPermission(TUPORTAL_ID, undefined);

    await shared.revokeReadPermission(TUPORTAL_ID);

    const [hosts] = forgotten();
    expect(hosts).toEqual(expect.arrayContaining(["tuportal6.temple.edu", "tuportal.temple.edu", "tupay.temple.edu"]));
    for (const host of SHARED_HOSTS) expect(hosts).not.toContain(host);
    const canvasStatus = (await shared.connections()).find((connection) => connection.id === CANVAS);
    expect(canvasStatus).toMatchObject({ on: true, needsLogin: false });
  });

  it("the sign-on left behind doesn't let Buddy back into TUportal with no Read Permission", async () => {
    await shared.giveReadPermission(CANVAS, undefined);
    await shared.giveReadPermission(TUPORTAL_ID, undefined);
    await shared.revokeReadPermission(TUPORTAL_ID);
    shared.browser.actions.length = 0;

    await expect(shared.browserAccess.read(HOLDS_PAGE)).rejects.toThrow(PageBlocked);
    await expect(shared.browserAccess.readToCheckLogin(TUPORTAL_ID)).rejects.toThrow(PageBlocked);
    expect((await shared.startTakeover(TUPORTAL_ID)).status).toBe(403);
    await shared.readDueConnections();

    expect(opened().filter((url) => url.startsWith(TUPORTAL))).toEqual([]);
  });

  it("revoking Canvas leaves the sign-on for TUportal, and Canvas stays out", async () => {
    await shared.giveReadPermission(CANVAS, undefined);
    await shared.giveReadPermission(TUPORTAL_ID, undefined);

    await shared.revokeReadPermission(CANVAS);

    const [hosts] = forgotten();
    expect(hosts).toEqual(expect.arrayContaining(["templeu.instructure.com", "instructure.com"]));
    for (const host of SHARED_HOSTS) expect(hosts).not.toContain(host);
    await expect(shared.browserAccess.read("https://templeu.instructure.com/courses")).rejects.toThrow(PageBlocked);
  });

  it("the last one revoked takes the sign-on with it", async () => {
    await shared.giveReadPermission(CANVAS, undefined);
    await shared.giveReadPermission(TUPORTAL_ID, undefined);

    await shared.revokeReadPermission(CANVAS);
    await shared.revokeReadPermission(TUPORTAL_ID);

    const [, last] = forgotten();
    expect(last).toEqual(expect.arrayContaining(SHARED_HOSTS));
  });

  it("the sign-on goes if nothing else is using it, even when both were revoked while the browser was away", async () => {
    await shared.giveReadPermission(CANVAS, undefined);
    await shared.giveReadPermission(TUPORTAL_ID, undefined);
    shared.browser.unreachable = true;
    await shared.revokeReadPermission(CANVAS);
    await shared.revokeReadPermission(TUPORTAL_ID);
    shared.browser.unreachable = false;

    await shared.readDueConnections();

    expect(forgotten().flat()).toEqual(expect.arrayContaining(SHARED_HOSTS));
    expect(forgotten().flat()).toEqual(expect.arrayContaining(["templeu.instructure.com", "tuportal6.temple.edu"]));
  });

  it("a Connection with no Read Permission isn't what keeps the sign-on", async () => {
    await shared.giveReadPermission(TUPORTAL_ID, undefined);

    await shared.revokeReadPermission(TUPORTAL_ID);

    expect(forgotten()[0]).toEqual(expect.arrayContaining(SHARED_HOSTS));
  });

  it("the sign-on page itself stays reachable for the Connection that still needs it", async () => {
    await shared.giveReadPermission(CANVAS, undefined);
    await shared.giveReadPermission(TUPORTAL_ID, undefined);
    await shared.revokeReadPermission(TUPORTAL_ID);
    shared.browser.savedPages.set(SIGN_ON_PAGE, { title: "", text: "", accessibilitySnapshot: "" });

    await expect(shared.browserAccess.read(SIGN_ON_PAGE)).resolves.toBeDefined();
  });
});
