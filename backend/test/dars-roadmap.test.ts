import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dars } from "../src/dars.ts";
import { DARS_ID } from "../src/dars-rules.ts";
import { settings } from "../src/settings.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { auditWith, saveDarsPages, savedDarsHtml } from "./support/dars-pages.ts";
import { roadmapCalls, toolCall } from "./support/roadmap-helpers.ts";

/** Every page these read is made up. Nobody has seen the real DARS, so none of this proves the reader fits it. */
let backend: BackendHarness;
let calls: ReturnType<typeof roadmapCalls>;

const MISSING = "Status_NO";
const COMPLETE = "Status_OK";

beforeEach(async () => {
  backend = await BackendHarness.start({ sites: { dars: settings.sites.dars! }, extraConnectionTypes: [dars] });
  calls = roadmapCalls(backend);
});

afterEach(async () => {
  await backend.stop();
});

/** A conversation for a card to go in, and a Roadmap with something on it. */
async function aRoadmap(name = "Something of mine"): Promise<void> {
  backend.claude.willReply({ chunks: ["Hi."] });
  await backend.sendAndCollect("Hello");
  await calls.addMilestone({ name, dueDate: "2027-01-15", goalId: null });
}

const cards = async () => (await backend.history()).filter((entry) => entry.type === "roadmap_card").map((entry) => entry.card);
const waiting = async () => (await cards()).filter((card) => card.status === "waiting");
const read = async (requirements: Record<string, string>) => {
  saveDarsPages(backend.browser, { audit: auditWith(requirements) });
  const response = await backend.readNow(DARS_ID);
  expect(response.status).toBe(200);
};
const connectWith = async (requirements: Record<string, string>) => {
  saveDarsPages(backend.browser, { audit: auditWith(requirements) });
  expect((await backend.giveReadPermission(DARS_ID, undefined)).status).toBe(200);
};
const namesOn = (card: any) => card.milestones.map((milestone: any) => milestone.name);
const onRoadmap = async () => (await calls.roadmap()).map((milestone) => milestone.name);

describe("a difference from the Roadmap", () => {
  it("shows a card for a missing requirement that isn't on the Roadmap, in the conversation", async () => {
    await aRoadmap();

    await connectWith({ "SCIENCE REQUIREMENT": MISSING, "ARTS REQUIREMENT": COMPLETE });

    const [card] = await waiting();
    expect(card.kind).toBe("change");
    expect(namesOn(card)).toEqual(["Meet this DARS requirement: SCIENCE REQUIREMENT"]);
    expect(card.why).toMatch(/DARS audit/);
    expect(card.why).toContain("10/30/2026 3:52 PM");
  });

  it("changes nothing on the Roadmap until the Student taps Accept", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    expect(await onRoadmap()).toEqual(["Something of mine"]);

    const [card] = await waiting();
    expect((await calls.accept(card.id)).status).toBe(200);

    expect(await onRoadmap()).toEqual(expect.arrayContaining(["Something of mine", "Meet this DARS requirement: SCIENCE REQUIREMENT"]));
  });

  it("changes nothing if the Student taps Not now", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });

    await calls.notNow((await waiting())[0].id);

    expect(await onRoadmap()).toEqual(["Something of mine"]);
  });

  it("says plainly that the date is a target and the audit isn't the final word", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });

    const [card] = await waiting();
    expect(card.note).toMatch(/target/);
    expect(card.note).toMatch(/academic advisor/);
    expect(card.note).toMatch(/Accept/);
    expect(card.milestones[0].dueDate > "2026-11-02").toBe(true);
    expect(card.milestones[0].when).toBe("By the end of Spring 2027");
    expect(card.milestones[0].sources[0].url).toBe("https://dars.temple.edu/");
    expect(decodeURIComponent(card.milestones[0].calendarUrl).replaceAll("+", " ")).toMatch(/This is a target, not a Temple deadline/);
  });

  it("takes off a Milestone for a requirement that's now complete, once the Student taps Accept", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    await calls.accept((await waiting())[0].id);

    await read({ "SCIENCE REQUIREMENT": COMPLETE });

    const [card] = await waiting();
    expect(card.removes.map((removed: any) => removed.name)).toEqual(["Meet this DARS requirement: SCIENCE REQUIREMENT"]);
    expect(await onRoadmap()).toContain("Meet this DARS requirement: SCIENCE REQUIREMENT");

    await calls.accept(card.id);

    expect(await onRoadmap()).toEqual(["Something of mine"]);
  });

  it("goes by a Milestone of the Student's own that names the requirement", async () => {
    await aRoadmap("Finish the science requirement");

    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    expect(await waiting()).toEqual([]);

    await read({ "SCIENCE REQUIREMENT": COMPLETE });
    expect((await waiting())[0].removes.map((removed: any) => removed.name)).toEqual(["Finish the science requirement"]);
  });

  it("doesn't take a Milestone for a requirement because they share one word", async () => {
    await aRoadmap("Declare a major");

    await connectWith({ MAJOR: COMPLETE });

    expect(await cards()).toEqual([]);
  });

  it("goes by the words of a title, without its code or its punctuation", async () => {
    await aRoadmap("Finish science & technology, this year");

    await connectWith({ "GENED-GS2 --- SCIENCE &amp; TECHNOLOGY": COMPLETE });

    expect((await waiting())[0].removes.map((removed: any) => removed.name)).toEqual(["Finish science & technology, this year"]);
  });

  it("doesn't add what a Milestone already covers by naming one of its courses", async () => {
    await aRoadmap("Take MADE 0814 next term");
    saveDarsPages(backend.browser, { audit: savedDarsHtml("audit") });

    await backend.giveReadPermission(DARS_ID, undefined);

    expect(await waiting()).toEqual([]);
  });

  it("doesn't add what the Student has marked done", async () => {
    await aRoadmap("Finish the science requirement");
    const [milestone] = await calls.roadmap();
    await calls.setDone(milestone.id, true);

    await connectWith({ "SCIENCE REQUIREMENT": MISSING });

    expect(await waiting()).toEqual([]);
  });

  it("takes in progress and planned for neither missing nor complete", async () => {
    await aRoadmap("Finish the science requirement");

    await connectWith({ "SCIENCE REQUIREMENT": "Status_IP", "ARTS REQUIREMENT": "Status_PL" });

    expect(await cards()).toEqual([]);
  });

  it("shows no more than a few at a time, and says there are more", async () => {
    await aRoadmap();
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`REQUIREMENT ${index + 1}`, MISSING]));

    await connectWith(many);

    const [card] = await waiting();
    expect(card.milestones).toHaveLength(5);
    expect(card.note).toMatch(/4 more/);

    await calls.notNow(card.id);
    await backend.readNow(DARS_ID);

    expect(namesOn((await waiting())[0])).toEqual(["Meet this DARS requirement: REQUIREMENT 6", "Meet this DARS requirement: REQUIREMENT 7", "Meet this DARS requirement: REQUIREMENT 8", "Meet this DARS requirement: REQUIREMENT 9"]);
  });

  it("keeps every Milestone for one requirement on the same card, so that none is lost at the cut", async () => {
    await aRoadmap("Finish the science requirement");
    await calls.addMilestone({ name: "Plan for science requirement", dueDate: "2027-03-15", goalId: null });
    for (const number of [1, 2, 3, 4]) await calls.addMilestone({ name: `Finish other thing ${number}`, dueDate: "2027-03-15", goalId: null });
    const others = Object.fromEntries([1, 2, 3, 4].map((number) => [`OTHER THING ${number}`, COMPLETE]));

    await connectWith({ ...others, "SCIENCE REQUIREMENT": COMPLETE });
    const [first] = await waiting();

    expect(first.removes).toHaveLength(6);
    await calls.accept(first.id);
    expect(await onRoadmap()).toEqual([]);
  });

  it("goes on comparing after the Student deletes the audit's summary from their Profile", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    await calls.notNow((await waiting())[0].id);
    const summary = (await backend.profileFacts()).find((fact) => fact.text.startsWith("DARS audit from"));
    await backend.deleteFact(summary.id);

    await read({ "SCIENCE REQUIREMENT": MISSING, "ARTS REQUIREMENT": MISSING });

    expect(namesOn((await waiting())[0])).toEqual(["Meet this DARS requirement: ARTS REQUIREMENT"]);
  });

  it("says that any more wait for a read after this card", async () => {
    await aRoadmap();
    const many = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`REQUIREMENT ${index + 1}`, MISSING]));

    await connectWith(many);

    expect((await waiting())[0].note).toMatch(/1 more.*next time it reads DARS/);
  });

  it("is in Activity", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });

    const entry = (await backend.activity()).find((candidate) => candidate.kind === "roadmap_change_proposed");
    expect(entry.title).toMatch(/DARS/);
    expect(entry.detail).toContain("SCIENCE REQUIREMENT");
  });
});

describe("the same difference again", () => {
  it("makes no new card while the last is waiting", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });

    await read({ "SCIENCE REQUIREMENT": MISSING });
    await read({ "SCIENCE REQUIREMENT": MISSING });

    expect(await cards()).toHaveLength(1);
    expect((await cards())[0].status).toBe("waiting");
  });

  it("makes no new card after Not now", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    await calls.notNow((await waiting())[0].id);

    await read({ "SCIENCE REQUIREMENT": MISSING });

    expect(await cards()).toHaveLength(1);
  });

  it("makes no new card after Accept, even once the Student has taken the Milestone off", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    await calls.accept((await waiting())[0].id);
    const added = (await calls.roadmap()).find((milestone) => /SCIENCE/.test(milestone.name));
    await calls.removeMilestone(added.id);

    await read({ "SCIENCE REQUIREMENT": MISSING });

    expect(await cards()).toHaveLength(1);
  });

  it("does make a card for what's new, and only that", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    await calls.notNow((await waiting())[0].id);

    await read({ "SCIENCE REQUIREMENT": MISSING, "ARTS REQUIREMENT": MISSING });

    expect(namesOn((await waiting())[0])).toEqual(["Meet this DARS requirement: ARTS REQUIREMENT"]);
  });

  it("swaps a waiting card for one with what's changed, keeping what's still true", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });

    await read({ "SCIENCE REQUIREMENT": MISSING, "ARTS REQUIREMENT": MISSING });

    const all = await cards();
    expect(all.map((card) => card.status)).toEqual(["replaced", "waiting"]);
    expect(namesOn(all[1])).toEqual(["Meet this DARS requirement: SCIENCE REQUIREMENT", "Meet this DARS requirement: ARTS REQUIREMENT"]);
  });

  it("stops a waiting card working once the difference has gone", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    const [card] = await waiting();

    await read({ "SCIENCE REQUIREMENT": COMPLETE });

    expect((await cards())[0].status).toBe("out_of_date");
    await calls.accept(card.id);
    expect(await onRoadmap()).toEqual(["Something of mine"]);
  });
});

describe("when there's no card to show", () => {
  it("shows none for a Student with no Roadmap, and does once they have one", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });
    await backend.sendAndCollect("Hello");

    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    expect(await cards()).toEqual([]);

    await calls.addMilestone({ name: "Something of mine", dueDate: "2027-01-15", goalId: null });
    await read({ "SCIENCE REQUIREMENT": MISSING });

    expect(await waiting()).toHaveLength(1);
  });

  it("shows none when there's no conversation to put it in", async () => {
    await calls.addMilestone({ name: "Something of mine", dueDate: "2027-01-15", goalId: null });

    await connectWith({ "SCIENCE REQUIREMENT": MISSING });

    expect((await backend.activity()).filter((entry) => entry.kind === "roadmap_change_proposed")).toEqual([]);
  });

  it("shows none from a read it couldn't understand", async () => {
    await aRoadmap();
    saveDarsPages(backend.browser, { audit: auditWith({ ONE: MISSING, TWO: "Status_MAYBE" }) });

    await backend.giveReadPermission(DARS_ID, undefined);

    expect(await cards()).toEqual([]);
  });

  it("shows none from an old audit, which may well have changed", async () => {
    await aRoadmap();
    const oldList = savedDarsHtml("audit-list").replace("10/30/2026 3:52 PM", "01/30/2026 3:52 PM").replace("08/07/2026 10:45 AM", "01/07/2026 10:45 AM");
    saveDarsPages(backend.browser, { list: oldList, audit: auditWith({ "SCIENCE REQUIREMENT": MISSING }) });

    await backend.giveReadPermission(DARS_ID, undefined);

    expect(await cards()).toEqual([]);
  });

  it("doesn't take away a card the Student is still deciding on from something else", async () => {
    await aRoadmap();
    const [mine] = await calls.roadmap();
    backend.claude.willReply(
      toolCall("suggest_roadmap_change", { why: "Made up.", plan_id: null, plan_option: null, plan_goal_id: null, current_plan_year: null, year_fact: null, goal_milestones: [], standard_milestone_ids: [], remove_milestone_ids: [mine.id] }),
      { chunks: ["Here's a card."] },
    );
    await backend.sendAndCollect("Take that off");
    const [fromClaude] = await waiting();

    await connectWith({ "SCIENCE REQUIREMENT": MISSING });

    expect((await waiting()).map((card) => card.id)).toEqual([fromClaude.id]);

    await calls.notNow(fromClaude.id);
    await read({ "SCIENCE REQUIREMENT": MISSING });

    expect(namesOn((await waiting())[0])).toEqual(["Meet this DARS requirement: SCIENCE REQUIREMENT"]);
  });
});

describe("revoking the Read Permission", () => {
  it("stops a waiting card working", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    const [card] = await waiting();

    await backend.revokeReadPermission(DARS_ID);

    expect((await cards())[0].status).toBe("out_of_date");
    await calls.accept(card.id);
    expect(await onRoadmap()).toEqual(["Something of mine"]);
  });

  it("leaves a Milestone the Student has already accepted", async () => {
    await aRoadmap();
    await connectWith({ "SCIENCE REQUIREMENT": MISSING });
    await calls.accept((await waiting())[0].id);

    await backend.revokeReadPermission(DARS_ID);

    expect(await onRoadmap()).toContain("Meet this DARS requirement: SCIENCE REQUIREMENT");
  });
});
