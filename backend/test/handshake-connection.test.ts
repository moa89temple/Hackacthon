import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvas } from "../src/canvas.ts";
import { handshake } from "../src/handshake.ts";
import { settings } from "../src/settings.ts";
import { BUDDY_SYSTEM_PROMPT } from "../src/system-prompt.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { saveCanvasPages } from "./support/canvas-pages.ts";
import {
  EVENTS_LIST,
  eventPage,
  expireHandshakeLogin,
  FAIR,
  INTERNSHIP,
  JOBS_LIST,
  jobPage,
  saveHandshakePages,
} from "./support/handshake-pages.ts";
import {
  claudeSearches,
  eventPageHtml,
  eventsListHtml,
  EVENTS_LIST_PAGE,
  FLU_CLINIC,
  FLU_CLINIC_PAGE,
  haikuFindsOpportunities,
  opportunityCalls,
  outsidePageHtml,
} from "./support/opportunity-pages.ts";
import { roadmapCalls, toolCall } from "./support/roadmap-helpers.ts";

// Every Handshake page here is made up: see support/handshake-pages.ts. What these prove is what Buddy does
// with pages laid out the way it assumes, and nothing about whether real Handshake is laid out that way.

const HANDSHAKE = handshake.id;
const OWN_HOSTS = ["temple.joinhandshake.com", "joinhandshake.com", "app.joinhandshake.com"];
const SIGN_ON_HOSTS = ["fim.temple.edu", "duosecurity.com"];
const GOAL = "Become a nurse";
const OTHER_GOAL = "Study abroad";
const DAY = 24 * 3_600_000;
const NOTHING_FITS = haikuFindsOpportunities();

const internshipFound = (more: Record<string, unknown> = {}) => ({
  name: INTERNSHIP.title,
  summary: "A paid internship on a hospital ward.",
  date: "2026-12-01",
  date_kind: "deadline",
  date_quote: "December 1, 2026",
  ...more,
});
const fairFound = (more: Record<string, unknown> = {}) => ({
  name: FAIR.title,
  summary: "Meet employers on campus.",
  date: "2026-12-03",
  date_kind: "event",
  date_quote: "December 3, 2026",
  cost: "free",
  cost_quote: "This event is free.",
  ...more,
});

let backend: BackendHarness;
let calls: ReturnType<typeof opportunityCalls>;
let goals: ReturnType<typeof roadmapCalls>;

beforeEach(async () => {
  backend = await BackendHarness.start({
    sites: { handshake: settings.sites.handshake, canvas: settings.sites.canvas },
    extraConnectionTypes: [handshake, canvas],
  });
  calls = opportunityCalls(backend);
  goals = roadmapCalls(backend);
  saveHandshakePages(backend.browser);
});

afterEach(async () => {
  await backend.stop();
});

const statusOf = async (id = HANDSHAKE) => (await backend.connections()).find((connection) => connection.id === id);
const pagesOpened = () => backend.browser.actions.filter((action) => action.type === "read").map((action: any) => action.url);
const forgotten = () => backend.browser.actions.filter((action) => action.type === "forget-login").map((action: any) => action.hosts);
const connect = async () => {
  const response = await backend.giveReadPermission(HANDSHAKE, undefined);
  expect(response.status).toBe(200);
};
const askedHaiku = () => backend.claude.requests.filter((request) => request.model === "test-discovery-model");
/** A Student with this Goal, reading a Handshake where it fits the job and not the event. */
const connectFindingInternship = async (more: Record<string, unknown> = {}) => {
  await goals.addGoal(GOAL);
  backend.claude.willReply(haikuFindsOpportunities(internshipFound(more)), NOTHING_FITS);
  await connect();
};

describe("the Read Permission card", () => {
  it("says what will be read, and that it's read through a Takeover login", async () => {
    const { card, logsIn, on } = await statusOf();

    expect(on).toBe(false);
    expect(logsIn).toBe(true);
    expect(card.reads.join(" ")).toMatch(/jobs/i);
    expect(card.reads.join(" ")).toMatch(/internships/i);
    expect(card.reads.join(" ")).toMatch(/events/i);
    expect(card.notes.join(" ")).toMatch(/Takeover/);
    expect(card.notes.join(" ")).toMatch(/password/);
    expect(card.address).toBeNull();
  });

  it("says Buddy never applies, RSVPs or messages, and what goes to Claude", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/never applies/);
    expect(notes).toMatch(/RSVP/);
    expect(notes).toMatch(/message/);
    expect(notes).toMatch(/Claude/);
    expect(notes).toMatch(/Goals/);
  });

  it("says what revoking deletes", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/revoke/);
    expect(notes).toMatch(/Opportunity/);
    expect(notes).toMatch(/login/);
  });

  it("warns as the other unread services' cards do, and claims nothing about what Handshake's rules say", async () => {
    const { warning } = (await statusOf()).card;

    expect(warning).toMatch(/hasn't been able to check whether Handshake's own terms allow/);
    expect(warning).toMatch(/Temple's Guidelines for Generative AI/);
    expect(warning).not.toMatch(/\b(forbid|forbids|prohibit|prohibits|bans?|allows? it)\b/i);
  });
});

describe("logging in", () => {
  it("asks the Student for a Takeover when there's no login, and tells Claude nothing was read", async () => {
    expireHandshakeLogin(backend.browser);

    await connect();

    const status = await statusOf();
    expect(status.needsLogin).toBe(true);
    expect(status.lastReadProblem).toMatch(/Log in to Handshake/);
    expect(askedHaiku()).toEqual([]);
  });

  it("opens Handshake for the Takeover, and reads as soon as the Student has logged in", async () => {
    expireHandshakeLogin(backend.browser);
    await connect();

    expect((await backend.startTakeover(HANDSHAKE)).status).toBe(200);
    expect(backend.browser.actions).toContainEqual({ type: "show", url: settings.sites.handshake!.homeUrl });

    saveHandshakePages(backend.browser);
    backend.browser.savedPages.set(settings.sites.handshake!.homeUrl, { title: "Handshake", text: "", accessibilitySnapshot: "", finalUrl: "https://app.joinhandshake.com/stu" });
    const finished = (await (await backend.finishTakeover()).json()) as { signedIn: boolean };
    await backend.untilReadsFinish(HANDSHAKE);

    expect(finished.signedIn).toBe(true);
    const status = await statusOf();
    expect(status.needsLogin).toBe(false);
    expect(status.lastReadAt).not.toBeNull();
  });

  it("doesn't take the login page for a login that worked", async () => {
    expireHandshakeLogin(backend.browser);
    await connect();
    await backend.startTakeover(HANDSHAKE);
    backend.browser.savedPages.set(settings.sites.handshake!.homeUrl, { title: "Log in", text: "", accessibilitySnapshot: "", finalUrl: "https://temple.joinhandshake.com/login" });

    const finished = (await (await backend.finishTakeover()).json()) as { signedIn: boolean };

    expect(finished.signedIn).toBe(false);
  });
});

describe("reading listings into Opportunities", () => {
  it("makes an Opportunity of a job that fits a Goal, with its date and its Source", async () => {
    await connectFindingInternship();

    const [opportunity, ...others] = await calls.list();
    expect(others).toEqual([]);
    expect(opportunity.name).toBe(INTERNSHIP.title);
    expect(opportunity.date).toBe("2026-12-01");
    expect(opportunity.when).toBe("Apply by Tuesday, December 1, 2026");
    expect(opportunity.forGoals).toEqual([GOAL]);
    expect(opportunity.sources).toEqual([expect.objectContaining({ url: jobPage(INTERNSHIP.id), title: `${INTERNSHIP.title} | Handshake` })]);
  });

  it("makes an Opportunity of an event that fits a Goal", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply(NOTHING_FITS, haikuFindsOpportunities(fairFound()));

    await connect();

    const [opportunity] = await calls.list();
    expect(opportunity.name).toBe(FAIR.title);
    expect(opportunity.when).toBe("Thursday, December 3, 2026");
    expect(opportunity.sources[0].url).toBe(eventPage(FAIR.id));
  });

  it("labels it as outside Temple, by its Source's address, whatever the page says", async () => {
    await connectFindingInternship();

    expect((await calls.list())[0].outsideTemple).toBe(true);
  });

  it("opens only the two lists and each listing's own page", async () => {
    await connectFindingInternship();

    expect(pagesOpened()).toEqual([JOBS_LIST, EVENTS_LIST, jobPage(INTERNSHIP.id), eventPage(FAIR.id)]);
  });

  it("keeps what doesn't fit a Goal out of the Opportunities", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply(haikuFindsOpportunities(internshipFound({ for_goals: [] })), NOTHING_FITS);

    await connect();

    expect(await calls.list()).toEqual([]);
  });

  it("asks about all the Student's Goals at once, in one request for each listing", async () => {
    await goals.addGoal(GOAL);
    await goals.addGoal(OTHER_GOAL);
    backend.claude.willReply(haikuFindsOpportunities(internshipFound({ for_goals: [2] })), NOTHING_FITS);

    await connect();

    expect(askedHaiku()).toHaveLength(2);
    const asked = JSON.stringify(askedHaiku()[0]!.messages);
    expect(asked).toContain(GOAL);
    expect(asked).toContain(OTHER_GOAL);
    expect((await calls.list())[0].forGoals).toEqual([OTHER_GOAL]);
  });

  it("opens no listing and asks nothing when the Student has no Goal to match", async () => {
    await connect();

    expect(pagesOpened()).toEqual([JOBS_LIST, EVENTS_LIST]);
    expect(askedHaiku()).toEqual([]);
    expect((await statusOf()).lastReadProblem).toBeNull();
  });

  it("doesn't send Claude the Student's name from around the listing", async () => {
    await connectFindingInternship();

    expect(JSON.stringify(askedHaiku())).not.toContain("Madeup Student");
  });

  it("keeps nothing from Handshake in the Profile", async () => {
    await connectFindingInternship();

    expect(await backend.profileFacts()).toEqual([]);
  });
});

describe("the Guidebook's rules on dates", () => {
  it("leaves out a listing whose date isn't in its page's words", async () => {
    await connectFindingInternship({ date: "2026-12-25", date_quote: "December 25, 2026" });

    expect(await calls.list()).toEqual([]);
  });

  it("leaves out a listing with no date, because it's not something the Student can miss", async () => {
    await connectFindingInternship({ date_quote: null });

    expect(await calls.list()).toEqual([]);
  });

  it("stops showing it once its date has passed", async () => {
    await connectFindingInternship();
    expect(await calls.list()).toHaveLength(1);

    backend.clock.moveForward(30 * DAY);

    expect(await calls.list()).toEqual([]);
  });
});

describe("the Guidebook's rules on fees", () => {
  const withFee = { ...INTERNSHIP, words: "Apply by December 1, 2026. The application fee is $25." };
  const fee = { cost: "paid", cost_amount: "$25", cost_quote: "The application fee is $25." };

  beforeEach(() => {
    saveHandshakePages(backend.browser, { jobs: [withFee] });
  });

  it("always says what it costs, and why it's worth it", async () => {
    await connectFindingInternship({ ...fee, worth_it_because: "It leads to a nursing job." });

    const [opportunity] = await calls.list();
    expect(opportunity.cost).toBe("Costs $25");
    expect(opportunity.worthItBecause).toBe("It leads to a nursing job.");
  });

  it("hides one with a fee and no reason it's worth it", async () => {
    await connectFindingInternship(fee);

    expect(await calls.list()).toEqual([]);
  });

  it("hides one whose fee isn't in its page's words", async () => {
    await connectFindingInternship({ ...fee, cost_amount: "$10", worth_it_because: "It leads to a nursing job." });

    expect(await calls.list()).toEqual([]);
  });

  it("puts free ones before those with a fee", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply(
      haikuFindsOpportunities(internshipFound({ ...fee, worth_it_because: "It leads to a nursing job." })),
      haikuFindsOpportunities(fairFound()),
    );

    await connect();

    expect((await calls.list()).map(({ name }) => name)).toEqual([FAIR.title, INTERNSHIP.title]);
  });

  it("says nothing is free unless its page does", async () => {
    saveHandshakePages(backend.browser);
    await connectFindingInternship();

    expect((await calls.list())[0].cost).toBe("Its Source doesn't say what this costs.");
  });
});

describe("reading again", () => {
  beforeEach(async () => {
    await connectFindingInternship();
    backend.browser.actions.length = 0;
    backend.claude.requests.length = 0;
  });

  it("doesn't open a listing it read this week, or ask about it again", async () => {
    backend.clock.moveForward(DAY);

    await backend.readNow(HANDSHAKE);

    expect(pagesOpened()).toEqual([JOBS_LIST, EVENTS_LIST]);
    expect(askedHaiku()).toEqual([]);
    expect(await calls.list()).toHaveLength(1);
  });

  it("opens a listing again after a week, and asks nothing if its words are the same", async () => {
    backend.clock.moveForward(7 * DAY);

    await backend.readNow(HANDSHAKE);

    expect(pagesOpened()).toEqual([JOBS_LIST, EVENTS_LIST, jobPage(INTERNSHIP.id), eventPage(FAIR.id)]);
    expect(askedHaiku()).toEqual([]);
    expect(await calls.list()).toHaveLength(1);
  });

  it("opens each one again for a new Goal, and asks about that Goal", async () => {
    await goals.addGoal(OTHER_GOAL);
    backend.claude.willReply(haikuFindsOpportunities(internshipFound({ for_goals: [1, 2] })), NOTHING_FITS);

    await backend.readNow(HANDSHAKE);

    expect(pagesOpened()).toEqual([JOBS_LIST, EVENTS_LIST, jobPage(INTERNSHIP.id), eventPage(FAIR.id)]);
    expect((await calls.list())[0].forGoals).toEqual([GOAL, OTHER_GOAL]);
  });

  it("stops showing it when its Goal goes", async () => {
    const [goal] = await goals.goals();

    await goals.removeGoal(goal.id);

    expect(await calls.list()).toEqual([]);
  });

  it("makes no new listing out of one it's already taken in", async () => {
    backend.clock.moveForward(7 * DAY);
    await backend.readNow(HANDSHAKE);

    expect((await calls.list()).map(({ name }) => name)).toEqual([INTERNSHIP.title]);
  });
});

describe("when part of a read goes wrong", () => {
  it("says so, and keeps what the rest found, when one list isn't what it should be", async () => {
    await goals.addGoal(GOAL);
    backend.browser.savedPages.set(EVENTS_LIST, { title: "Handshake", text: "", accessibilitySnapshot: "", html: "<main>Something new</main>" });
    backend.claude.willReply(haikuFindsOpportunities(internshipFound()));

    await connect();

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read part of Handshake/);
    expect(await calls.list()).toHaveLength(1);
  });

  it("says it couldn't make sense of Handshake, and keeps what it has, when neither list is what it should be", async () => {
    await connectFindingInternship();
    for (const url of [JOBS_LIST, EVENTS_LIST]) {
      backend.browser.savedPages.set(url, { title: "Handshake", text: "", accessibilitySnapshot: "", html: "<main>Something new</main>" });
    }

    await backend.readNow(HANDSHAKE);

    const status = await statusOf();
    expect(status.lastReadProblem).toMatch(/couldn't make sense of it/);
    expect(status.needsLogin).toBe(false);
    expect(await calls.list()).toHaveLength(1);
  });

  it("carries on when one listing's page can't be understood, and looks at it again next time", async () => {
    await goals.addGoal(GOAL);
    backend.browser.savedPages.set(jobPage(INTERNSHIP.id), { title: "Handshake", text: "", accessibilitySnapshot: "", html: "<div>No main part</div>" });
    backend.claude.willReply(haikuFindsOpportunities(fairFound()));

    await connect();

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read part of Handshake/);
    expect((await calls.list()).map(({ name }) => name)).toEqual([FAIR.title]);

    saveHandshakePages(backend.browser);
    backend.claude.willReply(haikuFindsOpportunities(internshipFound()));
    await backend.readNow(HANDSHAKE);

    expect((await statusOf()).lastReadProblem).toBeNull();
    // Free first.
    expect((await calls.list()).map(({ name }) => name)).toEqual([FAIR.title, INTERNSHIP.title]);
  });

  it("doesn't take what a listing sent the browser elsewhere to for the listing", async () => {
    await goals.addGoal(GOAL);
    backend.browser.savedPages.set(jobPage(INTERNSHIP.id), {
      title: "Handshake",
      text: "",
      accessibilitySnapshot: "",
      finalUrl: "https://app.joinhandshake.com/stu",
      html: `<main>${"Your Handshake home page, with what you've been up to. ".repeat(3)}</main>`,
    });
    backend.claude.willReply(NOTHING_FITS);

    await connect();

    expect(askedHaiku()).toHaveLength(1);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read part of Handshake/);
  });

  it("carries on when Claude fails on one listing, keeps nothing wrong, and asks again next time", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply({ failWith: new Error("Overloaded") }, NOTHING_FITS);

    await connect();

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read part of Handshake/);
    expect(await calls.list()).toEqual([]);

    backend.claude.willReply(haikuFindsOpportunities(internshipFound()));
    await backend.readNow(HANDSHAKE);

    expect(await calls.list()).toHaveLength(1);
  });

  it("asks for a login when one runs out partway through", async () => {
    await goals.addGoal(GOAL);
    backend.browser.savedPages.set(jobPage(INTERNSHIP.id), { title: "Log in", text: "", accessibilitySnapshot: "", finalUrl: "https://temple.joinhandshake.com/login" });

    await connect();

    expect((await statusOf()).needsLogin).toBe(true);
    expect(askedHaiku()).toEqual([]);
  });

  it("asks for a login when the guard refuses where both lists went, such as an unknown way to log in", async () => {
    const elsewhere = { title: "", text: "", accessibilitySnapshot: "", finalUrl: "https://elsewhere.invalid/sign-on" };
    backend.browser.savedPages.set(JOBS_LIST, elsewhere);
    backend.browser.savedPages.set(EVENTS_LIST, elsewhere);

    await connect();

    expect((await statusOf()).needsLogin).toBe(true);
  });

  it("says Buddy's Browser couldn't open it when the browser is stopped, and doesn't ask for a login", async () => {
    backend.browser.unreachable = true;

    await connect();

    const status = await statusOf();
    expect(status.lastReadProblem).toMatch(/couldn't open Handshake/);
    expect(status.needsLogin).toBe(false);
  });

  it("doesn't read while the Student is in a Takeover", async () => {
    await connect();
    await backend.startTakeover(HANDSHAKE);
    backend.browser.actions.length = 0;

    await backend.readNow(HANDSHAKE);

    expect(pagesOpened()).toEqual([]);
    expect((await statusOf()).lastReadProblem).toMatch(/Takeover/);
  });
});

describe("Activity", () => {
  it("shows the Read Permission and each read, with nothing about what was read", async () => {
    await connectFindingInternship();

    const entries = await backend.activity();
    const titles = entries.map(({ title }) => title);
    expect(titles).toContain("Buddy read Handshake");
    expect(titles).toContain("You gave Buddy a Read Permission for Handshake");
    expect(JSON.stringify(entries)).not.toContain(INTERNSHIP.title);
  });

  it("shows a read that failed", async () => {
    expireHandshakeLogin(backend.browser);

    await connect();

    expect((await backend.activity()).map(({ title }) => title)).toContain("Buddy couldn't read Handshake");
  });

  it("shows a read that missed something, with what the Student should know", async () => {
    await goals.addGoal(GOAL);
    backend.browser.savedPages.set(jobPage(INTERNSHIP.id), { title: "Handshake", text: "", accessibilitySnapshot: "", html: "<div></div>" });
    backend.claude.willReply(NOTHING_FITS);

    await connect();

    const read = (await backend.activity()).find(({ title }) => title === "Buddy read Handshake");
    expect(read.detail).toMatch(/couldn't read part of Handshake/);
  });
});

describe("keeping Opportunities current, the way the Guidebook does", () => {
  /** Discovery's daily round, with a list of Temple's events to go by and nothing found for the Goal. */
  const discoveryRuns = () => {
    backend.web.save(EVENTS_LIST_PAGE, eventsListHtml(FLU_CLINIC));
    backend.web.save(FLU_CLINIC_PAGE, eventPageHtml(FLU_CLINIC.name, "A flu clinic."));
    backend.claude.whenScriptRunsOut = claudeSearches([]);
    return backend.opportunityDiscovery.runDue();
  };

  it("leaves after two weeks gone from Handshake's lists", async () => {
    await connectFindingInternship();

    saveHandshakePages(backend.browser, { jobs: [{ ...INTERNSHIP, id: 999 }] });
    backend.clock.moveForward(8 * DAY);
    backend.claude.willReply(NOTHING_FITS);
    await backend.readNow(HANDSHAKE);
    expect((await calls.list()).map(({ name }) => name)).toEqual([INTERNSHIP.title]);

    backend.clock.moveForward(7 * DAY);
    await discoveryRuns();

    expect((await calls.list()).map(({ name }) => name)).not.toContain(INTERNSHIP.title);
  });

  it("stays while it's on the list, however long since its page was opened", async () => {
    await connectFindingInternship();

    // Nearly three weeks, which is before its date and past the two weeks it would last if nothing confirmed it.
    for (let week = 0; week < 3; week++) {
      backend.clock.moveForward(6 * DAY);
      await backend.readNow(HANDSHAKE);
      await discoveryRuns();
    }

    expect((await calls.list()).map(({ name }) => name)).toContain(INTERNSHIP.title);
  });

  it("is never read by Discovery, which has no login and would get a login page", async () => {
    await connectFindingInternship();
    backend.browser.actions.length = 0;

    backend.clock.moveForward(8 * DAY);
    await discoveryRuns();

    expect(backend.web.requests.filter((url) => url.includes("joinhandshake"))).toEqual([]);
    expect(pagesOpened().filter((url: string) => url.includes("joinhandshake"))).toEqual([]);
  });
});

describe("Opportunities in a conversation", () => {
  it("are found the same way as any other, with a card and its Source", async () => {
    await connectFindingInternship();
    backend.claude.willReply(toolCall("find_opportunities", { query: "nursing internship" }), { chunks: ["There's one."] });

    const events = await backend.sendAndCollect("Any internships for me?");

    const card = events.find((event) => event.type === "opportunity_card");
    expect(card.opportunity.name).toBe(INTERNSHIP.title);
    expect(card.opportunity.sources[0].url).toBe(jobPage(INTERNSHIP.id));
    expect(card.opportunity.outsideTemple).toBe(true);
  });

  it("are told about in each turn's note, once it's on", async () => {
    await connectFindingInternship();
    backend.claude.willReply({ chunks: ["Hello."] });

    await backend.sendAndCollect("Hello");

    expect(JSON.stringify(backend.claude.requests.at(-1)!.messages)).toMatch(/Handshake is connected, last read/);
  });

  it("can be offered as a Connection, and adds no tool of its own", async () => {
    backend.claude.willReply({ chunks: ["Hello."] });

    await backend.sendAndCollect("Hello");

    const tools = backend.claude.requests.at(-1)!.tools as any[];
    expect(tools.find((tool) => tool.name === "suggest_connection").input_schema.properties.connection.enum).toContain(HANDSHAKE);
    expect(tools.map((tool) => tool.name).filter((name) => /handshake/i.test(name))).toEqual([]);
  });

  it("are explained to Claude: it reads, and never applies, RSVPs or messages", () => {
    expect(BUDDY_SYSTEM_PROMPT).toMatch(/Handshake is a Connection too/);
    expect(BUDDY_SYSTEM_PROMPT).toMatch(/never applies to, RSVPs to or messages anything on Handshake/);
    expect(BUDDY_SYSTEM_PROMPT).toMatch(/you never ask for a password or a Duo code/);
  });
});

describe("revoking the Read Permission", () => {
  it("deletes what came from Handshake and the login, and keeps nothing of them on disk", async () => {
    await connectFindingInternship();
    const [opportunity] = await calls.list();
    await calls.save(opportunity.id);

    await backend.revokeReadPermission(HANDSHAKE);

    expect(await calls.list()).toEqual([]);
    expect(await statusOf()).toMatchObject({ on: false, loginNotDeletedYet: false });
    expect(forgotten()).toEqual([[...OWN_HOSTS, ...SIGN_ON_HOSTS]]);
    expect(backend.storageContains(INTERNSHIP.title)).toBe(false);
    expect(backend.storageContains("joinhandshake")).toBe(false);
  });

  it("says so in Activity", async () => {
    await connectFindingInternship();

    await backend.revokeReadPermission(HANDSHAKE);

    const entries = await backend.activity();
    const revoked = entries.find(({ title }) => title === "You revoked the Read Permission for Handshake");
    expect(revoked.detail).toMatch(/every Opportunity that came only from it/);
    expect(entries.map(({ title }) => title)).toContain("Buddy deleted your Handshake login");
  });

  it("doesn't come back with a card it showed before", async () => {
    await connectFindingInternship();
    backend.claude.willReply(toolCall("find_opportunities", { query: "nursing internship" }), { chunks: ["There's one."] });
    await backend.sendAndCollect("Any internships for me?");

    await backend.revokeReadPermission(HANDSHAKE);

    const history = await backend.history();
    expect(history.find((entry) => entry.type === "opportunity_card").opportunity).toBeNull();
    expect(JSON.stringify(history)).not.toContain(jobPage(INTERNSHIP.id));
  });

  it("leaves what also came from somewhere else, with only that as its Source", async () => {
    const page = "https://www.nursing-foundation.example/internship";
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches([page]));
    backend.web.save(page, outsidePageHtml("The internship", "A paid internship on a hospital ward. Apply by December 1, 2026."));
    backend.claude.willReply(haikuFindsOpportunities(internshipFound()));
    backend.web.save(EVENTS_LIST_PAGE, eventsListHtml());
    await backend.opportunityDiscovery.runDue();

    backend.claude.willReply(haikuFindsOpportunities(internshipFound()), NOTHING_FITS);
    await connect();
    expect((await calls.list())[0].sources.map(({ url }: any) => url).toSorted()).toEqual([jobPage(INTERNSHIP.id), page].toSorted());

    await backend.revokeReadPermission(HANDSHAKE);

    const [left] = await calls.list();
    expect(left.sources.map(({ url }: any) => url)).toEqual([page]);
  });

  it("leaves everything else in the Guidebook where it is", async () => {
    await connectFindingInternship();
    const page = "https://www.nursing-foundation.example/scholarship";
    backend.claude.willReply(claudeSearches([page]));
    backend.web.save(page, outsidePageHtml("A scholarship", "Applications close December 5, 2026."));
    backend.claude.willReply(haikuFindsOpportunities({ name: "A scholarship", summary: "Pays for school.", date: "2026-12-05", date_quote: "December 5, 2026" }));
    backend.web.save(EVENTS_LIST_PAGE, eventsListHtml());
    await backend.opportunityDiscovery.runDue();

    await backend.revokeReadPermission(HANDSHAKE);

    expect((await calls.list()).map(({ name }) => name)).toEqual(["A scholarship"]);
  });

  it("keeps a Report, so that what the Student reported stays hidden if they connect again", async () => {
    await connectFindingInternship();
    const [opportunity] = await calls.list();
    await calls.report(opportunity.id);

    await backend.revokeReadPermission(HANDSHAKE);
    saveHandshakePages(backend.browser);
    backend.claude.willReply(haikuFindsOpportunities(internshipFound()), NOTHING_FITS);
    await connect();

    expect(await calls.list()).toEqual([]);
  });

  it("keeps nothing Claude finishes saying after the revoke", async () => {
    await goals.addGoal(GOAL);
    let answer = () => {};
    backend.claude.willReply({ ...haikuFindsOpportunities(internshipFound()), holdBeforeAnswering: new Promise((resolve) => (answer = resolve)) }, NOTHING_FITS);
    const giving = backend.giveReadPermission(HANDSHAKE, undefined);
    await vi.waitFor(() => expect(askedHaiku().length).toBeGreaterThan(0));

    const revoking = backend.revokeReadPermission(HANDSHAKE);
    await vi.waitFor(async () => expect((await statusOf()).on).toBe(false));
    answer();
    await Promise.all([giving, revoking]);

    expect(await calls.list()).toEqual([]);
    expect(backend.storageContains(INTERNSHIP.title)).toBe(false);
    expect((await statusOf()).on).toBe(false);
  });

  it("carries on trying to delete the login until Buddy's Browser can be reached", async () => {
    await connectFindingInternship();
    backend.browser.unreachable = true;

    await backend.revokeReadPermission(HANDSHAKE);

    expect((await statusOf()).loginNotDeletedYet).toBe(true);
    expect(await calls.list()).toEqual([]);

    backend.browser.unreachable = false;
    await backend.readDueConnections();

    expect((await statusOf()).loginNotDeletedYet).toBe(false);
  });
});

describe("Temple's single sign-on, which Canvas shares", () => {
  it("stays while Canvas still has its Read Permission, and goes with the last of them", async () => {
    saveCanvasPages(backend.browser);
    await connectFindingInternship();
    expect((await backend.giveReadPermission(canvas.id, undefined)).status).toBe(200);

    await backend.revokeReadPermission(HANDSHAKE);

    expect(forgotten()).toEqual([OWN_HOSTS]);
    expect(await statusOf(canvas.id)).toMatchObject({ on: true });
  });
});
