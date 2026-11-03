import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness } from "./support/backend-harness.ts";
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
  searchBlocks,
} from "./support/opportunity-pages.ts";
import { roadmapCalls } from "./support/roadmap-helpers.ts";
import { textBlock } from "./support/scripted-claude.ts";

const DAY = 24 * 3_600_000;
const NOTHING_ON_THE_PAGE = haikuFindsOpportunities();
const SCHOLARSHIP_PAGE = "https://www.nursing-foundation.example/scholarship";
const TEMPLE_PROGRAM_PAGE = "https://careercenter.temple.edu/internship-program";
const CAMP_PAGE = "https://www.camp.example/summer";
const SCHOLARSHIP_WORDS = "The Nursing Scholarship application closes December 1, 2026. Applying costs nothing, and there is no fee.";
const GOAL = "Get into nursing school";

let backend: BackendHarness;
let calls: ReturnType<typeof opportunityCalls>;
let goals: ReturnType<typeof roadmapCalls>;

beforeEach(async () => {
  backend = await BackendHarness.start();
  calls = opportunityCalls(backend);
  goals = roadmapCalls(backend);
});

afterEach(async () => {
  await backend.stop();
});

function hasEvents(...events: (typeof FLU_CLINIC)[]): void {
  backend.web.save(EVENTS_LIST_PAGE, eventsListHtml(...events));
}

/** The flu clinic on the list and its own page, with the words given. */
function hasFluClinic(words = "Get a free flu shot from Student Health. This event is free."): void {
  hasEvents(FLU_CLINIC);
  backend.web.save(FLU_CLINIC_PAGE, eventPageHtml(FLU_CLINIC.name, words));
}

const fluClinicFound = (fields: Record<string, unknown> = {}) =>
  haikuFindsOpportunities({ summary: "A free flu shot.", cost: "free", cost_quote: "This event is free.", ...fields });

/** A Goal the Student has, whose search finds only this page. */
async function goalFinds(url: string, title: string, words: string, ...found: Record<string, unknown>[]): Promise<void> {
  await goals.addGoal(GOAL);
  backend.claude.willReply(claudeSearches([url]));
  backend.web.save(url, outsidePageHtml(title, words));
  backend.claude.willReply(haikuFindsOpportunities(...found));
}

const scholarship = {
  name: "Nursing Scholarship",
  summary: "An award for nursing students.",
  date: "2026-12-01",
  date_quote: "December 1, 2026",
  cost: "free",
  cost_quote: "there is no fee",
};

describe("reading events from now.temple.edu", () => {
  it("turns each event into an Opportunity with its date and its Source", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound());

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([
      expect.objectContaining({
        name: "Flu Shot Clinic",
        summary: "A free flu shot.",
        when: "Tuesday, November 10, 2026, 12:00 pm to 1:00 pm",
        date: "2026-11-10",
        cost: "Free",
        outsideTemple: false,
        saved: false,
        sources: [{ url: FLU_CLINIC_PAGE, title: "Flu Shot Clinic | Temple Now", lastSeenAt: "2026-11-02T14:00:00.000Z" }],
      }),
    ]);
  });

  it("takes the name and date from the list, whatever Haiku says about them", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound({ name: "Something else", date: "2030-01-01" }));

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([expect.objectContaining({ name: "Flu Shot Clinic", date: "2026-11-10" })]);
  });

  it("reads the list and the event's page with plain fetches when those work, leaving the browser alone", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound());

    await backend.opportunityDiscovery.runDue();

    expect(backend.web.requests).toContain(EVENTS_LIST_PAGE);
    expect(backend.web.requests).toContain(FLU_CLINIC_PAGE);
    expect(backend.browser.actions).toEqual([]);
  });

  it("goes on to the next page of the list, and stops where the list ends", async () => {
    hasEvents(FLU_CLINIC);
    backend.web.save(FLU_CLINIC_PAGE, eventPageHtml(FLU_CLINIC.name, "Free shots. This event is free."));
    const other = { slug: "open-mic", date: "2026-11-11", time: "Wed., Nov. 11, 2026 7:30 pm", name: "Open Mic" };
    backend.web.save(`${EVENTS_LIST_PAGE}?page=1`, eventsListHtml(other));
    backend.web.save(`https://now.temple.edu/events/${other.date}/${other.slug}`, eventPageHtml(other.name, "Sing a song on the stage."));
    backend.web.save(`${EVENTS_LIST_PAGE}?page=2`, "<html><body>There are no more events.</body></html>");
    backend.claude.willReply(fluClinicFound(), haikuFindsOpportunities({ summary: "Sing." }));

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Flu Shot Clinic", "Open Mic"]);
    expect(backend.web.requests).not.toContain(`${EVENTS_LIST_PAGE}?page=3`);
  });

  it("leaves out an event that isn't open to Students", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound({ open_to_students: false }));

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("asks Haiku about an event's page again only when its words have changed", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound());
    await backend.opportunityDiscovery.runDue();
    const asked = backend.claude.requests.length;

    backend.clock.moveForward(DAY);
    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toHaveLength(asked);

    hasFluClinic("New words. This event is free.");
    backend.claude.willReply(fluClinicFound({ summary: "Shots with new words." }));
    backend.clock.moveForward(DAY);
    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toHaveLength(asked + 1);
    expect((await calls.list())[0].summary).toBe("Shots with new words.");
  });

  it("reads once a day, from 6 a.m. on Philadelphia's clock", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound());
    await backend.opportunityDiscovery.runDue();
    const fetched = backend.web.requests.length;

    await backend.opportunityDiscovery.runDue();
    expect(backend.web.requests).toHaveLength(fetched);

    backend.clock.moveForward(DAY);
    await backend.opportunityDiscovery.runDue();
    expect(backend.web.requests.length).toBeGreaterThan(fetched);
  });

  it("says so in Activity, and how many it read", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound());

    await backend.opportunityDiscovery.runDue();

    expect(await backend.activity()).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "opportunities_read", title: "Buddy read Temple's events", detail: "Read 1 of 1 events on now.temple.edu." })]),
    );
  });

  it("leaves things as they were if Haiku fails on a page, and asks again next time", async () => {
    hasFluClinic();
    backend.claude.willReply({ failWith: new Error("Overloaded") });
    await backend.opportunityDiscovery.runDue();
    expect(await calls.list()).toEqual([]);

    backend.claude.willReply(fluClinicFound());
    backend.clock.moveForward(DAY);
    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toHaveLength(1);
  });

  it("tells Activity once a day if the list doesn't answer, and tries again each hour", async () => {
    backend.web.unreachable = true;
    backend.browser.unreachable = true;
    await backend.opportunityDiscovery.runDue();
    const failures = async () => (await backend.activity()).filter((entry) => entry.kind === "opportunities_read_failed");
    expect(await failures()).toHaveLength(1);

    const asked = backend.web.requests.length;
    await backend.opportunityDiscovery.runDue();
    expect(backend.web.requests).toHaveLength(asked);

    backend.clock.moveForward(3_600_000);
    await backend.opportunityDiscovery.runDue();
    expect(backend.web.requests.length).toBeGreaterThan(asked);
    expect(await failures()).toHaveLength(1);
  });
});

describe("pages that need a full browser", () => {
  const scriptBuilt = (html: string) => ({ title: "Built", text: "Built", accessibilitySnapshot: "", html });

  it("reads the list through Buddy's Browser when a plain fetch finds nothing on it", async () => {
    backend.web.save(EVENTS_LIST_PAGE, "<html><body><div id='app'>Please wait</div></body></html>");
    backend.browser.savedPages.set(EVENTS_LIST_PAGE, scriptBuilt(eventsListHtml(FLU_CLINIC)));
    backend.web.save(FLU_CLINIC_PAGE, eventPageHtml(FLU_CLINIC.name, "Free shots. This event is free."));
    backend.claude.willReply(fluClinicFound());

    await backend.opportunityDiscovery.runDue();

    expect(backend.browser.actions).toContainEqual({ type: "read", url: EVENTS_LIST_PAGE });
    expect((await calls.list())[0].name).toBe("Flu Shot Clinic");
  });

  it("reads an event's page through Buddy's Browser when a plain fetch finds no event on it", async () => {
    hasEvents(FLU_CLINIC);
    backend.web.save(FLU_CLINIC_PAGE, "<html><body><div id='app'>Please wait</div></body></html>");
    backend.browser.savedPages.set(FLU_CLINIC_PAGE, scriptBuilt(eventPageHtml(FLU_CLINIC.name, "Free shots. This event is free.")));
    backend.claude.willReply(fluClinicFound());

    await backend.opportunityDiscovery.runDue();

    expect(backend.browser.actions).toContainEqual({ type: "read", url: FLU_CLINIC_PAGE });
    expect((await calls.list())[0].cost).toBe("Free");
  });

  it("reads a search result that turns plain fetches away through Buddy's Browser", async () => {
    hasEvents();
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE]));
    backend.web.save(SCHOLARSHIP_PAGE, "Forbidden", 403);
    backend.browser.savedPages.set(SCHOLARSHIP_PAGE, scriptBuilt(outsidePageHtml("Nursing Scholarship", SCHOLARSHIP_WORDS)));
    backend.claude.willReply(haikuFindsOpportunities(scholarship));

    await backend.opportunityDiscovery.runDue();

    expect(backend.browser.actions).toContainEqual({ type: "read", url: SCHOLARSHIP_PAGE });
    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Nursing Scholarship"]);
  });

  it("carries on without a page Buddy's Browser can't read either, and Activity says which", async () => {
    hasEvents();
    await goals.addGoal(GOAL);
    backend.web.save(TEMPLE_PROGRAM_PAGE, outsidePageHtml("Internship Program", "Applications close December 15, 2026."));
    backend.claude.willReply(
      claudeSearches([SCHOLARSHIP_PAGE, TEMPLE_PROGRAM_PAGE]),
      haikuFindsOpportunities({ name: "Internship Program", date: "2026-12-15", date_quote: "December 15, 2026" }),
    );

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Internship Program"]);
    const entry = (await backend.activity()).find((candidate) => candidate.kind === "opportunity_search");
    expect(entry.detail).toContain("Read 1 of the 2 pages");
    expect(entry.detail).toContain(SCHOLARSHIP_PAGE);
  });

  it("says which pages it couldn't read when it couldn't read any of them", async () => {
    hasEvents();
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE]));

    await backend.opportunityDiscovery.runDue();

    const entry = (await backend.activity()).find((candidate) => candidate.kind === "opportunity_search_failed");
    expect(entry.detail).toContain(SCHOLARSHIP_PAGE);
  });

  it("stays out of Buddy's Browser during a Takeover", async () => {
    backend.web.save(EVENTS_LIST_PAGE, "<html><body>Please wait</body></html>");
    await backend.startTakeover("canvas");
    backend.browser.actions.length = 0;

    await backend.opportunityDiscovery.runDue();

    expect(backend.browser.actions).toEqual([]);
  });
});

describe("searching the web for the Student's Goals", () => {
  beforeEach(() => hasEvents());

  it("uses Claude's web search tool, with the Goal's words", async () => {
    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, scholarship);

    await backend.opportunityDiscovery.runDue();

    const search = backend.claude.requests[0]!;
    expect(search.tools).toEqual([expect.objectContaining({ type: "web_search_20250305", name: "web_search", max_uses: 5 })]);
    expect(JSON.stringify(search.messages)).toContain(GOAL);
  });

  it("puts nothing about the Student but the Goal in the search", async () => {
    await backend.claude.willReply({ chunks: ["Noted."] });
    await backend.sendAndCollect("Hello");
    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, scholarship);
    const before = backend.claude.requests.length;

    await backend.opportunityDiscovery.runDue();

    expect(JSON.stringify(backend.claude.requests[before]!.messages)).not.toContain("Hello");
  });

  it("keeps what a search finds, with its Goal and its Source", async () => {
    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, scholarship);

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([
      expect.objectContaining({
        name: "Nursing Scholarship",
        when: "Apply by Tuesday, December 1, 2026",
        cost: "Free",
        forGoals: [GOAL],
        sources: [expect.objectContaining({ url: SCHOLARSHIP_PAGE, title: "Nursing Scholarship" })],
      }),
    ]);
  });

  it("searches as soon as a Goal is added, and only once", async () => {
    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toEqual([]);

    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, scholarship);
    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toHaveLength(2);

    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toHaveLength(2);
  });

  it("searches again when a Goal's words change, for that Goal alone", async () => {
    await goals.addGoal("Work in a hospital");
    const [first] = await goals.goals();
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches([]), claudeSearches([]));
    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toHaveLength(2);

    await goals.editGoal(first.id, "Work in a children's hospital");
    backend.claude.willReply(claudeSearches([]));
    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toHaveLength(3);
    expect(JSON.stringify(backend.claude.requests[2]!.messages)).toContain("children's hospital");
  });

  it("searches again a week later, and not before", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches([]));
    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toHaveLength(1);

    backend.clock.moveForward(7 * DAY - 60_000);
    hasEvents();
    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toHaveLength(1);

    backend.clock.moveForward(60_000);
    backend.claude.willReply(claudeSearches([]));
    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toHaveLength(2);
  });

  it("doesn't count a failed search as done, and tries again after an hour", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply({ failWith: new Error("Overloaded") });
    await backend.opportunityDiscovery.runDue();
    expect((await backend.activity()).map((entry) => entry.kind)).toContain("opportunity_search_failed");

    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toHaveLength(1);

    backend.clock.moveForward(3_600_000);
    backend.claude.willReply(claudeSearches([]));
    await backend.opportunityDiscovery.runDue();
    expect(backend.claude.requests).toHaveLength(2);
  });

  it("counts a search whose every try came back as an error as failed", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply({
      content: [
        { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "made up" } },
        { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
        textBlock("I couldn't search."),
      ] as any,
    });

    await backend.opportunityDiscovery.runDue();

    expect((await backend.activity()).map((entry) => entry.kind)).toContain("opportunity_search_failed");
  });

  it("counts a search that came back with nothing as done", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply({ content: [...searchBlocks(), textBlock("Nothing fits.")] as any });

    await backend.opportunityDiscovery.runDue();

    expect((await backend.activity()).map((entry) => entry.kind)).toContain("opportunity_search");
  });

  it("carries on after the API pauses a search, sending the paused reply back exactly as it came", async () => {
    await goals.addGoal(GOAL);
    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Nursing Scholarship", SCHOLARSHIP_WORDS));
    const paused = searchBlocks(SCHOLARSHIP_PAGE);
    backend.claude.willReply({ content: paused as any, stopReason: "pause_turn" }, { content: [textBlock(SCHOLARSHIP_PAGE)] }, haikuFindsOpportunities(scholarship));

    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests[1]!.messages.at(-1)).toEqual({ role: "assistant", content: paused });
    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Nursing Scholarship"]);
  });

  it("reads only addresses a search really gave, so that Claude can't make one up", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE], ["https://www.made-up.example/scholarship"]));

    await backend.opportunityDiscovery.runDue();

    expect(backend.web.requests).not.toContain("https://www.made-up.example/scholarship");
  });

  it("never fetches this laptop or a private address, even if a search result points there", async () => {
    const privateAddresses = ["https://localhost/admin", "https://127.0.0.1/admin", "https://169.254.169.254/latest", "https://host.docker.internal/"];
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches(privateAddresses));

    await backend.opportunityDiscovery.runDue();

    for (const address of privateAddresses) {
      expect(backend.web.requests).not.toContain(address);
      expect(backend.browser.actions).not.toContainEqual({ type: "read", url: address });
    }
  });

  it("reads no more than eight pages for a Goal", async () => {
    const results = Array.from({ length: 12 }, (_, index) => `https://www.result-${index}.example/`);
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches(results));

    await backend.opportunityDiscovery.runDue();

    expect(backend.web.requests.filter((address) => address.includes("result-"))).toHaveLength(8);
  });

  it("keeps searches broad: a site of any kind can be a Source", async () => {
    const anySite = "https://blog.anyone.example/this-week";
    await goalFinds(anySite, "Someone's blog", SCHOLARSHIP_WORDS, scholarship);

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list())[0].sources[0].url).toBe(anySite);
  });

  it("keeps nothing without a date on its page, and nothing whose date isn't what the page says", async () => {
    await goalFinds(
      SCHOLARSHIP_PAGE,
      "Nursing Scholarship",
      SCHOLARSHIP_WORDS,
      { ...scholarship, name: "No date quoted", date_quote: null },
      { ...scholarship, name: "Quote not on the page", date_quote: "January 5, 2027", date: "2027-01-05" },
      { ...scholarship, name: "Wrong day for the quote", date: "2026-12-02" },
      { ...scholarship, name: "Not a real day", date: "2026-13-45" },
      { ...scholarship, name: "Right" },
    );

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Right"]);
  });

  it("keeps nothing with a number in its summary that isn't on the page", async () => {
    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, { ...scholarship, summary: "An award of $5,000." });

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("goes when its Goal goes, unless the Student saved it", async () => {
    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, scholarship, { ...scholarship, name: "Nursing Fellowship" });
    await backend.opportunityDiscovery.runDue();
    const [fellowship] = await calls.list();
    await calls.save(fellowship.id);

    const [goal] = await goals.goals();
    await goals.removeGoal(goal.id);

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Nursing Fellowship"]);
  });

  it("reads a page again for a second Goal, which sees what only it could use", async () => {
    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, scholarship);
    await backend.opportunityDiscovery.runDue();

    await goals.addGoal("Pay for school");
    backend.claude.willReply(
      claudeSearches([SCHOLARSHIP_PAGE]),
      haikuFindsOpportunities({ ...scholarship, for_goals: [1, 2] }, { ...scholarship, name: "Tuition Grant", for_goals: [2] }),
    );
    await backend.opportunityDiscovery.runDue();

    const prompt = JSON.stringify(backend.claude.requests.at(-1)!.messages);
    expect(prompt).toContain(GOAL);
    expect(prompt).toContain("Pay for school");
    const found = await calls.list();
    expect(found.find((opportunity) => opportunity.name === "Tuition Grant").forGoals).toEqual(["Pay for school"]);
    expect(found.find((opportunity) => opportunity.name === "Nursing Scholarship").forGoals.sort()).toEqual([GOAL, "Pay for school"].sort());
  });

  it("doesn't read a page again when the same Goal finds it again", async () => {
    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, scholarship);
    await backend.opportunityDiscovery.runDue();
    const asked = backend.claude.requests.length;

    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE]));
    backend.clock.moveForward(7 * DAY);
    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toHaveLength(asked + 1);
  });

  it("keeps nothing Haiku doesn't say could help with a Goal", async () => {
    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, { ...scholarship, for_goals: [] }, { ...scholarship, name: "Made-up number", for_goals: [9] });

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });
});

describe("what's outside Temple", () => {
  beforeEach(() => hasEvents());

  it("is labeled by its Source's address, and comes after Temple's even when it's sooner", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE, TEMPLE_PROGRAM_PAGE]));
    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Nursing Scholarship", "The application closes November 20, 2026. There is no fee."));
    backend.web.save(TEMPLE_PROGRAM_PAGE, outsidePageHtml("Internship Program", "Applications close December 15, 2026."));
    backend.claude.willReply(
      haikuFindsOpportunities({ ...scholarship, date: "2026-11-20", date_quote: "November 20, 2026" }),
      haikuFindsOpportunities({ name: "Internship Program", date: "2026-12-15", date_quote: "December 15, 2026" }),
    );

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list()).map(({ name, outsideTemple }) => [name, outsideTemple])).toEqual([
      ["Internship Program", false],
      ["Nursing Scholarship", true],
    ]);
  });

  it("can't pass for Temple's with an address that only looks like it", async () => {
    const lookalike = "https://www.temple.edu.scholarships.example/award";
    await goalFinds(lookalike, "Temple University Scholarship", SCHOLARSHIP_WORDS, { ...scholarship, name: "Temple University Scholarship" });

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list())[0].outsideTemple).toBe(true);
  });
});

describe("fees", () => {
  const camp = { name: "Summer Nursing Camp", summary: "A week of hospital visits.", date: "2026-12-01", date_quote: "December 1, 2026" };
  const CAMP_WORDS = "Apply by December 1, 2026. The camp fee is $150 for the week. Students shadow nurses.";
  const costing = { cost: "paid", cost_amount: "$150 for the week", cost_quote: "The camp fee is $150 for the week.", worth_it_because: "You shadow working nurses for a week." };

  beforeEach(() => hasEvents());

  it("appears, saying what it costs and why it's worth it", async () => {
    await goalFinds(CAMP_PAGE, "Summer Camp", CAMP_WORDS, { ...camp, ...costing });

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([
      expect.objectContaining({ cost: "Costs $150 for the week", worthItBecause: "You shadow working nurses for a week." }),
    ]);
  });

  it("is dropped with no reason that it's worth it", async () => {
    await goalFinds(CAMP_PAGE, "Summer Camp", CAMP_WORDS, { ...camp, ...costing, worth_it_because: null });

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("is dropped with an empty reason, or one that isn't one line", async () => {
    await goalFinds(
      CAMP_PAGE,
      "Summer Camp",
      CAMP_WORDS,
      { ...camp, ...costing, name: "Empty", worth_it_because: "   " },
      { ...camp, ...costing, name: "Two lines", worth_it_because: "It's good.\nIt's very good." },
      { ...camp, ...costing, name: "Far too long", worth_it_because: "It's good. ".repeat(40) },
    );

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("is dropped if its reason gives a number that isn't on the page", async () => {
    await goalFinds(CAMP_PAGE, "Summer Camp", CAMP_WORDS, { ...camp, ...costing, worth_it_because: "It pays back $900." });

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("is dropped if its Source doesn't say how much, because the cost is always stated", async () => {
    await goalFinds(CAMP_PAGE, "Summer Camp", CAMP_WORDS, { ...camp, ...costing, cost_amount: null });

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("is dropped if the amount isn't in the words quoted for it, or the quote isn't on the page", async () => {
    await goalFinds(
      CAMP_PAGE,
      "Summer Camp",
      CAMP_WORDS,
      { ...camp, ...costing, name: "Other amount", cost_amount: "$99" },
      { ...camp, ...costing, name: "Other quote", cost_quote: "The fee is $150." },
    );

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("isn't called free unless the page says so in the words quoted", async () => {
    await goalFinds(
      CAMP_PAGE,
      "Summer Camp",
      "Apply by December 1, 2026. Students shadow nurses. Great value and full of friendly people, which matters.",
      { ...camp, cost: "free", cost_quote: "Students shadow nurses." },
    );

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([expect.objectContaining({ cost: "Its Source doesn't say what this costs." })]);
  });

  it("comes after what doesn't cost anything, among Temple's and among those outside", async () => {
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches([CAMP_PAGE]));
    backend.web.save(CAMP_PAGE, outsidePageHtml("Summer Camp", `${CAMP_WORDS} A free day is on January 5, 2027.`));
    backend.claude.willReply(
      haikuFindsOpportunities({ ...camp, ...costing }, { name: "Free Visit Day", summary: "A visit.", date: "2027-01-05", date_quote: "January 5, 2027", date_kind: "event", cost: "free", cost_quote: "A free day" }),
    );

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Free Visit Day", "Summer Nursing Camp"]);
  });

  it("applies to Temple's events the same way", async () => {
    const dance = { slug: "gala", date: "2026-11-20", time: "Fri., Nov. 20, 2026 7:30 pm", name: "Gala" };
    hasEvents(dance);
    backend.web.save(`https://now.temple.edu/events/${dance.date}/${dance.slug}`, eventPageHtml("Gala", "Tickets cost $40 at the door."));
    backend.claude.willReply(haikuFindsOpportunities({ summary: "A gala.", cost: "paid", cost_amount: "$40", cost_quote: "Tickets cost $40", worth_it_because: null }));

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("reads the event's own words, so that a price in the site's footer can't back up a fee", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound({ cost: "paid", cost_amount: "$20,000", cost_quote: "Tuition is $20,000", worth_it_because: "It's good." }));

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });
});

describe("saving an Opportunity", () => {
  beforeEach(async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound());
    await backend.opportunityDiscovery.runDue();
  });

  it("marks it saved, and saving it again changes nothing", async () => {
    const [{ id }] = await calls.list();

    expect((await calls.save(id)).status).toBe(204);
    expect((await calls.save(id)).status).toBe(204);

    expect((await calls.list())[0].saved).toBe(true);
  });

  it("can be undone", async () => {
    const [{ id }] = await calls.list();
    await calls.save(id);

    expect((await calls.unsave(id)).status).toBe(204);

    expect((await calls.list())[0].saved).toBe(false);
  });

  it("lasts through a restart", async () => {
    const [{ id }] = await calls.list();
    await calls.save(id);

    await backend.restart();

    expect((await calls.list())[0].saved).toBe(true);
  });

  it("answers 404 for something that isn't there, or an id that can't be one", async () => {
    expect((await calls.save(999)).status).toBe(404);
    expect((await calls.unsave(999)).status).toBe(404);
    expect((await calls.save("abc")).status).toBe(404);
    expect((await calls.save("1".repeat(20))).status).toBe(404);
  });

  it("needs a paired phone", async () => {
    const [{ id }] = await calls.list();

    const response = await fetch(`${backend.url}/opportunities/${id}/saved`, { method: "PUT" });

    expect(response.status).toBe(401);
    expect((await calls.list())[0].saved).toBe(false);
  });
});

describe("when an Opportunity's date passes", () => {
  beforeEach(async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound());
    await backend.opportunityDiscovery.runDue();
  });

  it("stays through its day on Philadelphia's clock, and is hidden the moment that day is over", async () => {
    // 2026-11-10 ends at 05:00 UTC on the 11th, since Philadelphia is five hours behind in November.
    backend.clock.moveForward(new Date("2026-11-11T04:59:00Z").getTime() - backend.clock.now().getTime());
    expect(await calls.list()).toHaveLength(1);

    backend.clock.moveForward(60_000);
    expect(await calls.list()).toEqual([]);
  });

  it("is hidden even if the Student saved it", async () => {
    const [{ id }] = await calls.list();
    await calls.save(id);

    backend.clock.moveForward(30 * DAY);

    expect(await calls.list()).toEqual([]);
  });

  it("can't be saved after that", async () => {
    const [{ id }] = await calls.list();

    backend.clock.moveForward(30 * DAY);

    expect((await calls.save(id)).status).toBe(404);
  });

  it("lasts to the last day of an event over several days", async () => {
    const exhibition = { slug: "exhibition", date: "2026-11-10", time: "Tue., Nov. 10, 2026 6:00 pm to Thu., Dec. 3, 2026 6:00 pm", name: "Exhibition" };
    hasEvents(exhibition);
    backend.web.save(`https://now.temple.edu/events/${exhibition.date}/${exhibition.slug}`, eventPageHtml("Exhibition", "Art on the walls for weeks."));
    backend.claude.willReply(haikuFindsOpportunities({ summary: "Art." }));
    backend.clock.moveForward(DAY);
    await backend.opportunityDiscovery.runDue();

    backend.clock.moveForward(new Date("2026-12-03T17:00:00Z").getTime() - backend.clock.now().getTime());

    expect(await calls.list()).toEqual([
      expect.objectContaining({ name: "Exhibition", when: "Tuesday, November 10, 2026 to Thursday, December 3, 2026" }),
    ]);
  });
});

describe("what's gone from its Source", () => {
  it("leaves two weeks after it was last on the list, and takes its save with it", async () => {
    hasFluClinic();
    const later = { slug: "later", date: "2026-12-20", time: "Sun., Dec. 20, 2026 7:30 pm", name: "Winter Concert" };
    hasEvents(FLU_CLINIC, later);
    backend.web.save(`https://now.temple.edu/events/${later.date}/${later.slug}`, eventPageHtml("Winter Concert", "Songs for winter."));
    backend.claude.willReply(fluClinicFound(), haikuFindsOpportunities({ summary: "Songs." }));
    await backend.opportunityDiscovery.runDue();
    const concert = (await calls.list()).find((opportunity) => opportunity.name === "Winter Concert");
    await calls.save(concert.id);

    hasEvents(FLU_CLINIC);
    backend.clock.moveForward(13 * DAY);
    await backend.opportunityDiscovery.runDue();
    expect((await calls.list()).map((opportunity) => opportunity.name)).toContain("Winter Concert");

    backend.clock.moveForward(DAY);
    await backend.opportunityDiscovery.runDue();
    expect(await calls.list()).toEqual([]);
    expect((await calls.save(concert.id)).status).toBe(404);
  });

  it("stays while the list doesn't answer, however long that lasts, until it has been read again", async () => {
    const later = { slug: "later", date: "2027-02-20", time: "Sat., Feb. 20, 2027 7:30 pm", name: "Winter Concert" };
    hasEvents(later);
    backend.web.save(`https://now.temple.edu/events/${later.date}/${later.slug}`, eventPageHtml("Winter Concert", "Songs for winter."));
    backend.claude.willReply(haikuFindsOpportunities({ summary: "Songs." }));
    await backend.opportunityDiscovery.runDue();

    backend.web.unreachable = true;
    backend.browser.unreachable = true;
    backend.clock.moveForward(20 * DAY);
    await backend.opportunityDiscovery.runDue();

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Winter Concert"]);
  });

  it("stays while it's on the list, even if its own page stops answering", async () => {
    const later = { slug: "later", date: "2027-02-20", time: "Sat., Feb. 20, 2027 7:30 pm", name: "Winter Concert" };
    const page = `https://now.temple.edu/events/${later.date}/${later.slug}`;
    hasEvents(later);
    backend.web.save(page, eventPageHtml("Winter Concert", "Songs for winter."));
    backend.claude.willReply(haikuFindsOpportunities({ summary: "Songs." }));
    await backend.opportunityDiscovery.runDue();

    backend.web.saved.delete(page);
    for (let day = 0; day < 20; day++) {
      backend.clock.moveForward(DAY);
      await backend.opportunityDiscovery.runDue();
    }

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Winter Concert"]);
  });
});

describe("when a page's words change", () => {
  const SECOND = { ...scholarship, name: "Nursing Fellowship" };
  const CHANGED = "The Nursing Scholarship application closes December 1, 2026. There is no fee, and the page has new words.";
  /** On the list every day, with no page of its own, so that this laptop counts as being on the web. */
  const later = { slug: "later", date: "2027-02-20", time: "Sat., Feb. 20, 2027 7:30 pm", name: "Winter Concert" };

  async function readAgainAWeekLater(...found: Record<string, unknown>[]): Promise<void> {
    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Nursing Scholarship", CHANGED));
    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE]), haikuFindsOpportunities(...found));
    backend.clock.moveForward(7 * DAY);
    await backend.opportunityDiscovery.runDue();
  }

  beforeEach(async () => {
    hasEvents(later);
    await goalFinds(SCHOLARSHIP_PAGE, "Nursing Scholarship", SCHOLARSHIP_WORDS, scholarship, SECOND);
    await backend.opportunityDiscovery.runDue();
  });

  it("keeps what the new reading doesn't list for two weeks, with its save, however Haiku words it now", async () => {
    const saved = (await calls.list()).find((opportunity) => opportunity.name === SECOND.name);
    await calls.save(saved.id);

    await readAgainAWeekLater(scholarship);
    expect((await calls.list()).find((opportunity) => opportunity.id === saved.id)).toMatchObject({ saved: true });

    // Two weeks from when it was last seen, on the one day that's read a week after that.
    backend.claude.whenScriptRunsOut = claudeSearches([SCHOLARSHIP_PAGE]);
    backend.clock.moveForward(7 * DAY);
    await backend.opportunityDiscovery.runDue();
    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Nursing Scholarship"]);
  });

  it("brings back what a later reading lists again", async () => {
    await readAgainAWeekLater(scholarship);

    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Nursing Scholarship", `${CHANGED} And more new words.`));
    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE]), haikuFindsOpportunities(scholarship, SECOND));
    backend.clock.moveForward(7 * DAY);
    await backend.opportunityDiscovery.runDue();

    backend.claude.whenScriptRunsOut = claudeSearches([SCHOLARSHIP_PAGE]);
    backend.clock.moveForward(7 * DAY);
    await backend.opportunityDiscovery.runDue();

    expect((await calls.list()).map((opportunity) => opportunity.name)).toContain(SECOND.name);
  });

  it("hides at once what now has a fee it can't state, without waiting two weeks", async () => {
    await readAgainAWeekLater(scholarship, { ...SECOND, cost: "paid", cost_amount: "$50", cost_quote: "There is no fee", worth_it_because: "It's good." });

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Nursing Scholarship"]);
  });
});

describe("an event that's changed since Buddy read it", () => {
  it("goes as soon as the list says it's cancelled, even under an address that now says so", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound());
    await backend.opportunityDiscovery.runDue();
    const [{ id }] = await calls.list();
    await calls.save(id);

    hasEvents({ ...FLU_CLINIC, slug: `cancelled-${FLU_CLINIC.slug}`, name: `CANCELLED: ${FLU_CLINIC.name}` });
    backend.clock.moveForward(DAY);
    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("isn't asked about each day when there's nothing on its page for Students", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound({ open_to_students: false }));
    await backend.opportunityDiscovery.runDue();
    const asked = backend.claude.requests.length;

    backend.clock.moveForward(DAY);
    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toHaveLength(asked);
  });
});

describe("what Haiku calls free, or doesn't price, on an event's own page", () => {
  const gala = { slug: "gala", date: "2026-11-20", time: "Fri., Nov. 20, 2026 7:30 pm", name: "Gala" };
  const galaPage = `https://now.temple.edu/events/${gala.date}/${gala.slug}`;

  it("isn't called free when the words quoted also give a price", async () => {
    await goalFinds(SCHOLARSHIP_PAGE, "A fair", "The fair is on December 1, 2026. Free parking, tickets $25 at the door.", {
      ...scholarship,
      cost: "free",
      cost_quote: "Free parking, tickets $25 at the door.",
    });
    hasEvents();

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list())[0].cost).toBe("Its Source doesn't say what this costs.");
  });

  it("is dropped when the event's page gives a price for it and Haiku missed that", async () => {
    hasEvents(gala);
    backend.web.save(galaPage, eventPageHtml("Gala", "Free parking. Tickets cost $40 at the door."));
    backend.claude.willReply(haikuFindsOpportunities({ summary: "A gala.", cost: "free", cost_quote: "Free parking." }));

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
  });

  it("isn't dropped for a sum of money that isn't its price", async () => {
    hasEvents(gala);
    backend.web.save(galaPage, eventPageHtml("Gala", "The winner takes home $500. This event is free."));
    backend.claude.willReply(haikuFindsOpportunities({ summary: "A gala.", cost: "free", cost_quote: "This event is free." }));

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list())[0].cost).toBe("Free");
  });
});

describe("the same Opportunity on Temple's page and on one from elsewhere", () => {
  it("counts as Temple's, and shows Temple's words", async () => {
    await goals.addGoal(GOAL);
    hasEvents();
    const elsewhere = "https://a.example/fair";
    const temple = "https://careercenter.temple.edu/fair";
    backend.claude.willReply(claudeSearches([elsewhere, temple]));
    backend.web.save(elsewhere, outsidePageHtml("A fair", "The Health Fair is on December 1, 2026."));
    backend.web.save(temple, outsidePageHtml("Temple's fair", "The Health Fair is on December 1, 2026."));
    const fair = { name: "Health Fair", date: "2026-12-01", date_quote: "December 1, 2026", date_kind: "event" };
    backend.claude.willReply(haikuFindsOpportunities({ ...fair, summary: "Words from elsewhere." }), haikuFindsOpportunities({ ...fair, summary: "Temple's words." }));

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([expect.objectContaining({ outsideTemple: false, summary: "Temple's words." })]);
  });
});

describe("the order within each part of the list", () => {
  it("puts free first, then what doesn't say, then what has a fee, and the soonest first within each", async () => {
    await goals.addGoal(GOAL);
    hasEvents();
    const page = "https://a.example/list";
    const words = "Soonest is on December 1, 2026. Later is on January 5, 2027. A paid one is on December 2, 2026. There is no fee. The fee is $5 today.";
    backend.claude.willReply(claudeSearches([page]));
    backend.web.save(page, outsidePageHtml("A list", words));
    backend.claude.willReply(
      haikuFindsOpportunities(
        { name: "Doesn't say", date: "2026-12-01", date_quote: "December 1, 2026" },
        { name: "Free but later", date: "2027-01-05", date_quote: "January 5, 2027", cost: "free", cost_quote: "There is no fee." },
        { name: "Paid", date: "2026-12-02", date_quote: "December 2, 2026", cost: "paid", cost_amount: "$5", cost_quote: "The fee is $5 today.", worth_it_because: "It's useful." },
      ),
    );

    await backend.opportunityDiscovery.runDue();

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Free but later", "Doesn't say", "Paid"]);
  });
});

describe("when a Goal changes during a long read of the events", () => {
  it("searches without waiting for that read to finish", async () => {
    let finishRead!: () => void;
    hasFluClinic();
    backend.web.hold = new Promise((resolve) => (finishRead = resolve));
    await goals.addGoal(GOAL);
    backend.claude.willReply(claudeSearches([]), fluClinicFound());

    const running = backend.opportunityDiscovery.runDue();
    await expect.poll(() => backend.claude.requests.length).toBe(1);
    expect(JSON.stringify(backend.claude.requests[0]!.messages)).toContain(GOAL);

    finishRead();
    await running;
  });
});

describe("a search whose every page failed", () => {
  it("counts as failed, and tries again in an hour rather than in a week", async () => {
    hasEvents();
    await goals.addGoal(GOAL);
    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Nursing Scholarship", SCHOLARSHIP_WORDS));
    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE]), { failWith: new Error("Overloaded") });
    await backend.opportunityDiscovery.runDue();
    expect((await backend.activity()).map((entry) => entry.kind)).toContain("opportunity_search_failed");

    backend.clock.moveForward(3_600_000);
    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE]), haikuFindsOpportunities(scholarship));
    await backend.opportunityDiscovery.runDue();

    expect((await calls.list()).map((opportunity) => opportunity.name)).toEqual(["Nursing Scholarship"]);
  });
});

describe("what a search found, once later searches stop picking it", () => {
  /** On the list every day, with no page of its own, so that this laptop counts as being on the web. */
  const later = { slug: "later", date: "2027-02-20", time: "Sat., Feb. 20, 2027 7:30 pm", name: "Winter Concert" };

  beforeEach(async () => {
    hasEvents(later);
    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Nursing Scholarship", "The Nursing Scholarship application closes March 1, 2027. There is no fee."));
    await goals.addGoal(GOAL);
    backend.claude.willReply(
      claudeSearches([SCHOLARSHIP_PAGE]),
      haikuFindsOpportunities({ ...scholarship, date: "2027-03-01", date_quote: "March 1, 2027" }),
    );
    backend.claude.whenScriptRunsOut = claudeSearches([]);
  });

  async function firstRun(): Promise<any> {
    await backend.opportunityDiscovery.runDue();
    return (await calls.list()).find((opportunity) => opportunity.name === "Nursing Scholarship");
  }

  async function runForDays(days: number): Promise<void> {
    for (let day = 0; day < days; day++) {
      backend.clock.moveForward(DAY);
      await backend.opportunityDiscovery.runDue();
    }
  }

  it("stays while its page still answers", async () => {
    const found = await firstRun();
    expect(found).toBeDefined();

    await runForDays(30);

    expect((await calls.list()).map((opportunity) => opportunity.name)).toContain("Nursing Scholarship");
  });

  it("gets read again only about once a week, and Activity says so", async () => {
    await firstRun();
    const reads = () => backend.web.requests.filter((address) => address === SCHOLARSHIP_PAGE).length;
    expect(reads()).toBe(1);

    await runForDays(6);
    expect(reads()).toBe(1);

    await runForDays(1);
    expect(reads()).toBe(2);
    expect((await backend.activity()).map((entry) => entry.kind)).toContain("opportunity_pages_read_again");
  });

  it("is read again for its Goal, so that a changed page can't fill up with what doesn't fit", async () => {
    await firstRun();
    const before = backend.claude.requests.length;
    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Nursing Scholarship", "The Nursing Scholarship application closes March 1, 2027. There is no fee, with new words."));
    backend.claude.willReply(haikuFindsOpportunities({ ...scholarship, date: "2027-03-01", date_quote: "March 1, 2027" }));

    await runForDays(7);

    const reread = backend.claude.requests.slice(before).find((request) => JSON.stringify(request.messages).includes("new words"))!;
    expect(JSON.stringify(reread.messages)).toContain(GOAL);
  });

  it("leaves two weeks after its page stops answering, saved or not", async () => {
    const found = await firstRun();
    await calls.save(found.id);

    backend.web.saved.delete(SCHOLARSHIP_PAGE);
    await runForDays(13);
    expect((await calls.list()).map((opportunity) => opportunity.name)).toContain("Nursing Scholarship");

    await runForDays(1);
    expect((await calls.list()).map((opportunity) => opportunity.name)).not.toContain("Nursing Scholarship");
  });
});

describe("reporting an Opportunity", () => {
  it("hides it straight away, says so in Activity, and it stays hidden when Discovery finds it again", async () => {
    hasFluClinic();
    backend.claude.willReply(fluClinicFound());
    await backend.opportunityDiscovery.runDue();
    const [{ id }] = await calls.list();

    expect((await calls.report(id)).status).toBe(204);
    expect(await calls.list()).toEqual([]);
    expect((await backend.activity())[0]).toMatchObject({ title: "You reported Flu Shot Clinic" });

    hasFluClinic("New words. This event is free.");
    backend.claude.willReply(fluClinicFound());
    backend.clock.moveForward(DAY);
    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([]);
    expect((await calls.report(id)).status).toBe(204);
    expect((await calls.report(999)).status).toBe(404);
  });
});

describe("the real pages saved from now.temple.edu", () => {
  const saved = (name: string) => readFileSync(new URL(`./fixtures/now-temple-pages/${name}`, import.meta.url), "utf8");
  const CHORALE_PAGE = "https://now.temple.edu/events/2026-11-11/temple-university-chorale-singers-voices";

  it("go through from the list to an Opportunity that really says it's free", async () => {
    const chorale = { slug: "temple-university-chorale-singers-voices", date: "2026-11-11", time: "Wed., Nov. 11, 2026 7:30 pm", name: "Temple University Chorale, Singers and Voices" };
    hasEvents(chorale);
    backend.web.save(CHORALE_PAGE, saved("temple-university-chorale-singers-voices.html"));
    backend.claude.willReply(haikuFindsOpportunities({ summary: "A concert.", cost: "free", cost_quote: "This event is free and open to the public." }));

    await backend.opportunityDiscovery.runDue();

    expect(await calls.list()).toEqual([expect.objectContaining({ cost: "Free", when: "Wednesday, November 11, 2026, 7:30 pm" })]);
  });
});
