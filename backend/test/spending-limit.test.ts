import { afterEach, describe, expect, it } from "vitest";
import { canvas } from "../src/canvas.ts";
import { handshake } from "../src/handshake.ts";
import { settings } from "../src/settings.ts";
import { DAILY_BACKGROUND_LIMIT } from "../src/spending.ts";
import { BackendHarness, TEST_CHAT_MODEL, TEST_CRISIS_MODEL, TEST_DISCOVERY_MODEL, WARNED_CONNECTION } from "./support/backend-harness.ts";
import { EVENTS_LIST, FAIR, INTERNSHIP, jobPage, JOBS_LIST, saveHandshakePages } from "./support/handshake-pages.ts";
import {
  CALENDAR_PAGE,
  haikuFindsDates,
  TEST_MILESTONE_OFFICES,
  WITHDRAW_16_WEEK,
} from "./support/milestone-pages.ts";
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
import { haikuFinds, HEADSHOTS_PAGE, savedOfficePage, TUTTLEMAN_CONTACT_PAGE, WRITING_CENTER_PAGE } from "./support/office-pages.ts";
import { roadmapCalls } from "./support/roadmap-helpers.ts";
import { classifierAnswer, type ScriptedReply } from "./support/scripted-claude.ts";

const DAY = 24 * 3_600_000;
const NEXT_MORNING_IN_PHILADELPHIA = "2026-11-03T13:00:00Z";
/** The test models have no price, so each costs the table's highest: $50 per million output tokens makes this $2. */
const USES_UP_THE_DAY = { usage: { output_tokens: 40_000 } };
const usesUpTheDay = (reply: ScriptedReply): ScriptedReply => ({ ...reply, ...USES_UP_THE_DAY });
const WRITING_CENTER = { name: "Writing Center", summary: "Student writers work with other student writers.", search_terms: ["essay"] };
const COUNSELING = { name: "Tuttleman Counseling", summary: "Counseling for students.", search_terms: ["counseling"] };
const HEADSHOTS = { name: "LinkedIn Headshots", summary: "A headshot for your profile.", search_terms: ["headshot"] };
const FAIR_PAGE = `https://now.temple.edu/events/2026-11-12/career-fair`;
const CAREER_FAIR = { slug: "career-fair", date: "2026-11-12", time: "Thu., Nov. 12, 2026 12:00 pm to 1:00 pm", name: "Career Fair" };
const SCHOLARSHIP_PAGE = "https://www.nursing-foundation.example/scholarship";
const GOAL = "Get into nursing school";

let backend: BackendHarness;

afterEach(async () => {
  await backend.stop();
});

/** What went to the error log, leaving out the one line about the test models having no price. */
const errorsLogged = () => backend.errorsLogged.filter((line) => !line.includes("no price"));
const activityTitles = async () => (await backend.activity()).map((entry) => entry.title);

/** Changes a page's words, as an office editing it does, so that Haiku reads it again. */
function officeEdits(url: string, edit: string) {
  backend.web.save(url, `${savedOfficePage(url)}<p>${edit}</p>`);
}

const lastSeenOf = (query: string) => backend.guidebook.search(query)[0]!.sources[0]!.lastSeenAt;

describe("Discovery when the limit stops it", () => {
  it("makes no more Claude calls, keeps what it took in, and isn't counted as a read or as a failure", async () => {
    backend = await BackendHarness.start();
    backend.claude.willReply(usesUpTheDay(haikuFinds(WRITING_CENTER)));

    await backend.discovery.runDue();

    expect(backend.claude.requests).toHaveLength(1);
    expect(backend.guidebook.search("essay")).toHaveLength(1);
    expect(errorsLogged()).toEqual([]);
    expect(await activityTitles()).not.toContain("Buddy read Temple's office pages");
    expect((await activityTitles()).join()).not.toMatch(/couldn't/);
  });

  it("doesn't go back to the web every minute for the rest of the day", async () => {
    backend = await BackendHarness.start();
    backend.claude.willReply(usesUpTheDay(haikuFinds(WRITING_CENTER)));
    await backend.discovery.runDue();
    const fetched = backend.web.requests.length;

    backend.clock.moveForward(60_000);
    await backend.discovery.runDue();
    backend.clock.moveForward(5 * 3_600_000);
    await backend.discovery.runDue();

    expect(backend.web.requests).toHaveLength(fetched);
    expect(backend.claude.requests).toHaveLength(1);
  });

  it("runs again the next day, asking only about what it skipped, and only then counts as read", async () => {
    backend = await BackendHarness.start();
    backend.claude.willReply(usesUpTheDay(haikuFinds(WRITING_CENTER)));
    await backend.discovery.runDue();
    backend.claude.requests.length = 0;

    backend.clock.moveTo(NEXT_MORNING_IN_PHILADELPHIA);
    backend.claude.willReply(haikuFinds(COUNSELING), haikuFinds(HEADSHOTS));
    await backend.discovery.runDue();

    expect(backend.claude.requests).toHaveLength(2);
    expect(backend.guidebook.search("counseling")).toHaveLength(1);
    expect(backend.guidebook.search("headshot")).toHaveLength(1);
    expect(await activityTitles()).toContain("Buddy read Temple's office pages");
  });

  it("removes nothing, not even from a page that was failing for two weeks and has just come back", async () => {
    backend = await BackendHarness.start();
    backend.claude.willReply(haikuFinds(WRITING_CENTER), haikuFinds(COUNSELING), haikuFinds(HEADSHOTS));
    await backend.discovery.run();
    const counselingPage = savedOfficePage(TUTTLEMAN_CONTACT_PAGE);
    backend.web.save(TUTTLEMAN_CONTACT_PAGE, "Not found", 404);
    backend.clock.moveForward(DAY);
    await backend.discovery.runDue();

    // Back, with new words that the limit stops Claude from reading. Those are what would clear its failing.
    backend.clock.moveForward(15 * DAY);
    backend.web.save(TUTTLEMAN_CONTACT_PAGE, `${counselingPage}<p>New hours.</p>`);
    await spendTheDayOnBackgroundWork();
    await backend.discovery.runDue();

    expect(backend.guidebook.search("counseling")).toHaveLength(1);
  });

  it("goes again straight after midnight, even if the stopped read only ended after midnight", async () => {
    backend = await BackendHarness.start();
    // 11:58 p.m. in Philadelphia.
    backend.clock.moveTo("2026-11-03T04:58:00Z");
    const realGet = backend.web.get.bind(backend.web);
    backend.web.get = async (url) => {
      // The read is still going when midnight comes.
      if (url === HEADSHOTS_PAGE) backend.clock.moveTo("2026-11-03T05:01:00Z");
      return realGet(url);
    };
    backend.claude.willReply(usesUpTheDay(haikuFinds(WRITING_CENTER)), haikuFinds(HEADSHOTS));
    await backend.discovery.runDue();
    expect(backend.guidebook.search("counseling")).toEqual([]);

    backend.claude.willReply(haikuFinds(COUNSELING));
    await backend.discovery.runDue();

    expect(backend.guidebook.search("counseling")).toHaveLength(1);
  });

  it("still confirms a page whose words haven't changed, which needs no Claude", async () => {
    backend = await BackendHarness.start();
    backend.claude.willReply(haikuFinds(WRITING_CENTER), haikuFinds(COUNSELING), haikuFinds(HEADSHOTS));
    await backend.discovery.run();
    const seenBefore = lastSeenOf("headshot");

    backend.clock.moveForward(DAY);
    officeEdits(WRITING_CENTER_PAGE, "New hours.");
    officeEdits(TUTTLEMAN_CONTACT_PAGE, "New hours.");
    backend.claude.requests.length = 0;
    backend.claude.willReply(usesUpTheDay(haikuFinds(WRITING_CENTER)));
    await backend.discovery.runDue();

    expect(backend.claude.requests).toHaveLength(1);
    expect(new Date(lastSeenOf("headshot")).getTime()).toBeGreaterThan(new Date(seenBefore).getTime());
    expect(await activityTitles()).toHaveLength(1);
  });

  it("counts as a read when nothing it needed Claude for was left", async () => {
    backend = await BackendHarness.start();
    backend.claude.willReply(haikuFinds(WRITING_CENTER), haikuFinds(COUNSELING), haikuFinds(HEADSHOTS));
    await backend.discovery.run();
    const reads = (await activityTitles()).length;

    backend.clock.moveForward(DAY);
    officeEdits(WRITING_CENTER_PAGE, "New hours.");
    backend.claude.willReply(usesUpTheDay(haikuFinds(WRITING_CENTER)));
    await backend.discovery.runDue();

    expect((await activityTitles()).length).toBe(reads + 1);
  });

  it("leaves Standard Milestones alone, and reads their page the next day", async () => {
    backend = await BackendHarness.start({ offices: [], milestoneOffices: TEST_MILESTONE_OFFICES });
    backend.claude.willReply(haikuFindsDates(WITHDRAW_16_WEEK), haikuFindsDates());
    await backend.discovery.run();
    const dates = await backend.upcomingMilestones();
    expect(dates).toHaveLength(1);

    backend.clock.moveForward(DAY);
    officeEdits(CALENDAR_PAGE, "Updated.");
    await spendTheDayOnBackgroundWork();
    backend.claude.requests.length = 0;
    await backend.discovery.runDue();

    expect(backend.claude.requests).toEqual([]);

    expect(await backend.upcomingMilestones()).toEqual(dates);
    expect(errorsLogged()).toEqual([]);

    backend.clock.moveForward(DAY);
    backend.claude.requests.length = 0;
    backend.claude.willReply(haikuFindsDates(WITHDRAW_16_WEEK));
    await backend.discovery.runDue();
    expect(backend.claude.requests).toHaveLength(1);
  });
});

/** A Claude call by background work other than what the test is about, using up what's left of today. */
async function spendTheDayOnBackgroundWork(): Promise<void> {
  backend.claude.willReply({ ...USES_UP_THE_DAY });
  const request = { model: TEST_DISCOVERY_MODEL, max_tokens: 1, messages: [{ role: "user" as const, content: "made up" }] };
  await Array.fromAsync(backend.spending.forBackground(backend.claude).stream(request));
  expect(backend.spending.backgroundStoppedForToday()).toBe(true);
}

describe("Opportunity discovery when the limit stops it", () => {
  const FLU_WORDS = "Get a free flu shot from Student Health. This event is free.";
  const hasTwoEvents = () => {
    backend.web.save(EVENTS_LIST_PAGE, eventsListHtml(FLU_CLINIC, CAREER_FAIR));
    backend.web.save(FLU_CLINIC_PAGE, eventPageHtml(FLU_CLINIC.name, FLU_WORDS));
    backend.web.save(FAIR_PAGE, eventPageHtml(CAREER_FAIR.name, "Meet employers. This event is free."));
  };
  /** The list reads as a list, and a past event needs no Claude. */
  const hasOnlyAPastEvent = () =>
    backend.web.save(EVENTS_LIST_PAGE, eventsListHtml({ slug: "last-month", date: "2026-10-01", time: "Thu., Oct. 1, 2026 12:00 pm to 1:00 pm", name: "Last Month" }));
  const fluClinicFound = () => haikuFindsOpportunities({ summary: "A free flu shot.", cost: "free", cost_quote: "This event is free." });
  const fairFound = () => haikuFindsOpportunities({ name: CAREER_FAIR.name, summary: "Meet employers.", cost: "free", cost_quote: "This event is free." });

  it("doesn't count today's events as read, or as failed, when it's stopped partway", async () => {
    backend = await BackendHarness.start();
    hasTwoEvents();
    backend.claude.willReply(usesUpTheDay(fluClinicFound()));

    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toHaveLength(1);
    expect(errorsLogged()).toEqual([]);
    expect(await activityTitles()).not.toContain("Buddy read Temple's events");
    expect(await activityTitles()).not.toContain("Buddy couldn't read Temple's events");
  });

  it("doesn't go back to the web every minute, and reads the event it skipped the next day", async () => {
    backend = await BackendHarness.start();
    hasTwoEvents();
    backend.claude.willReply(usesUpTheDay(fluClinicFound()));
    await backend.opportunityDiscovery.runDue();
    const fetched = backend.web.requests.length;

    backend.clock.moveForward(60_000);
    await backend.opportunityDiscovery.runDue();
    expect(backend.web.requests).toHaveLength(fetched);

    backend.clock.moveTo(NEXT_MORNING_IN_PHILADELPHIA);
    backend.claude.requests.length = 0;
    backend.claude.willReply(fairFound());
    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toHaveLength(1);
    expect(JSON.stringify(backend.claude.requests[0]!.messages)).toContain("Meet employers");
    expect((await opportunityCalls(backend).list()).map((opportunity) => opportunity.name)).toContain(CAREER_FAIR.name);
    expect(await activityTitles()).toContain("Buddy read Temple's events");
  });

  it("searches for a Goal the next day when the limit was already reached, rather than a week later", async () => {
    backend = await BackendHarness.start();
    hasOnlyAPastEvent();
    const goals = roadmapCalls(backend);
    await goals.addGoal(GOAL);
    backend.claude.requests.length = 0;
    await spendTheDayOnBackgroundWork();
    backend.claude.requests.length = 0;

    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toEqual([]);
    expect(errorsLogged()).toEqual([]);
    expect((await activityTitles()).join()).not.toMatch(/search the web/);

    backend.clock.moveTo(NEXT_MORNING_IN_PHILADELPHIA);
    hasOnlyAPastEvent();
    backend.claude.willReply(claudeSearches([]));
    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toHaveLength(1);
  });

  it("searches again the next day when it's stopped after the search, so that the pages it picked aren't lost for a week", async () => {
    backend = await BackendHarness.start();
    hasOnlyAPastEvent();
    const goals = roadmapCalls(backend);
    await goals.addGoal(GOAL);
    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Scholarship", "The Nursing Scholarship closes December 1, 2026."));
    backend.claude.requests.length = 0;
    backend.claude.willReply(usesUpTheDay(claudeSearches([SCHOLARSHIP_PAGE])));

    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toHaveLength(1);
    expect(errorsLogged()).toEqual([]);
    expect((await activityTitles()).join()).not.toMatch(/searched the web|search the web/);

    backend.clock.moveTo(NEXT_MORNING_IN_PHILADELPHIA);
    hasOnlyAPastEvent();
    backend.claude.requests.length = 0;
    backend.claude.willReply(
      claudeSearches([SCHOLARSHIP_PAGE]),
      haikuFindsOpportunities({ name: "Nursing Scholarship", date: "2026-12-01", date_quote: "December 1, 2026" }),
    );
    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toHaveLength(2);
    expect((await opportunityCalls(backend).list()).map((opportunity) => opportunity.name)).toContain("Nursing Scholarship");
    expect((await activityTitles()).join()).toMatch(/searched the web/);
  });

  it("removes nothing while it's stopped, and checks a searched page again the next day", async () => {
    backend = await BackendHarness.start();
    hasOnlyAPastEvent();
    const goals = roadmapCalls(backend);
    await goals.addGoal(GOAL);
    hasOnlyAPastEvent();
    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Scholarship", "The Nursing Scholarship closes December 1, 2026."));
    backend.claude.willReply(claudeSearches([SCHOLARSHIP_PAGE]), haikuFindsOpportunities({ name: "Nursing Scholarship", date: "2026-12-01", date_quote: "December 1, 2026" }));
    await backend.opportunityDiscovery.runDue();
    expect(await opportunityCalls(backend).list()).toHaveLength(1);

    // It's still ahead, and its page has changed, so reading it again is what would keep it.
    backend.clock.moveForward(15 * DAY);
    backend.web.save(SCHOLARSHIP_PAGE, outsidePageHtml("Scholarship", "Update: The Nursing Scholarship closes December 1, 2026."));
    await spendTheDayOnBackgroundWork();
    backend.claude.requests.length = 0;
    await backend.opportunityDiscovery.runDue();

    expect(backend.claude.requests).toEqual([]);
    expect(await opportunityCalls(backend).list()).toHaveLength(1);
    expect(errorsLogged()).toEqual([]);
    expect((await activityTitles()).join()).not.toMatch(/checked Opportunities it found earlier/);

    backend.clock.moveForward(DAY);
    backend.claude.requests.length = 0;
    backend.claude.willReply(claudeSearches([]), haikuFindsOpportunities({ name: "Nursing Scholarship", date: "2026-12-01", date_quote: "December 1, 2026" }));
    await backend.opportunityDiscovery.runDue();

    expect(await opportunityCalls(backend).list()).toHaveLength(1);
    expect((await activityTitles()).join()).toMatch(/checked Opportunities it found earlier/);
  });
});

describe("reading a Connection when the limit stops it", () => {
  const JOB_PAGE = jobPage(INTERNSHIP.id);
  const pagesOpened = () => backend.browser.actions.filter((action) => action.type === "read").map((action: any) => action.url);
  const startWithHandshake = async () => {
    backend = await BackendHarness.start({
      sites: { handshake: settings.sites.handshake, canvas: settings.sites.canvas },
      extraConnectionTypes: [handshake, canvas],
    });
    saveHandshakePages(backend.browser);
    await roadmapCalls(backend).addGoal(GOAL);
    backend.claude.requests.length = 0;
  };
  const handshakeStatus = async () => (await backend.connections()).find((connection) => connection.id === handshake.id);

  it("finishes the read, says plainly what's left, and logs no error", async () => {
    await startWithHandshake();
    await spendTheDayOnBackgroundWork();
    backend.claude.requests.length = 0;

    const response = await backend.giveReadPermission(handshake.id, undefined);

    expect(response.status).toBe(200);
    expect(backend.claude.requests).toEqual([]);
    const status = await handshakeStatus();
    expect(status.lastReadProblem).toMatch(/today's limit/);
    expect(status.lastReadProblem).toMatch(/tomorrow/);
    expect(status.needsLogin).toBe(false);
    expect(errorsLogged()).toEqual([]);
  });

  it("stops opening pages once it's stopped, because there's nothing it could do with them", async () => {
    await startWithHandshake();
    await spendTheDayOnBackgroundWork();

    await backend.giveReadPermission(handshake.id, undefined);

    // The two lists, and the one listing that found out.
    expect(pagesOpened().filter((url) => url !== JOBS_LIST && url !== EVENTS_LIST)).toEqual([JOB_PAGE]);
  });

  it("reads what it skipped at the next read after the limit lifts", async () => {
    await startWithHandshake();
    await spendTheDayOnBackgroundWork();
    await backend.giveReadPermission(handshake.id, undefined);
    backend.claude.requests.length = 0;

    backend.clock.moveTo(NEXT_MORNING_IN_PHILADELPHIA);
    backend.claude.willReply(
      haikuFindsOpportunities({ name: INTERNSHIP.title, summary: "A paid internship on a hospital ward.", date: "2026-12-01", date_kind: "deadline", date_quote: "December 1, 2026" }),
      haikuFindsOpportunities({ name: FAIR.title, summary: "Meet employers on campus.", date: "2026-12-03", date_kind: "event", date_quote: "December 3, 2026", cost: "free", cost_quote: "This event is free." }),
    );
    await backend.readDueConnections();

    expect(backend.claude.requests).toHaveLength(2);
    expect((await handshakeStatus()).lastReadProblem).toBeNull();
    expect((await opportunityCalls(backend).list()).map((opportunity) => opportunity.name)).toContain(INTERNSHIP.title);
    expect(pagesOpened()).toContain(JOB_PAGE);
  });
});

describe("what the limit leaves alone", () => {
  it("still reads a Connection that sends nothing to Claude, and doesn't call that a problem", async () => {
    backend = await BackendHarness.start();
    await spendTheDayOnBackgroundWork();

    expect((await backend.giveReadPermission(WARNED_CONNECTION, undefined)).status).toBe(200);

    const status = (await backend.connections()).find((connection) => connection.id === WARNED_CONNECTION);
    expect(status.lastReadAt).not.toBeNull();
    expect(status.lastReadProblem).toBeNull();
  });

  it("keeps chat going, and counts it apart from background work", async () => {
    backend = await BackendHarness.start();
    await spendTheDayOnBackgroundWork();

    backend.claude.willReply({ chunks: ["Hello"], usage: { output_tokens: 1000 } });
    const events = await backend.sendAndCollect("Hi");

    expect(events.at(-1).type).toBe("done");
    expect(backend.claude.requests.at(-1)!.model).toBe(TEST_CHAT_MODEL);
    expect(backend.spending.today().chat).toBe(50_000_000);
    expect(backend.spending.today().background).toBe(DAILY_BACKGROUND_LIMIT);
  });

  it("keeps the Crisis check going, however much background work has used", async () => {
    backend = await BackendHarness.start();
    await spendTheDayOnBackgroundWork();
    backend.claude.requests.length = 0;

    backend.claude.willReply({ ...classifierAnswer("crisis"), usage: { input_tokens: 1000 } }, { chunks: ["I'm here."] });
    const events = await backend.sendAndCollect("I can't do this anymore");

    expect(backend.claude.requests[0]!.model).toBe(TEST_CRISIS_MODEL);
    expect(events.map((event) => event.type)).toContain("crisis_card");
    expect(backend.spending.today().chat).toBe(10_000_000);
  });

  it("doesn't let chat use up the background limit", async () => {
    backend = await BackendHarness.start();
    backend.claude.willReply({ chunks: ["Hello"], ...USES_UP_THE_DAY });
    await backend.sendAndCollect("Hi");

    backend.claude.requests.length = 0;
    backend.claude.willReply(haikuFinds(WRITING_CENTER), haikuFinds(COUNSELING), haikuFinds(HEADSHOTS));
    await backend.discovery.runDue();

    expect(backend.claude.requests).toHaveLength(3);
  });

  it("still makes a Briefing, which uses no Claude", async () => {
    backend = await BackendHarness.start();
    await backend.briefings.runDue();
    expect((await backend.registerPushToken("made-up-push-token")).status).toBe(204);
    await roadmapCalls(backend).addMilestone({ name: "Something due", dueDate: "2026-11-05", goalId: null });

    // 8 a.m. in Philadelphia, when a Briefing comes due, on a day whose limit has been reached.
    backend.clock.moveTo(NEXT_MORNING_IN_PHILADELPHIA);
    await spendTheDayOnBackgroundWork();
    backend.claude.requests.length = 0;
    await backend.briefings.runDue();

    expect(backend.claude.requests).toEqual([]);
    expect(await backend.latestBriefing()).not.toBeNull();
    expect(backend.notifier.sent).toHaveLength(1);
  });
});

describe("reading what Buddy spent", () => {
  const readSpending = async (headers = backend.deviceHeaders) => fetch(`${backend.url}/spending`, { headers });

  it("needs a paired phone, like every other route", async () => {
    backend = await BackendHarness.start();

    expect((await readSpending({})).status).toBe(401);
  });

  it("gives today's and this month's spend, and that background work is still going", async () => {
    backend = await BackendHarness.start();
    backend.claude.willReply({ chunks: ["Hello"], usage: { output_tokens: 1000 } });
    await backend.sendAndCollect("Hi");
    backend.clock.moveForward(DAY);
    backend.claude.willReply({ chunks: ["Hello again"], usage: { output_tokens: 2000 } });
    await backend.sendAndCollect("Hi again");

    expect(await (await readSpending()).json()).toEqual({
      todayNanodollars: 100_000_000,
      thisMonthNanodollars: 150_000_000,
      backgroundLimitNanodollars: 2_000_000_000,
      backgroundStoppedForToday: false,
    });
  });

  it("says when background work has stopped for today, and stops saying it the next day", async () => {
    backend = await BackendHarness.start();
    await spendTheDayOnBackgroundWork();

    const stopped = (await (await readSpending()).json()) as any;
    expect(stopped.backgroundStoppedForToday).toBe(true);
    expect(stopped.todayNanodollars).toBe(DAILY_BACKGROUND_LIMIT);

    backend.clock.moveTo(NEXT_MORNING_IN_PHILADELPHIA);
    const nextDay = (await (await readSpending()).json()) as any;
    expect(nextDay.backgroundStoppedForToday).toBe(false);
    expect(nextDay.todayNanodollars).toBe(0);
    expect(nextDay.thisMonthNanodollars).toBe(DAILY_BACKGROUND_LIMIT);
  });

  it("counts the work of every kind of Claude call Buddy makes", async () => {
    backend = await BackendHarness.start();
    const COSTS_5_CENTS = { usage: { output_tokens: 1000 } };
    backend.claude.willReply({ ...classifierAnswer("nothing"), ...COSTS_5_CENTS }, { chunks: ["Okay."], ...COSTS_5_CENTS });
    await backend.sendAndCollect("I can't do this anymore");
    backend.claude.willReply(
      { ...haikuFinds(WRITING_CENTER), ...COSTS_5_CENTS },
      { ...haikuFinds(COUNSELING), ...COSTS_5_CENTS },
      { ...haikuFinds(HEADSHOTS), ...COSTS_5_CENTS },
    );
    await backend.discovery.runDue();

    expect(backend.spending.today()).toEqual({ chat: 100_000_000, background: 150_000_000, task: 0, total: 250_000_000 });
  });
});
