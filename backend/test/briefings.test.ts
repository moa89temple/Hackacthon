import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConnectionType } from "../src/connections.ts";
import type { ConnectionFactToStore } from "../src/store.ts";
import { tumail } from "../src/tumail.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { haikuFindsDates, TEST_MILESTONE_OFFICES, WITHDRAW_16_WEEK, WITHDRAW_7B } from "./support/milestone-pages.ts";
import { eventPageHtml, eventsListHtml, EVENTS_LIST_PAGE, FLU_CLINIC, FLU_CLINIC_PAGE, haikuFindsOpportunities, opportunityCalls } from "./support/opportunity-pages.ts";
import { roadmapCalls } from "./support/roadmap-helpers.ts";

const TOKEN = "made-up-push-token";
const NEWS_CONNECTION = "news";

/** A Connection in which each fact that wasn't there before is an event, standing in for Canvas, TUmail and the rest. */
let factsOnNextRead: ConnectionFactToStore[] = [];
const newsConnection: ConnectionType = {
  id: NEWS_CONNECTION,
  name: "A Connection with news",
  card: { reads: ["Your things."], notes: [], warning: null, address: null },
  whileOnTellClaude: "Nothing to do.",
  read: async () => factsOnNextRead,
  eventsBetween: (before, after) =>
    after.filter((fact) => !before.some(({ key }) => key === fact.key)).map((fact) => ({ kind: "new", factKey: fact.key, text: `New: ${fact.text}`, data: {} })),
  describeForClaude: () => "Nothing.",
};

const fact = (key: string, text = key): ConnectionFactToStore => ({ key, text, detail: "", data: {} });

let backend: BackendHarness;
let roadmap: ReturnType<typeof roadmapCalls>;

beforeEach(async () => {
  factsOnNextRead = [];
  backend = await BackendHarness.start({ offices: [], milestoneOffices: TEST_MILESTONE_OFFICES, extraConnectionTypes: [newsConnection] });
  roadmap = roadmapCalls(backend);
});

afterEach(async () => {
  await backend.stop();
});

/** A phone registered and something relevant for every Briefing up to the date given, so that each one has something to send. */
async function phoneWithSomethingDue(through = "2026-11-20"): Promise<void> {
  expect((await backend.registerPushToken(TOKEN)).status).toBe(204);
  for (let day = 3; day <= 20; day += 2) {
    const dueDate = `2026-11-${String(day).padStart(2, "0")}`;
    if (dueDate <= through) await roadmap.addMilestone({ name: `Something due on ${dueDate}`, dueDate, goalId: null });
  }
}

/** The clock reaching this moment, with the worker's minute coming round as it does. */
async function reach(moment: string): Promise<void> {
  backend.clock.moveTo(moment);
  await backend.briefings.runDue();
}

describe("the background worker's schedule", () => {
  it("sends nothing before a Briefing's time", async () => {
    await backend.briefings.runDue();
    await phoneWithSomethingDue();

    // Tuesday, November 3, 2026, a minute before 8 a.m. EST.
    await reach("2026-11-03T12:59:00Z");

    expect(backend.notifier.sent).toEqual([]);
    expect(await backend.latestBriefing()).toBeNull();
  });

  it("sends a Briefing at 8 a.m. on a weekday, and only once", async () => {
    await backend.briefings.runDue();
    await phoneWithSomethingDue();

    await reach("2026-11-03T13:00:00Z");
    await reach("2026-11-03T13:01:00Z");
    await reach("2026-11-03T20:00:00Z");

    expect(backend.notifier.sent).toHaveLength(1);
    expect(backend.notifier.sent[0]!.token).toBe(TOKEN);
    expect(backend.notifier.sent[0]!.notification.title).toBe("Your Briefing");
    expect((await backend.latestBriefing()).kind).toBe("weekday");
  });

  it("sends the week-ahead Briefing at 6 p.m. on a Sunday, as well as each weekday's", async () => {
    await backend.briefings.runDue();
    await phoneWithSomethingDue();

    await reach("2026-11-06T13:00:00Z"); // Friday, 8 a.m.
    await reach("2026-11-07T23:00:00Z"); // Saturday has none.
    await reach("2026-11-08T22:59:00Z"); // Sunday, a minute before 6 p.m.
    expect(backend.notifier.sent).toHaveLength(1);

    await reach("2026-11-08T23:00:00Z");
    expect(backend.notifier.sent).toHaveLength(2);
    expect(backend.notifier.sent[1]!.notification.title).toBe("Your week ahead");
    expect((await backend.latestBriefing()).kind).toBe("week_ahead");

    await reach("2026-11-09T13:00:00Z");
    expect(backend.notifier.sent).toHaveLength(3);
    expect(backend.notifier.sent[2]!.notification.title).toBe("Your Briefing");
  });

  it("sends at the right moment on each side of the clocks changing", async () => {
    backend.clock.moveTo("2026-10-29T14:00:00Z");
    await backend.briefings.runDue();
    await phoneWithSomethingDue();
    await roadmap.addMilestone({ name: "Something soon", dueDate: "2026-10-31", goalId: null });

    await reach("2026-10-30T11:59:00Z"); // Friday, 7:59 a.m. EDT.
    expect(backend.notifier.sent).toHaveLength(0);
    await reach("2026-10-30T12:00:00Z"); // Friday, 8 a.m. EDT.
    expect(backend.notifier.sent).toHaveLength(1);

    await reach("2026-11-01T22:00:00Z"); // Sunday, 5 p.m. EST, the day the clocks went back.
    expect(backend.notifier.sent).toHaveLength(1);
    await reach("2026-11-01T23:00:00Z"); // Sunday, 6 p.m. EST.
    expect(backend.notifier.sent).toHaveLength(2);

    await reach("2026-11-02T12:00:00Z"); // Monday, 7 a.m. EST, when it would have been 8 before the change.
    expect(backend.notifier.sent).toHaveLength(2);
    await reach("2026-11-02T13:00:00Z"); // Monday, 8 a.m. EST.
    expect(backend.notifier.sent).toHaveLength(3);
  });

  it("sends at the right moment the week the clocks go forward", async () => {
    backend.clock.moveTo("2027-03-12T14:00:00Z");
    await backend.briefings.runDue();
    expect((await backend.registerPushToken(TOKEN)).status).toBe(204);
    await roadmap.addMilestone({ name: "Something soon", dueDate: "2027-03-16", goalId: null });

    await reach("2027-03-14T21:59:00Z"); // Sunday, 5:59 p.m. EDT.
    expect(backend.notifier.sent).toHaveLength(0);
    await reach("2027-03-14T22:00:00Z"); // Sunday, 6 p.m. EDT.
    expect(backend.notifier.sent).toHaveLength(1);

    await reach("2027-03-15T11:59:00Z"); // Monday, 7:59 a.m. EDT.
    expect(backend.notifier.sent).toHaveLength(1);
    await reach("2027-03-15T12:00:00Z"); // Monday, 8 a.m. EDT.
    expect(backend.notifier.sent).toHaveLength(2);
  });

  it("doesn't send a Briefing for a time that passed before Buddy first ran", async () => {
    await phoneWithSomethingDue();

    // The clock starts at Monday, 9 a.m., an hour after that day's time.
    await backend.briefings.runDue();

    expect(backend.notifier.sent).toEqual([]);
  });

  it("keeps its place through a restart", async () => {
    await backend.briefings.runDue();
    await phoneWithSomethingDue();
    await reach("2026-11-03T13:00:00Z");

    await backend.restart();
    await backend.briefings.runDue();

    expect(backend.notifier.sent).toHaveLength(1);
  });
});

describe("after missed times", () => {
  it("sends only the latest, however many went by", async () => {
    await backend.briefings.runDue();
    await phoneWithSomethingDue();

    // Asleep from Monday morning through Tuesday, Wednesday, Thursday and Friday, waking on Saturday.
    await reach("2026-11-07T15:00:00Z");

    expect(backend.notifier.sent).toHaveLength(1);
    expect((await backend.latestBriefing()).kind).toBe("weekday");

    // It doesn't send it again on the next minute, and the next one is still on time.
    await reach("2026-11-07T15:01:00Z");
    expect(backend.notifier.sent).toHaveLength(1);
    await reach("2026-11-08T23:00:00Z");
    expect(backend.notifier.sent).toHaveLength(2);
  });

  it("sends the week-ahead Briefing when that's the latest that was missed", async () => {
    await backend.briefings.runDue();
    await phoneWithSomethingDue();

    // Asleep from Monday until Monday a week later, at 7 a.m., an hour before that day's.
    await reach("2026-11-09T12:00:00Z");

    expect(backend.notifier.sent).toHaveLength(1);
    expect(backend.notifier.sent[0]!.notification.title).toBe("Your week ahead");
    expect((await backend.latestBriefing()).kind).toBe("week_ahead");
  });

  it("sends the latest when the backend restarts after the laptop was off", async () => {
    await backend.briefings.runDue();
    await phoneWithSomethingDue();
    await reach("2026-11-03T13:00:00Z");

    await backend.restart();
    await reach("2026-11-06T18:00:00Z");

    expect(backend.notifier.sent).toHaveLength(2);
  });
});

describe("what a Briefing holds", () => {
  /** Haiku finds these on the calendar, as Discovery does each day. */
  async function calendarHas(...dates: (typeof WITHDRAW_7B)[]): Promise<void> {
    backend.claude.willReply(haikuFindsDates(...dates), haikuFindsDates());
    await backend.discovery.run();
  }

  /** The flu clinic is on now.temple.edu, on November 10. */
  async function templeHasTheFluClinic(): Promise<number> {
    backend.web.save(EVENTS_LIST_PAGE, eventsListHtml(FLU_CLINIC));
    backend.web.save(FLU_CLINIC_PAGE, eventPageHtml(FLU_CLINIC.name, "Get a free flu shot from Student Health. This event is free."));
    backend.claude.willReply(haikuFindsOpportunities({ summary: "A free flu shot.", cost: "free", cost_quote: "This event is free." }));
    await backend.opportunityDiscovery.runDue();
    return (await opportunityCalls(backend).list())[0].id;
  }

  /** The Student connects, and a later read finds these. Their first read makes no events, as for every Connection. */
  async function connectionFinds(...facts: ConnectionFactToStore[]): Promise<void> {
    if (!(await backend.connections()).find(({ id }) => id === NEWS_CONNECTION).on) {
      expect((await backend.giveReadPermission(NEWS_CONNECTION, undefined)).status).toBe(200);
    }
    factsOnNextRead = [...factsOnNextRead, ...facts];
    expect((await backend.readNow(NEWS_CONNECTION)).status).toBe(200);
  }

  const milestoneNames = (briefing: any) => briefing.milestones.map(({ name }: any) => name);
  const opportunityNames = (briefing: any) => briefing.opportunities.map(({ name }: any) => name);
  const newsWords = (briefing: any) => briefing.news.map(({ text }: any) => text);

  it("has Standard Milestones with their Sources, looking 3 days ahead on a weekday", async () => {
    await backend.briefings.runDue();
    await calendarHas(WITHDRAW_7B, WITHDRAW_16_WEEK);

    await reach("2026-11-27T13:00:00Z"); // Friday. November 30 is 3 days off, and December 7 isn't near.

    const briefing = await backend.latestBriefing();
    expect(milestoneNames(briefing)).toEqual([WITHDRAW_7B.name]);
    expect(briefing.milestones[0].when).toBe("Monday, November 30, 2026");
    expect(briefing.milestones[0].sources[0].url).toContain("registrar.temple.edu");
  });

  it("looks 7 days ahead in the week-ahead Briefing", async () => {
    await backend.briefings.runDue();
    await roadmap.addMilestone({ name: "Seven days off", dueDate: "2026-11-15", goalId: null });
    await roadmap.addMilestone({ name: "Four days off", dueDate: "2026-11-12", goalId: null });
    await roadmap.addMilestone({ name: "Eight days off", dueDate: "2026-11-16", goalId: null });

    await reach("2026-11-08T23:00:00Z");
    expect(milestoneNames(await backend.latestBriefing())).toEqual(["Four days off", "Seven days off"]);

    await reach("2026-11-09T13:00:00Z"); // Monday's looks 3 days ahead, and four days off is now three.
    expect(milestoneNames(await backend.latestBriefing())).toEqual(["Four days off"]);
  });

  it("has Milestones from the Roadmap with their Goal, and none that are done", async () => {
    await backend.briefings.runDue();
    await roadmap.addGoal("Get into PA school");
    const [goal] = await roadmap.goals();
    await roadmap.addMilestone({ name: "Ask for a recommendation", dueDate: "2026-11-04", goalId: goal.id });
    await roadmap.addMilestone({ name: "Already did this", dueDate: "2026-11-04", goalId: goal.id });
    const done = (await roadmap.roadmap()).find(({ name }) => name === "Already did this");
    await roadmap.setDone(done.id, true);

    await reach("2026-11-03T13:00:00Z");

    const briefing = await backend.latestBriefing();
    expect(milestoneNames(briefing)).toEqual(["Ask for a recommendation"]);
    expect(briefing.milestones[0].goal).toBe("Get into PA school");
    expect(briefing.milestones[0].sourceNote).toBe("You added this.");
  });

  it("has a Standard Milestone that's also on the Roadmap only once, and not at all once it's done", async () => {
    await backend.briefings.runDue();
    await calendarHas(WITHDRAW_7B);
    await roadmap.addMilestone({ name: WITHDRAW_7B.name, dueDate: WITHDRAW_7B.date, goalId: null });

    await reach("2026-11-27T13:00:00Z");
    expect(milestoneNames(await backend.latestBriefing())).toEqual([WITHDRAW_7B.name]);

    await roadmap.setDone((await roadmap.roadmap())[0].id, true);
    await reach("2026-11-30T13:00:00Z");
    expect((await backend.latestBriefing()).milestones).toEqual([]);
  });

  it("keeps a weekday's short", async () => {
    await backend.briefings.runDue();
    for (const name of ["First", "Second", "Third", "Fourth"]) await roadmap.addMilestone({ name, dueDate: "2026-11-04", goalId: null });

    await reach("2026-11-03T13:00:00Z");

    expect(milestoneNames(await backend.latestBriefing())).toEqual(["First", "Second", "Third"]);
  });

  it("has Opportunities open to any Student only in the week-ahead Briefing, unless the Student saved one", async () => {
    await backend.briefings.runDue();
    const flu = await templeHasTheFluClinic();

    await reach("2026-11-08T23:00:00Z"); // Sunday. November 10 is 2 days off.
    expect(opportunityNames(await backend.latestBriefing())).toEqual([FLU_CLINIC.name]);

    await reach("2026-11-09T13:00:00Z"); // Monday. Nearer, but it's nothing the Student asked about.
    expect((await backend.latestBriefing()).opportunities).toEqual([]);

    await opportunityCalls(backend).save(flu);
    await reach("2026-11-10T13:00:00Z");
    const briefing = await backend.latestBriefing();
    expect(opportunityNames(briefing)).toEqual([FLU_CLINIC.name]);
    expect(briefing.opportunities[0].sources[0].url).toBe(FLU_CLINIC_PAGE);
    expect(briefing.opportunities[0].cost).toBeTruthy();
  });

  it("drops an Opportunity the Student reports, from the Briefing they already have", async () => {
    await backend.briefings.runDue();
    const flu = await templeHasTheFluClinic();
    await reach("2026-11-08T23:00:00Z");

    await opportunityCalls(backend).report(flu);

    expect((await backend.latestBriefing()).opportunities).toEqual([]);
  });

  it("has what's new in Connections since the last Briefing, and only that", async () => {
    await backend.briefings.runDue();
    await connectionFinds();
    await connectionFinds(fact("before", "Before the first"));
    await reach("2026-11-03T13:00:00Z");
    expect(newsWords(await backend.latestBriefing())).toEqual(["New: Before the first"]);

    backend.clock.moveTo("2026-11-03T20:00:00Z");
    await connectionFinds(fact("after", "After the first"));
    await reach("2026-11-04T13:00:00Z");

    const briefing = await backend.latestBriefing();
    expect(newsWords(briefing)).toEqual(["New: After the first"]);
    expect(briefing.news[0].connection).toBe("A Connection with news");
  });

  it("shows a few of a Connection's news, newest first, and says how much else there is", async () => {
    await backend.briefings.runDue();
    await connectionFinds();
    await connectionFinds(...["one", "two", "three", "four", "five"].map((key) => fact(key)));

    await reach("2026-11-03T13:00:00Z");

    const briefing = await backend.latestBriefing();
    expect(newsWords(briefing)).toEqual(["New: five", "New: four", "New: three"]);
    expect(briefing.moreNews).toEqual([{ connection: "A Connection with news", count: 2 }]);
  });

  describe("from a Connection that's only counted", () => {
    afterEach(() => {
      delete newsConnection.briefingCount;
    });

    it("says how many, and none of the words", async () => {
      newsConnection.briefingCount = { one: "new email", many: "new emails" };
      await backend.briefings.runDue();
      await connectionFinds();
      await connectionFinds(fact("one", "A subject line"), fact("two", "Another subject line"));

      await reach("2026-11-03T13:00:00Z");

      const briefing = await backend.latestBriefing();
      expect(briefing.news).toEqual([]);
      expect(briefing.moreNews).toEqual([{ connection: "A Connection with news", count: 2, words: "2 new emails in A Connection with news." }]);
      expect(JSON.stringify(briefing)).not.toContain("subject line");
    });

    it("says it in the singular for one", async () => {
      newsConnection.briefingCount = { one: "new email", many: "new emails" };
      await backend.briefings.runDue();
      await connectionFinds();
      await connectionFinds(fact("one"));

      await reach("2026-11-03T13:00:00Z");

      expect((await backend.latestBriefing()).moreNews[0].words).toBe("1 new email in A Connection with news.");
    });

    it("is what TUmail is, so that a Briefing never lists an email's subject", () => {
      expect(tumail.briefingCount).toEqual({ one: "new email", many: "new emails" });
    });
  });

  it("keeps nothing from a Connection after its Read Permission is revoked", async () => {
    await backend.briefings.runDue();
    await connectionFinds();
    await connectionFinds(fact("hold", "A made-up hold on the account"));
    await reach("2026-11-03T13:00:00Z");
    expect(newsWords(await backend.latestBriefing())).toEqual(["New: A made-up hold on the account"]);

    await backend.revokeReadPermission(NEWS_CONNECTION);

    expect((await backend.latestBriefing()).news).toEqual([]);
    expect(backend.storageContains("A made-up hold on the account")).toBe(false);
  });

  it("tells Firebase how many of what, and nothing about any of them", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);
    await roadmap.addGoal("Get into PA school");
    await roadmap.addMilestone({ name: "Pay the made-up balance", dueDate: "2026-11-04", goalId: (await roadmap.goals())[0].id });
    await roadmap.addMilestone({ name: "See a made-up advisor", dueDate: "2026-11-04", goalId: null });
    await connectionFinds();
    await connectionFinds(fact("grade", "A made-up grade of C-"));

    await reach("2026-11-03T13:00:00Z");

    const { notification } = backend.notifier.sent[0]!;
    expect(notification.title).toBe("Your Briefing");
    expect(notification.body).toBe("2 Milestones and 1 thing new in your Connections.");
    expect(notification.data).toEqual({ type: "briefing" });
    expect(JSON.stringify(notification)).not.toMatch(/balance|advisor|grade|PA school/);
  });

  it("sends no notification when nothing is relevant, and makes nothing up", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);

    await reach("2026-11-03T13:00:00Z");

    expect(backend.notifier.sent).toEqual([]);
    const briefing = await backend.latestBriefing();
    expect(briefing.hadNothing).toBe(true);
    expect(briefing.milestones).toEqual([]);
    expect(briefing.opportunities).toEqual([]);
    expect(briefing.news).toEqual([]);
    expect((await backend.activity())[0].kind).toBe("briefing_empty");
  });

  it("doesn't bring back an earlier Briefing's notification when the latest had nothing", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-04", goalId: null });
    backend.notifier.nextOutcomes.push({ outcome: "failed", problem: "Made up." });
    await reach("2026-11-03T13:00:00Z");
    expect(backend.notifier.sent).toEqual([]);

    await roadmap.setDone((await roadmap.roadmap())[0].id, true);
    await reach("2026-11-05T13:00:00Z");

    expect(backend.notifier.sent).toEqual([]);
  });

  it("says when what was in it has since gone, apart from having had nothing", async () => {
    await backend.briefings.runDue();
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-04", goalId: null });
    await reach("2026-11-03T13:00:00Z");

    await roadmap.removeMilestone((await roadmap.roadmap())[0].id);

    const briefing = await backend.latestBriefing();
    expect(briefing.milestones).toEqual([]);
    expect(briefing.hadNothing).toBe(false);
  });

  it("says in Activity what it made", async () => {
    await backend.briefings.runDue();
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-04", goalId: null });

    await reach("2026-11-03T13:00:00Z");

    const [made] = await backend.activity();
    expect(made.kind).toBe("briefing_made");
    expect(made.title).toBe("Buddy made your Briefing");
    expect(made.detail).toContain("1 Milestone.");
  });
});

describe("the phone's push token", () => {
  it("is refused without a phone's key", async () => {
    expect((await backend.registerPushToken(TOKEN, {})).status).toBe(401);
  });

  it.each([[42], [""], ["has spaces in it"], [null], ["x".repeat(5000)]])("is refused when it isn't one: %j", async (token) => {
    expect((await backend.registerPushToken(token)).status).toBe(400);
  });

  it("is replaced when the phone gets a new one", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken("first-token");
    await backend.registerPushToken("second-token");
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-04", goalId: null });

    await reach("2026-11-03T13:00:00Z");

    expect(backend.notifier.sent.map(({ token }) => token)).toEqual(["second-token"]);
  });

  it("goes to each paired phone, and to one phone once even if it was paired again", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken("same-phone");
    const pairing = await fetch(`${backend.url}/devices/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: backend.devices.newPairingCode().code }),
    });
    const { deviceKey } = (await pairing.json()) as { deviceKey: string };
    await backend.registerPushToken("same-phone", { authorization: `Bearer ${deviceKey}` });
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-04", goalId: null });
    await reach("2026-11-03T13:00:00Z");
    expect(backend.notifier.sent.map(({ token }) => token)).toEqual(["same-phone"]);

    await backend.registerPushToken("other-phone");
    await roadmap.addMilestone({ name: "Sooner", dueDate: "2026-11-05", goalId: null });
    await reach("2026-11-04T13:00:00Z");
    expect(backend.notifier.sent.slice(1).map(({ token }) => token).toSorted()).toEqual(["other-phone", "same-phone"]);
  });

  it("doesn't get a Briefing that went out before it was registered, and gets the next", async () => {
    await backend.briefings.runDue();
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-04", goalId: null });
    await reach("2026-11-03T13:00:00Z");
    expect(backend.notifier.sent).toEqual([]);
    expect((await backend.latestBriefing()).milestones).toHaveLength(1);

    await backend.registerPushToken(TOKEN);
    await reach("2026-11-03T13:01:00Z");
    expect(backend.notifier.sent).toEqual([]);

    await reach("2026-11-04T13:00:00Z");
    expect(backend.notifier.sent).toHaveLength(1);
  });

  it("isn't stored in Activity, or put in what the app can read", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-04", goalId: null });
    await reach("2026-11-03T13:00:00Z");

    expect(JSON.stringify(await backend.activity())).not.toContain(TOKEN);
    expect(JSON.stringify(await backend.briefingSettings())).not.toContain(TOKEN);
    expect(JSON.stringify(await backend.latestBriefing())).not.toContain(TOKEN);
  });
});

describe("when sending to the phone doesn't work", () => {
  beforeEach(async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-04", goalId: null });
    await roadmap.addMilestone({ name: "Later on", dueDate: "2026-11-07", goalId: null });
  });

  it("tries again next time round, as a laptop just waking might have no network yet", async () => {
    backend.notifier.nextOutcomes.push({ outcome: "failed", problem: "Made up." });

    await reach("2026-11-03T13:00:00Z");
    expect(backend.notifier.sent).toHaveLength(0);

    await reach("2026-11-03T13:01:00Z");
    expect(backend.notifier.sent).toHaveLength(1);

    await reach("2026-11-03T13:02:00Z");
    expect(backend.notifier.sent).toHaveLength(1);
  });

  it("says so in Activity once, however many times it fails, and then says when it worked", async () => {
    backend.notifier.nextOutcomes.push(
      { outcome: "failed", problem: "Made up." },
      { outcome: "failed", problem: "Made up." },
      { outcome: "failed", problem: "Made up." },
    );

    await reach("2026-11-03T13:00:00Z");
    await reach("2026-11-03T13:01:00Z");
    await reach("2026-11-03T13:02:00Z");
    await reach("2026-11-03T13:03:00Z");

    const kinds = (await backend.activity()).map(({ kind }) => kind);
    expect(kinds.filter((kind) => kind === "briefing_send_failed")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "briefing_sent")).toHaveLength(1);
  });

  it("gives up on the old one when a newer one is due", async () => {
    backend.notifier.nextOutcomes.push({ outcome: "failed", problem: "Made up." });
    await reach("2026-11-03T13:00:00Z");

    await reach("2026-11-04T13:00:00Z");

    expect(backend.notifier.sent).toHaveLength(1);
    expect((await backend.latestBriefing()).milestones.map(({ name }: any) => name)).toEqual(["Soon", "Later on"]);
  });

  it("stops using a token that's gone", async () => {
    backend.notifier.nextOutcomes.push({ outcome: "token_gone" });

    await reach("2026-11-03T13:00:00Z");
    await reach("2026-11-03T13:01:00Z");
    await reach("2026-11-04T13:00:00Z");

    expect(backend.notifier.sent).toEqual([]);
  });

  it("records what went to Firebase, word for word", async () => {
    await reach("2026-11-03T13:00:00Z");

    const sent = (await backend.activity()).find(({ kind }) => kind === "briefing_sent");
    expect(sent.title).toBe("Buddy sent your Briefing to your phone");
    expect(sent.detail).toContain("Firebase");
    expect(sent.detail).toContain("Your Briefing. 1 Milestone.");
  });

  it("still makes the Briefing when phone notifications are off, and tries to send nothing", async () => {
    backend.notifier.offBecause = "Phone notifications are off for this test.";

    await reach("2026-11-03T13:00:00Z");

    expect(backend.notifier.sent).toEqual([]);
    expect((await backend.latestBriefing()).milestones).toHaveLength(1);
    expect((await backend.activity()).map(({ kind }) => kind)).not.toContain("briefing_send_failed");
  });
});

describe("the Student's Briefing times", () => {
  it("start at 8 a.m. on weekdays and 6 p.m. on Sundays, and say when the next one is", async () => {
    const settings = await backend.briefingSettings();

    expect(settings.times).toEqual({ weekdays: "08:00", sunday: "18:00" });
    expect(settings.next.kind).toBe("weekday");
    expect(settings.next.when).toBe("Tuesday, November 3 at 8:00 AM");
  });

  it("say plainly whether phone notifications are on", async () => {
    expect((await backend.briefingSettings()).phoneNotifications).toEqual({ on: true, offBecause: null });

    // What's wrong in detail goes in the backend's log. The Student gets words that don't need a developer.
    backend.notifier.offBecause = "FIREBASE_SERVICE_ACCOUNT_FILE isn't set in .env.local.";
    const { phoneNotifications } = await backend.briefingSettings();
    expect(phoneNotifications.on).toBe(false);
    expect(phoneNotifications.offBecause).toMatch(/aren't set up yet/);
    expect(phoneNotifications.offBecause).not.toMatch(/FIREBASE|\.env/);
  });

  it("can be changed, and Briefings then go at the new times", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-04", goalId: null });

    const answer = await backend.changeBriefingTimes({ weekdays: "07:15", sunday: "20:45" });
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as any).next.when).toBe("Tuesday, November 3 at 7:15 AM");

    await reach("2026-11-03T12:14:00Z");
    expect(backend.notifier.sent).toHaveLength(0);
    await reach("2026-11-03T12:15:00Z");
    expect(backend.notifier.sent).toHaveLength(1);
    await reach("2026-11-03T13:00:00Z");
    expect(backend.notifier.sent).toHaveLength(1);
  });

  it("change the Sunday time too", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);
    await backend.changeBriefingTimes({ weekdays: "08:00", sunday: "20:45" });
    await reach("2026-11-07T15:00:00Z"); // Saturday, with Friday's dealt with.
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-10", goalId: null });

    await reach("2026-11-08T23:00:00Z"); // 6 p.m., the old time.
    expect(backend.notifier.sent).toHaveLength(0);
    await reach("2026-11-09T01:45:00Z"); // 8:45 p.m.
    expect(backend.notifier.sent).toHaveLength(1);
  });

  it("are kept through a restart", async () => {
    await backend.changeBriefingTimes({ weekdays: "07:15", sunday: "20:45" });

    await backend.restart();

    expect((await backend.briefingSettings()).times).toEqual({ weekdays: "07:15", sunday: "20:45" });
  });

  it("send nothing straight away when changed to a time that's already passed today", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-05", goalId: null });
    // Tuesday at 7:30 a.m., before the usual 8 a.m., moving it to 7 a.m.
    backend.clock.moveTo("2026-11-03T12:30:00Z");
    await backend.changeBriefingTimes({ weekdays: "07:00", sunday: "18:00" });

    await backend.briefings.runDue();

    expect(backend.notifier.sent).toHaveLength(0);
    await reach("2026-11-04T12:00:00Z");
    expect(backend.notifier.sent).toHaveLength(1);
  });

  it("don't lose a Briefing that came due just before they changed, before the timer looked", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-05", goalId: null });

    // 8:00:30 on Tuesday, with the worker's minute not yet come round. Only Sunday's time changes.
    backend.clock.moveTo("2026-11-03T13:00:30Z");
    await backend.changeBriefingTimes({ weekdays: "08:00", sunday: "20:00" });
    await backend.briefings.runDue();

    expect(backend.notifier.sent).toHaveLength(1);
  });

  it("send another today when changed to later today, after today's went out", async () => {
    await backend.briefings.runDue();
    await backend.registerPushToken(TOKEN);
    await roadmap.addMilestone({ name: "Soon", dueDate: "2026-11-05", goalId: null });
    await reach("2026-11-03T13:00:00Z");
    expect(backend.notifier.sent).toHaveLength(1);

    await backend.changeBriefingTimes({ weekdays: "10:00", sunday: "18:00" });
    await reach("2026-11-03T15:00:00Z");

    expect(backend.notifier.sent).toHaveLength(2);
  });

  it.each([
    [{ weekdays: "8 a.m.", sunday: "18:00" }],
    [{ weekdays: "08:00", sunday: "24:00" }],
    [{ weekdays: "08:00" }],
    [{ weekdays: "08:60", sunday: "18:00" }],
    [{ weekdays: 8, sunday: 18 }],
    [{}],
  ])("refuse what isn't a time: %j", async (times) => {
    expect((await backend.changeBriefingTimes(times)).status).toBe(400);
    expect((await backend.briefingSettings()).times).toEqual({ weekdays: "08:00", sunday: "18:00" });
  });

  it("say in Activity when they change, and not when they stay the same", async () => {
    await backend.changeBriefingTimes({ weekdays: "07:15", sunday: "20:45" });
    await backend.changeBriefingTimes({ weekdays: "07:15", sunday: "20:45" });

    const changes = (await backend.activity()).filter(({ kind }) => kind === "briefing_times_changed");
    expect(changes).toHaveLength(1);
    expect(changes[0].detail).toBe("Weekdays at 7:15 AM and Sundays at 8:45 PM, Philadelphia time.");
  });

  it("need a phone's key", async () => {
    for (const [method, path] of [["GET", "/briefings/latest"], ["GET", "/briefings/settings"], ["PUT", "/briefings/settings"]] as const) {
      expect((await fetch(`${backend.url}${path}`, { method })).status).toBe(401);
    }
  });
});
