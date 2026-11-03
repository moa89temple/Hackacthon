import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageBlocked } from "../src/buddys-browser.ts";
import { canvas } from "../src/canvas.ts";
import { navigate360 } from "../src/navigate360.ts";
import { settings } from "../src/settings.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { saveCanvasPages } from "./support/canvas-pages.ts";
import {
  appointmentsAnswer,
  expireNavigate360Login,
  HOME_PAGE,
  LANDING_PAGE,
  person,
  saveNavigate360Pages,
  saveNavigate360PagesWithoutAnswers,
  TEAM_ANSWER_ADDRESS,
  TEAM_PAGE,
  teamAnswer,
  V1_APPOINTMENTS_PAGE,
  V1_LANDED,
  V1_TEAM_PAGE,
} from "./support/navigate360-pages.ts";
import { haikuFinds, TUTTLEMAN_CONTACT_PAGE } from "./support/office-pages.ts";

const NAVIGATE360 = navigate360.id;
const OWN_HOSTS = ["temple.navigate.eab.com", "eab.com", "temple.campus.eab.com"];
const SIGN_ON_HOSTS = ["fim.temple.edu", "duosecurity.com"];
let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start({
    sites: { navigate360: settings.sites.navigate360, canvas: settings.sites.canvas },
    extraConnectionTypes: [navigate360, canvas],
  });
  saveNavigate360Pages(backend.browser);
});

afterEach(async () => {
  await backend.stop();
});

const statusOf = async (id = NAVIGATE360) => (await backend.connections()).find((connection) => connection.id === id);
const facts = async () => (await backend.profileFacts()).filter((fact) => fact.origin.connection === NAVIGATE360);
const advisors = () => backend.guidebook.search("advisor", { kind: "contact" });
const pagesOpened = () => backend.browser.actions.filter((action) => action.type === "read").map((action: any) => action.url);
const forgotten = () => backend.browser.actions.filter((action) => action.type === "forget-login").map((action: any) => action.hosts);
const connect = async () => {
  const response = await backend.giveReadPermission(NAVIGATE360, undefined);
  expect(response.status).toBe(200);
};
const readAgain = async (answers: { team?: string; appointments?: string }) => {
  saveNavigate360Pages(backend.browser, answers);
  return backend.readNow(NAVIGATE360);
};

describe("the Read Permission card", () => {
  it("says what will be read, and that it's read through a Takeover login", async () => {
    const { card, logsIn } = await statusOf();

    expect(logsIn).toBe(true);
    expect(card.reads.join(" ")).toMatch(/advisor/);
    expect(card.reads.join(" ")).toMatch(/appointments/);
    expect(card.notes.join(" ")).toMatch(/Takeover/);
    expect(card.notes.join(" ")).toMatch(/password/);
    expect(card.address).toBeNull();
  });

  it("says Buddy never books, cancels or sends, and what it does with the rest of the team", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/never books, cancels or changes an appointment/);
    expect(notes).toMatch(/never sends/);
    expect(notes).toMatch(/instructors/);
    expect(notes).toMatch(/classmates/);
  });

  it("says what revoking does, including to a Draft that's already written", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/revoke/);
    expect(notes).toMatch(/advisor/);
    expect(notes).toMatch(/Draft/);
    expect(notes).toMatch(/sign-on/);
  });

  it("warns about Temple's rules, and says plainly that EAB's own haven't been checked", async () => {
    const { warning } = (await statusOf()).card;

    expect(warning).toMatch(/Chief Information Security Officer/);
    expect(warning).toMatch(/EAB/);
  });
});

describe("without a Read Permission", () => {
  it("opens nothing", async () => {
    await expect(backend.browserAccess.read(LANDING_PAGE)).rejects.toThrow(PageBlocked);

    expect((await backend.readNow(NAVIGATE360)).status).toBe(403);
    await backend.readDueConnections();
    expect(pagesOpened()).toEqual([]);
  });

  it("refuses a Takeover", async () => {
    expect((await backend.startTakeover(NAVIGATE360)).status).toBe(403);
    expect(backend.browser.actions).toEqual([]);
  });

  it("adds no Contact", () => {
    expect(advisors()).toEqual([]);
  });
});

describe("the assigned advisor", () => {
  it("becomes a Contact with its Source, an address and a phone number", async () => {
    await connect();

    expect(advisors()).toEqual([
      expect.objectContaining({
        kind: "contact",
        name: "Riley Madeup",
        email: "riley.madeup@temple.edu",
        phone: "215-555-0142",
        phoneToDial: "+12155550142",
        sources: [expect.objectContaining({ url: LANDING_PAGE, title: "Navigate360" })],
      }),
    ]);
  });

  it("is found however the Student asks, and by name", async () => {
    await connect();

    for (const words of ["my advisor", "academic advisor", "advising", "Riley Madeup", "Primary Advisor"]) {
      expect(backend.guidebook.search(words, { kind: "contact" }).map((item) => item.name)).toContain("Riley Madeup");
    }
  });

  it("isn't a Resource, and no one else on the team becomes anything", async () => {
    await connect();

    expect(backend.guidebook.search("advisor", { kind: "resource" })).toEqual([]);
    expect(backend.guidebook.search("Invented")).toEqual([]);
    expect(backend.storageContains("Invented")).toBe(false);
    expect(backend.storageContains("sam.invented@temple.edu")).toBe(false);
  });

  it("shows on the Profile too, where the Student can see that it came from Navigate360", async () => {
    await connect();

    expect(await facts()).toContainEqual(
      expect.objectContaining({
        text: "Your advisor: Riley Madeup",
        detail: "Primary Advisor · riley.madeup@temple.edu",
        origin: { type: "connection", connection: NAVIGATE360, name: "Navigate360" },
      }),
    );
  });

  it("is every advisor when there are several", async () => {
    await connect();

    await readAgain({
      team: teamAnswer(person(), person({ first_name: "Alex", email: "alex.madeup@temple.edu", relationship: "Honors Advisor" })),
    });

    expect(advisors().map((item) => item.email).sort()).toEqual(["alex.madeup@temple.edu", "riley.madeup@temple.edu"]);
  });

  it("keeps the same Contact from one read to the next, so that a Draft stays with them", async () => {
    await connect();
    const [before] = advisors();

    await backend.readNow(NAVIGATE360);

    expect(advisors().map((item) => item.id)).toEqual([before!.id]);
  });

  it("is replaced when the advisor changes, and the old one goes everywhere", async () => {
    await connect();

    await readAgain({ team: teamAnswer(person({ first_name: "Jordan", email: "jordan.madeup@temple.edu" })) });

    expect(advisors().map((item) => item.name)).toEqual(["Jordan Madeup"]);
    expect((await facts()).map((fact) => fact.text)).not.toContain("Your advisor: Riley Madeup");
  });

  it("is news when the advisor changes, but not on the first read", async () => {
    await connect();
    expect(await backend.connectionEvents(NAVIGATE360)).toEqual([]);

    await readAgain({ team: teamAnswer(person({ first_name: "Jordan", email: "jordan.madeup@temple.edu" })) });

    expect((await backend.connectionEvents(NAVIGATE360)).map((event) => event.kind)).toEqual(["new_advisor"]);
    expect(JSON.stringify(await backend.activity())).toContain("1 new advisor");
  });

  it("goes when the Student has no advisor any more, which is not the same as a page Buddy can't read", async () => {
    await connect();

    await readAgain({ team: teamAnswer() });

    expect(advisors()).toEqual([]);
    expect((await statusOf()).lastReadProblem).toBeNull();
  });

  it("stays gone when the Student deletes the fact", async () => {
    await connect();
    const fact = (await facts()).find((candidate) => candidate.text.startsWith("Your advisor"));

    expect((await backend.deleteFact(fact.id)).status).toBe(204);
    expect(advisors()).toEqual([]);

    await backend.readNow(NAVIGATE360);
    expect(advisors()).toEqual([]);
    expect((await facts()).map((candidate) => candidate.text)).not.toContain("Your advisor: Riley Madeup");
  });

  it("stays hidden after a Report, and a Report doesn't outlive the Read Permission", async () => {
    await connect();
    const [advisor] = advisors();

    expect((await backend.report(advisor!.id)).status).toBe(204);
    await backend.readNow(NAVIGATE360);
    expect(advisors()).toEqual([]);

    await backend.revokeReadPermission(NAVIGATE360);
    expect((await backend.report(advisor!.id)).status).toBe(404);
    expect(backend.storageContains("riley.madeup@temple.edu")).toBe(false);
  });
});

describe("an advisor's address, which is where a Draft goes", () => {
  it.each([
    ["isn't an address", "not an address"],
    ["isn't Temple's", "riley@example.test"],
    ["has someone else on the end", "riley@temple.edu?bcc=someone@example.test"],
  ])("doesn't make a Contact when it %s, says so, and keeps what Buddy had", async (_, email) => {
    await connect();

    await readAgain({ team: teamAnswer(person({ first_name: "Jordan", email })) });

    const names = advisors().map((item) => item.name);
    expect(names).not.toContain("Jordan Madeup");
    expect(names).toEqual(["Riley Madeup"]);
    expect((await statusOf()).lastReadProblem).toMatch(/advisor/);
    expect(backend.storageContains(email)).toBe(false);
  });

  it("makes no Contact on a first read when it's the only one", async () => {
    saveNavigate360Pages(backend.browser, { team: teamAnswer(person({ email: "someone@example.test" })) });

    await connect();

    expect(advisors()).toEqual([]);
    expect((await statusOf()).lastReadProblem).toMatch(/advisor/);
  });

  it("an advisor with none is still a Contact, so a Draft to them asks for it", async () => {
    saveNavigate360Pages(backend.browser, { team: teamAnswer(person({ email: "" })) });

    await connect();

    expect(advisors()).toEqual([expect.objectContaining({ name: "Riley Madeup", email: null })]);
  });
});

describe("something on a page pretending to be the app's answer", () => {
  it("can't choose the advisor from another host, even with the right path", async () => {
    await connect();
    const blank = { title: "Navigate360", text: "", accessibilitySnapshot: "" };
    backend.browser.savedPages.set(TEAM_PAGE, {
      ...blank,
      answers: [
        { url: TEAM_ANSWER_ADDRESS, status: 200, body: teamAnswer(person()) },
        {
          url: "https://evil.example/api/students/1/support_team",
          status: 200,
          body: teamAnswer(person({ first_name: "Someone", last_name: "Else", email: "someone.else@temple.edu" })),
        },
      ],
    });

    await backend.readNow(NAVIGATE360);

    expect(advisors().map((item) => item.email)).toEqual(["riley.madeup@temple.edu"]);
    expect(backend.storageContains("someone.else@temple.edu")).toBe(false);
  });
});

describe("a Contact from somewhere else", () => {
  beforeEach(async () => {
    backend.web.save(
      TUTTLEMAN_CONTACT_PAGE,
      `<html><head><title>An Office</title></head><body><p>${"Words. ".repeat(50)} riley.madeup@temple.edu is here.</p></body></html>`,
    );
    backend.claude.willReply(
      haikuFinds(),
      haikuFinds({ name: "Riley Madeup", kind: "contact", summary: "Runs a made-up desk.", email: "riley.madeup@temple.edu", search_terms: ["madeupdesk"] }),
      haikuFinds(),
    );
    await backend.discovery.run();
  });

  const guidebookContact = () => backend.guidebook.search("madeupdesk", { kind: "contact" })[0]!;

  it("stays as it was when Navigate360 names the same person", async () => {
    const before = guidebookContact();

    await connect();

    expect(guidebookContact()).toEqual(before);
    expect(before.sources.map((source) => source.url)).toEqual([TUTTLEMAN_CONTACT_PAGE]);
    const fromNavigate360 = advisors().find((item) => item.sources[0]!.url === LANDING_PAGE)!;
    expect(fromNavigate360.id).not.toBe(before.id);
    expect(fromNavigate360.summary).toMatch(/advisor/);
  });

  it("isn't touched when the advisor changes", async () => {
    const before = guidebookContact();
    await connect();

    await readAgain({ team: teamAnswer(person({ first_name: "Jordan", email: "jordan.madeup@temple.edu" })) });

    expect(guidebookContact()).toEqual(before);
  });

  it("isn't touched by revoking, which deletes only what Navigate360 added", async () => {
    const before = guidebookContact();
    await connect();

    await backend.revokeReadPermission(NAVIGATE360);

    expect(guidebookContact()).toEqual(before);
    expect(backend.guidebook.search("Riley Madeup", { kind: "contact" }).map((item) => item.id)).toEqual([before.id]);
  });
});

describe("upcoming appointments", () => {
  const appointment = (more: object = {}) => ({
    id: 77,
    start: "2026-11-12T19:00:00Z",
    name: "Made-up Visit",
    location: { name: "Made-up Hall 200" },
    attendees: [{ name: "Riley Madeup" }],
    ...more,
  });

  it("become Profile facts on Philadelphia's clock, with only what's still to come", async () => {
    await connect();

    const found = (await facts()).filter((fact) => fact.text.startsWith("Upcoming appointment"));
    expect(found).toEqual([
      expect.objectContaining({
        text: "Upcoming appointment: Tuesday, November 10, 2026 at 10:30 AM",
        detail: "Made-up Advising Visit · Made-up Hall 100 · with Riley Madeup",
      }),
    ]);
    expect(backend.storageContains("staff member wrote")).toBe(false);
    expect(backend.storageContains("meeting.example.test")).toBe(false);
  });

  it("are news when there's a new one and when one moves, and go when they go", async () => {
    await connect();

    await readAgain({ appointments: appointmentsAnswer(appointment()) });
    await readAgain({ appointments: appointmentsAnswer(appointment({ start: "2026-11-13T19:00:00Z" })) });

    expect((await backend.connectionEvents(NAVIGATE360)).map((event) => event.kind)).toEqual(["new_appointment", "appointment_moved"]);

    await readAgain({ appointments: appointmentsAnswer() });
    expect((await facts()).filter((fact) => fact.text.startsWith("Upcoming appointment"))).toEqual([]);
    expect((await statusOf()).lastReadProblem).toBeNull();
  });

  it("are kept when one can't be read, and the Student is told", async () => {
    await connect();

    await readAgain({ appointments: appointmentsAnswer({ id: 78, start: "soon" }) });

    expect((await facts()).map((fact) => fact.text)).toContain("Upcoming appointment: Tuesday, November 10, 2026 at 10:30 AM");
    expect((await statusOf()).lastReadProblem).toMatch(/part of Navigate360/);
  });
});

describe("a page Buddy couldn't understand is not an empty one", () => {
  it("keeps the advisor and the appointments when both answers make no sense, and says so", async () => {
    await connect();
    const [before] = advisors();
    const factsBefore = await facts();

    await readAgain({ team: "<html>Something else</html>", appointments: JSON.stringify({ data: {} }) });

    expect(advisors()).toEqual([before]);
    expect(await facts()).toEqual(factsBefore);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense/);
    expect((await statusOf()).needsLogin).toBe(false);
  });

  it("says so too when no answer turns up at all, having looked at each page twice and no more", async () => {
    await connect();
    const [before] = advisors();
    backend.browser.actions.length = 0;

    saveNavigate360PagesWithoutAnswers(backend.browser);
    await backend.readNow(NAVIGATE360);

    expect(advisors()).toEqual([before]);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense/);
    expect(pagesOpened().filter((url) => url === TEAM_PAGE)).toHaveLength(2);
    expect(pagesOpened().filter((url) => url === HOME_PAGE)).toHaveLength(2);
    expect(pagesOpened().filter((url) => url === LANDING_PAGE)).toHaveLength(1);
  });

  it("never says on a first read that there's no advisor, when it couldn't tell", async () => {
    saveNavigate360Pages(backend.browser, { team: "not what it should be", appointments: "nor this" });

    await connect();

    expect(advisors()).toEqual([]);
    expect((await statusOf()).lastReadAt).toBeNull();
    const words = navigate360.describeForClaude({ facts: [], events: [], now: new Date(), lastReadAt: null, lastReadProblem: "It failed.", needsLogin: false });
    expect(words).toMatch(/don't guess/);
    expect(words).not.toMatch(/no advisor/i);
  });

  it("keeps what it had of one when only the other could be read", async () => {
    await connect();
    const [before] = advisors();

    await readAgain({ team: "not what it should be", appointments: appointmentsAnswer() });

    expect(advisors()).toEqual([before]);
    expect((await facts()).map((fact) => fact.text)).toEqual(["Your advisor: Riley Madeup"]);
    expect((await statusOf()).lastReadProblem).toMatch(/part of Navigate360/);
  });

  it("gets the other part when only one could be read", async () => {
    await connect();

    await readAgain({ team: teamAnswer(person({ first_name: "Jordan", email: "jordan.madeup@temple.edu" })), appointments: "not what it should be" });

    expect(advisors().map((item) => item.name)).toEqual(["Jordan Madeup"]);
    expect((await facts()).map((fact) => fact.text)).toContain("Upcoming appointment: Tuesday, November 10, 2026 at 10:30 AM");
    expect((await statusOf()).lastReadProblem).toMatch(/part of Navigate360/);
  });

  it("doesn't take a team with only titles it doesn't know to mean there's no advisor", async () => {
    await connect();
    const [before] = advisors();

    await readAgain({ team: teamAnswer(person({ first_name: "Jordan", email: "jordan.madeup@temple.edu", relationship: "Success Coach" })) });

    expect(advisors()).toEqual([before]);
    expect((await statusOf()).lastReadProblem).toMatch(/advisor/);
  });

  it("isn't fooled by a title it doesn't know when it has found the advisor anyway", async () => {
    await connect();

    await readAgain({ team: teamAnswer(person(), person({ first_name: "Jordan", relationship: "Success Coach" })) });

    expect(advisors().map((item) => item.name)).toEqual(["Riley Madeup"]);
    expect((await statusOf()).lastReadProblem).toBeNull();
    expect(backend.storageContains("Jordan")).toBe(false);
  });

  it("makes the same difference in what Claude is told", () => {
    const reading = { facts: [], events: [], now: new Date("2026-11-02T14:00:00Z"), lastReadAt: new Date("2026-11-02T13:00:00Z"), needsLogin: false };

    expect(navigate360.describeForClaude({ ...reading, lastReadProblem: null })).toMatch(/shows no advisor/);
    const unsure = navigate360.describeForClaude({ ...reading, lastReadProblem: "It failed." });
    expect(unsure).not.toMatch(/shows no advisor/);
    expect(unsure).toMatch(/may be out of date/);
  });
});

describe("the two versions of the app", () => {
  it("opens the pages of whichever one the app chose for the Student", async () => {
    const answers = (url: string, body: string) => ({ url, status: 200, body });
    const blank = { title: "Navigate360", text: "", accessibilitySnapshot: "" };
    backend.browser.savedPages.set(LANDING_PAGE, { ...blank, finalUrl: V1_LANDED });
    backend.browser.savedPages.set(V1_TEAM_PAGE, { ...blank, answers: [answers(TEAM_ANSWER_ADDRESS, teamAnswer(person()))] });
    backend.browser.savedPages.set(V1_APPOINTMENTS_PAGE, {
      ...blank,
      answers: [answers("https://temple.navigate.eab.com/api/v2/scheduling/current_user", appointmentsAnswer())],
    });

    await connect();

    expect(pagesOpened()).toEqual([LANDING_PAGE, V1_APPOINTMENTS_PAGE, V1_TEAM_PAGE]);
    expect(advisors().map((item) => item.name)).toEqual(["Riley Madeup"]);
  });

  it.each([
    ["it stays on the page that chooses", undefined],
    ["the app has a version Buddy doesn't know, which no login would fix", "https://temple.navigate.eab.com/app/v3/"],
  ])("doesn't go looking or ask for a login when %s", async (_, finalUrl) => {
    backend.browser.savedPages.set(LANDING_PAGE, { title: "Navigate360", text: "", accessibilitySnapshot: "", ...(finalUrl ? { finalUrl } : {}) });

    await connect();

    expect(pagesOpened()).toEqual([LANDING_PAGE]);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense/);
    expect((await statusOf()).needsLogin).toBe(false);
  });
});

describe("the login", () => {
  it("needs one when the app ends up at its own login page, though it's still the same site", async () => {
    expireNavigate360Login(backend.browser);

    await connect();

    expect(await statusOf()).toMatchObject({ on: true, needsLogin: true, lastReadAt: null });
    expect((await statusOf()).lastReadProblem).toMatch(/Log in to Navigate360/);
    expect(pagesOpened()).toEqual([LANDING_PAGE]);
  });

  it("needs one when the server says the login has gone, and keeps what Buddy had", async () => {
    await connect();
    const [before] = advisors();
    const blank = { title: "Navigate360", text: "", accessibilitySnapshot: "" };
    backend.browser.savedPages.set(TEAM_PAGE, { ...blank, answers: [{ url: TEAM_ANSWER_ADDRESS, status: 401, body: "{}" }] });

    await backend.readNow(NAVIGATE360);

    expect((await statusOf()).needsLogin).toBe(true);
    expect(advisors()).toEqual([before]);
  });

  it("doesn't need one when the server only refuses that one thing, which logging in wouldn't fix", async () => {
    await connect();
    const blank = { title: "Navigate360", text: "", accessibilitySnapshot: "" };
    backend.browser.savedPages.set(TEAM_PAGE, { ...blank, answers: [{ url: TEAM_ANSWER_ADDRESS, status: 403, body: "{}" }] });

    await backend.readNow(NAVIGATE360);

    expect(await statusOf()).toMatchObject({ needsLogin: false });
    expect((await statusOf()).lastReadProblem).toMatch(/part of Navigate360/);
    expect(advisors().map((item) => item.name)).toEqual(["Riley Madeup"]);
  });

  it("needs one when the app leaves for a sign-on page the guard won't go to", async () => {
    await connect();
    backend.browser.savedPages.set(LANDING_PAGE, {
      title: "Sign on",
      text: "",
      accessibilitySnapshot: "",
      finalUrl: "https://elsewhere.invalid/sign-on",
    });

    await backend.readNow(NAVIGATE360);

    expect((await statusOf()).needsLogin).toBe(true);
  });

  it("says a Takeover that ends on the app's login page didn't work, and reads nothing", async () => {
    await backend.giveReadPermission(NAVIGATE360, undefined);
    expireNavigate360Login(backend.browser);
    backend.browser.actions.length = 0;
    await backend.startTakeover(NAVIGATE360);

    const finished = (await (await backend.finishTakeover()).json()) as any;

    expect(finished).toMatchObject({ site: NAVIGATE360, signedIn: false });
    expect(backend.browser.actions[0]).toEqual({ type: "show", url: LANDING_PAGE });
  });

  it("reads straight away after a Takeover that logs in", async () => {
    expireNavigate360Login(backend.browser);
    await connect();
    await backend.startTakeover(NAVIGATE360);
    saveNavigate360Pages(backend.browser);

    const finished = (await (await backend.finishTakeover()).json()) as any;
    await backend.untilReadsFinish(NAVIGATE360);

    expect(finished.signedIn).toBe(true);
    expect(advisors().map((item) => item.name)).toEqual(["Riley Madeup"]);
    expect((await statusOf()).needsLogin).toBe(false);
  });

  it("leaves everything alone during a Takeover", async () => {
    await connect();
    const [before] = advisors();
    await backend.startTakeover(NAVIGATE360);

    await backend.readNow(NAVIGATE360);

    expect((await statusOf()).lastReadProblem).toMatch(/a Takeover was open/);
    expect(advisors()).toEqual([before]);
  });
});

describe("reads", () => {
  it("show in Activity, without saying who the advisor is", async () => {
    await connect();

    const activity = JSON.stringify(await backend.activity());
    expect(activity).toMatch(/Navigate360/);
    expect(activity).not.toContain("Riley");
  });

  it("happen three times a day", async () => {
    await connect();
    backend.browser.actions.length = 0;

    await backend.readDueConnections();
    expect(pagesOpened()).toEqual([]);

    backend.clock.moveForward(5 * 3_600_000);
    await backend.readDueConnections();
    expect(pagesOpened().length).toBeGreaterThan(0);
  });

  it("ask only for pages on the list", async () => {
    await connect();

    for (const url of pagesOpened()) expect([LANDING_PAGE, HOME_PAGE, TEAM_PAGE]).toContain(url);
  });
});

describe("revoking the Read Permission", () => {
  it("deletes the facts, the advisor Contact and the login, and keeps nothing of them on disk", async () => {
    await connect();

    await backend.revokeReadPermission(NAVIGATE360);

    expect(await facts()).toEqual([]);
    expect(advisors()).toEqual([]);
    expect(await statusOf()).toMatchObject({ on: false, loginNotDeletedYet: false });
    expect(forgotten()).toEqual([[...OWN_HOSTS, ...SIGN_ON_HOSTS]]);
    expect(backend.storageContains("riley.madeup@temple.edu")).toBe(false);
  });

  it("stays revoked if a read was under way", async () => {
    await connect();
    let letReadFinish = () => {};
    backend.browser.holdReads = new Promise((resolve) => (letReadFinish = resolve));
    backend.browser.actions.length = 0;
    const reading = backend.readNow(NAVIGATE360);
    await vi.waitFor(() => expect(pagesOpened().length).toBeGreaterThan(0));

    // Deleting the login waits for the read, so the Read Permission goes first and the read then finishes.
    const revoking = backend.revokeReadPermission(NAVIGATE360);
    await vi.waitFor(async () => expect((await statusOf()).on).toBe(false));
    letReadFinish();
    await Promise.all([reading, revoking]);

    expect(advisors()).toEqual([]);
    expect(await facts()).toEqual([]);
  });

  it("brings the advisor back only with a new Read Permission", async () => {
    await connect();
    await backend.revokeReadPermission(NAVIGATE360);
    expect(advisors()).toEqual([]);

    await connect();

    expect(advisors().map((item) => item.name)).toEqual(["Riley Madeup"]);
  });
});

describe("Temple's single sign-on, which Canvas shares", () => {
  const connectCanvas = async () => {
    saveCanvasPages(backend.browser);
    await backend.giveReadPermission(canvas.id, undefined);
  };

  it("stays while Canvas still has its Read Permission, so that Canvas isn't broken for no reason", async () => {
    await connect();
    await connectCanvas();

    await backend.revokeReadPermission(NAVIGATE360);

    expect(forgotten()).toEqual([OWN_HOSTS]);
    expect((await statusOf(canvas.id)).on).toBe(true);
  });

  it("goes with the last Connection that used it, whichever way round they went", async () => {
    await connect();
    await connectCanvas();

    await backend.revokeReadPermission(canvas.id);
    await backend.revokeReadPermission(NAVIGATE360);

    expect(forgotten()).toEqual([["templeu.instructure.com", "instructure.com"], [...OWN_HOSTS, ...SIGN_ON_HOSTS]]);
  });

  it("can't get Buddy into a Connection with no Read Permission, however much of a login is left", async () => {
    await connectCanvas();
    await connect();
    await backend.revokeReadPermission(NAVIGATE360);
    backend.browser.actions.length = 0;

    await expect(backend.browserAccess.read(LANDING_PAGE)).rejects.toThrow(PageBlocked);
    await expect(backend.browserAccess.read("https://temple.campus.eab.com/api/students/7/support_team")).rejects.toThrow(PageBlocked);
    expect((await backend.startTakeover(NAVIGATE360)).status).toBe(403);
    expect((await backend.readNow(NAVIGATE360)).status).toBe(403);
    expect(pagesOpened()).toEqual([]);
  });

  it("works the same the other way round: Navigate360's login gets nothing from Canvas", async () => {
    await connect();

    await expect(backend.browserAccess.read("https://templeu.instructure.com/courses")).rejects.toThrow(PageBlocked);
  });

  it("forgetting one login by hand keeps what another Connection needs too", async () => {
    await connect();
    await connectCanvas();

    await backend.forgetLogin(canvas.id);

    expect(forgotten()).toEqual([["templeu.instructure.com", "instructure.com"]]);
  });
});
