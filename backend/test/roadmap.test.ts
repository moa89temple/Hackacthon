import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness } from "./support/backend-harness.ts";
import { BIOLOGY_BS_PAGE, GEOLOGY_PAGE, HISTORIC_PRESERVATION_PAGE, MECHANICAL_PAGE, PROGRAMS_PAGE, saveBulletinPages } from "./support/bulletin-pages.ts";
import {
  ADD_DROP_16_WEEK,
  CALENDAR_PAGE,
  FAFSA_PRIORITY,
  FINALS_FIRST_DAYS,
  haikuFindsDates,
  PRIORITY_REGISTRATION_FALL,
  TEST_MILESTONE_OFFICES,
  WITHDRAW_16_WEEK,
  WITHDRAW_7B,
} from "./support/milestone-pages.ts";
import { roadmapCalls, toolCall } from "./support/roadmap-helpers.ts";

const SAVE_GOAL = "save_goal";
const READ_PLAN = "read_academic_plan";
const PROPOSE = "propose_roadmap";
const SUGGEST = "suggest_roadmap_change";
const REMEMBER = "remember";

const MAJOR_FACT = "Majoring in Biology.";
const YEAR_FACT = "In their second year at Temple.";

let backend: BackendHarness;
let calls: ReturnType<typeof roadmapCalls>;

beforeEach(async () => {
  backend = await BackendHarness.start({ offices: [], milestoneOffices: TEST_MILESTONE_OFFICES });
  saveBulletinPages(backend.web);
  calls = roadmapCalls(backend);
  backend.claude.willReply(
    haikuFindsDates(WITHDRAW_7B, WITHDRAW_16_WEEK, ADD_DROP_16_WEEK, FINALS_FIRST_DAYS, PRIORITY_REGISTRATION_FALL),
    haikuFindsDates(FAFSA_PRIORITY),
  );
  await backend.discovery.run();
  backend.claude.requests.length = 0;
});

afterEach(async () => {
  await backend.stop();
});

/** A turn in which Claude makes these calls one after another, then says something short. */
async function turn(text: string, ...toolCalls: [string, unknown][]): Promise<any[]> {
  backend.claude.willReply(...toolCalls.map(([name, input]) => toolCall(name, input)), { chunks: ["Done."] });
  return backend.sendAndCollect(text);
}

const answersIn = () =>
  backend.claude.requests
    .flatMap((request) => request.messages.at(-1)!.content as any[])
    .filter((block: any) => block?.type === "tool_result") as { content: string; is_error?: boolean }[];

const cardIn = (events: any[]) => events.find((event) => event.type === "roadmap_card")?.card;

async function aGoal(text = "Get into PA school"): Promise<any> {
  await turn(text, [SAVE_GOAL, { goal: text }]);
  return (await calls.goals()).find((goal) => goal.text === text);
}

async function aStudentWithMajorAndYear(): Promise<void> {
  await turn("I'm a Biology major in my second year.", [REMEMBER, { fact: MAJOR_FACT }], [REMEMBER, { fact: YEAR_FACT }]);
}

async function readBiologyPlan(): Promise<number> {
  await turn("Can you look up my plan?", [READ_PLAN, { major: "Biology BS", major_fact: MAJOR_FACT }]);
  return JSON.parse(answersIn().at(-1)!.content.split("\n")[0]!).plan_id;
}

const proposal = (planId: number | null, goalId: number, extra: object = {}) => ({
  why: "This fits getting into PA school.",
  plan_id: planId,
  plan_option: planId === null ? null : 1,
  plan_goal_id: planId === null ? null : goalId,
  current_plan_year: 2,
  year_fact: YEAR_FACT,
  goal_milestones: [
    { goal_id: goalId, name: "Start shadowing a physician assistant", detail: null, due_date: "2027-06-01", guidebook_item_id: null },
  ],
  ...extra,
});

async function aProposedRoadmap(): Promise<{ goal: any; card: any }> {
  const goal = await aGoal();
  await aStudentWithMajorAndYear();
  const planId = await readBiologyPlan();
  const events = await turn("Please make me a Roadmap.", [PROPOSE, proposal(planId, goal.id)]);
  return { goal, card: cardIn(events) };
}

describe("Goals", () => {
  it("saves a Goal Buddy helped the Student choose, for the You tab", async () => {
    await turn("I want to get into PA school.", [SAVE_GOAL, { goal: "Get into PA school" }]);

    expect(await calls.goals()).toMatchObject([{ text: "Get into PA school" }]);
  });

  it("allows several Goals, and keeps one saved twice only once", async () => {
    await turn(
      "PA school, and four years.",
      [SAVE_GOAL, { goal: "Get into PA school" }],
      [SAVE_GOAL, { goal: "Graduate in four years" }],
      [SAVE_GOAL, { goal: "get into PA school" }],
    );

    expect((await calls.goals()).map((goal) => goal.text)).toEqual(["Get into PA school", "Graduate in four years"]);
  });

  it("tells Claude there's no Goal yet, with each turn, and to help choose one", async () => {
    backend.claude.willReply({ chunks: ["What are you hoping for?"] });

    await backend.sendAndCollect("Hi");

    const request = backend.claude.requests.at(-1)!;
    expect(JSON.stringify(request.messages.at(-1))).toMatch(/no Goal yet/);
    expect(request.system).toMatch(/help them choose/i);
  });

  it("tells Claude each Goal with each turn, quoted so it can't read as an instruction", async () => {
    const goal = await aGoal();
    backend.claude.willReply({ chunks: ["Okay."] });

    await backend.sendAndCollect("Hi again");

    const note = backend.claude.requests.at(-1)!.messages.at(-1)!.content as string;
    expect(note).toContain(`"id":${goal.id}`);
    expect(note).toContain('"text":"Get into PA school"');
  });

  it("lets the Student add, change and remove a Goal themselves", async () => {
    const added = (await (await calls.addGoal("Study abroad")).json()) as any;
    expect(added.goal).toMatchObject({ text: "Study abroad" });

    const changed = (await (await calls.editGoal(added.goal.id, "Study abroad in Rome")).json()) as any;
    expect(changed.goal).toMatchObject({ text: "Study abroad in Rome" });
    expect((await calls.removeGoal(added.goal.id)).status).toBe(200);

    expect(await calls.goals()).toEqual([]);
  });

  it("refuses an empty Goal and one that doesn't exist", async () => {
    expect((await calls.addGoal("  ")).status).toBe(400);
    expect((await calls.editGoal(999, "Something")).status).toBe(404);
    expect((await calls.removeGoal(999)).status).toBe(404);
  });

  it("hides a secret in a Goal", async () => {
    await calls.addGoal("My password is hunter2 and my goal is PA school");

    expect((await calls.goals())[0].text).not.toContain("hunter2");
  });
});

describe("reading the Suggested Academic Plan", () => {
  it("won't look up a major that isn't in the Profile, so that Buddy asks", async () => {
    await turn("Make me a Roadmap.", [READ_PLAN, { major: "Biology BS", major_fact: "Majoring in Biology." }]);

    const answer = answersIn().at(-1)!;
    expect(answer.is_error).toBe(true);
    expect(answer.content).toMatch(/Ask the Student/);
    expect(backend.web.requests).not.toContain(PROGRAMS_PAGE);
  });

  it("reads the Plan for the Student's major from its real Bulletin page, and keeps its Source", async () => {
    await aStudentWithMajorAndYear();

    const planId = await readBiologyPlan();

    expect(planId).toEqual(expect.any(Number));
    const answer = answersIn().at(-1)!;
    expect(answer.is_error).toBeUndefined();
    expect(answer.content).toContain(BIOLOGY_BS_PAGE);
    expect(answer.content).toContain("Bachelor of Science in Biology");
    expect(answer.content).toContain("BIOL 1111");
    expect(backend.web.requests).toContain(BIOLOGY_BS_PAGE);
  });

  it("names the page it read in the turn's Activity", async () => {
    await aStudentWithMajorAndYear();
    await readBiologyPlan();

    const [latest] = await backend.activity();
    expect(latest.decision.sources).toContainEqual(expect.objectContaining({ url: BIOLOGY_BS_PAGE }));
    expect(latest.decision.tools.join(" ")).toMatch(/Suggested Academic Plan/);
  });

  it("asks which one when the major has more than one degree", async () => {
    await turn("I'm a CS major.", [REMEMBER, { fact: "Majoring in Computer Science." }]);

    await turn("My plan please", [READ_PLAN, { major: "Computer Science", major_fact: "Majoring in Computer Science." }]);

    const answer = answersIn().at(-1)!;
    expect(answer.content).toContain("Computer Science BS");
    expect(answer.content).toContain("Computer Science BA");
    expect(answer.content).toMatch(/Ask the Student which/);
    expect(answer.content).not.toContain("Minor");
    expect(answer.content).not.toContain("MS");
  });

  it("goes by a degree's whole name when it's given, which is how Claude comes back with the Student's answer", async () => {
    await turn("I'm a CS major.", [REMEMBER, { fact: "Majoring in Computer Science." }]);

    await turn("The BS", [READ_PLAN, { major: "Computer Science BS", major_fact: "Majoring in Computer Science." }]);

    expect(answersIn().at(-1)!.content).toContain("Bachelor of Science in Computer Science");
  });

  it("finds a degree whose name is longer than BS when the Student spells it out", async () => {
    await turn("I'm in Nursing.", [REMEMBER, { fact: "Majoring in Nursing." }]);

    await turn("My plan please", [READ_PLAN, { major: "Bachelor of Science in Nursing", major_fact: "Majoring in Nursing." }]);

    expect(backend.web.requests.some((url) => /nursing/.test(url))).toBe(true);
  });

  it("keeps the whole of a course's title, even with a note inside it", async () => {
    await turn("I'm in Geology.", [REMEMBER, { fact: "Majoring in Geology." }]);

    await turn("My plan please", [READ_PLAN, { major: "Geology BS", major_fact: "Majoring in Geology." }]);

    expect(answersIn().at(-1)!.content).toContain("EES 2011 Mineralogy I (F)");
  });

  it("says there's no Source for a major the Bulletin doesn't list", async () => {
    await turn("I'm a Wizardry major.", [REMEMBER, { fact: "Majoring in Wizardry." }]);

    await turn("My plan please", [READ_PLAN, { major: "Wizardry", major_fact: "Majoring in Wizardry." }]);

    expect(answersIn().at(-1)!.content).toMatch(/couldn't find a Source/);
  });

  it("offers each plan when a degree has more than one", async () => {
    await turn("I'm in Mechanical Engineering.", [REMEMBER, { fact: "Majoring in Mechanical Engineering." }]);

    await turn("My plan please", [READ_PLAN, { major: "Mechanical Engineering BSME", major_fact: "Majoring in Mechanical Engineering." }]);

    const answer = answersIn().at(-1)!.content;
    expect(answer).toContain(MECHANICAL_PAGE);
    expect(answer).toContain("Temple Rome Semester Abroad Option");
    expect(answer).toMatch(/"option":2/);
  });

  it("takes two tables with different years as one plan", async () => {
    await turn("I'm in Historic Preservation.", [REMEMBER, { fact: "Majoring in Historic Preservation." }]);

    await turn("My plan please", [READ_PLAN, { major: "Historic Preservation BS", major_fact: "Majoring in Historic Preservation." }]);

    const answer = answersIn().at(-1)!.content;
    expect(answer).toContain(HISTORIC_PRESERVATION_PAGE);
    expect(answer).not.toMatch(/"option":2/);
    expect(answer).toMatch(/Year 1/);
    expect(answer).toMatch(/Year 4/);
  });

  it("reads a Summer term in a plan", async () => {
    await turn("I'm in Geology.", [REMEMBER, { fact: "Majoring in Geology." }]);

    await turn("My plan please", [READ_PLAN, { major: "Geology BS", major_fact: "Majoring in Geology." }]);

    const answer = answersIn().at(-1)!.content;
    expect(answer).toContain(GEOLOGY_PAGE);
    expect(answer).toMatch(/Summer/);
  });

  it("says it has no Source when the Bulletin can't be reached, and doesn't answer from memory", async () => {
    await aStudentWithMajorAndYear();
    backend.web.unreachable = true;

    await turn("My plan please", [READ_PLAN, { major: "Biology BS", major_fact: MAJOR_FACT }]);

    const answer = answersIn().at(-1)!;
    expect(answer.is_error).toBe(true);
    expect(answer.content).toMatch(/no Source/);
  });
});

describe("proposing a Roadmap", () => {
  it("refuses with no Goal, shows no card and tells Claude to help choose one", async () => {
    await aStudentWithMajorAndYear();

    const events = await turn("Make me a Roadmap.", [PROPOSE, proposal(null, 1)]);

    expect(cardIn(events)).toBeUndefined();
    const answer = answersIn().at(-1)!;
    expect(answer.is_error).toBe(true);
    expect(answer.content).toMatch(/no Goal/);
    expect(answer.content).toMatch(/help them choose/i);
  });

  it("makes a card that combines Standard, Goal and unwritten-rules Milestones", async () => {
    const { card } = await aProposedRoadmap();

    const kinds = new Set(card.milestones.map((milestone: any) => milestone.kind));
    expect(kinds).toEqual(new Set(["standard_date", "plan", "goal", "unwritten_rule"]));
  });

  it("has each Milestone belong to one Goal or be Standard", async () => {
    const { card, goal } = await aProposedRoadmap();

    for (const milestone of card.milestones) {
      if (milestone.kind === "plan" || milestone.kind === "goal") expect(milestone.goal).toEqual({ id: goal.id, text: goal.text });
      else expect(milestone.goal).toBeNull();
    }
  });

  it("shows the Standard Milestones with their real dates and Source", async () => {
    const { card } = await aProposedRoadmap();

    const withdraw = card.milestones.find((milestone: any) => milestone.name === WITHDRAW_16_WEEK.name);
    expect(withdraw).toMatchObject({ dueDate: "2026-12-07", when: "Monday, December 7, 2026" });
    expect(withdraw.sources[0].url).toBe(CALENDAR_PAGE);
  });

  it("gives a Standard Milestone that's only a different kind of course a miss", async () => {
    const { card } = await aProposedRoadmap();

    expect(card.milestones.map((milestone: any) => milestone.name)).not.toContain(WITHDRAW_7B.name);
  });

  it("turns only the Plan's terms still to come into dated Milestones with the Bulletin as their Source", async () => {
    const { card } = await aProposedRoadmap();

    const plan = card.milestones.filter((milestone: any) => milestone.kind === "plan");
    // In the second year's fall on November 2, 2026, so the first year has gone and two years and a term remain.
    expect(plan.map((milestone: any) => milestone.when)).toEqual([
      "By the end of Fall 2026",
      "By the end of Spring 2027",
      "By the end of Fall 2027",
      "By the end of Spring 2028",
      "By the end of Fall 2028",
      "By the end of Spring 2029",
    ]);
    expect(plan[0].name).toBe("Finish your Year 2 Fall courses");
    expect(plan[0].dueDate).toBe("2026-12-15");
    expect(plan[0].sources[0]).toMatchObject({ url: BIOLOGY_BS_PAGE });
    expect(plan[0].detail).toMatch(/\d+ credit hours/);
    expect(plan[0].detail).toMatch(/[A-Z]{2,5} \d{4}/);
    expect(plan[0].detail).not.toMatch(/\dor /);
  });

  describe("at other times of year", () => {
    const DAY = 24 * 3_600_000;

    async function planTermsOn(daysFromNow: number, year: number, yearFact: string): Promise<any[]> {
      const goal = await aGoal();
      await turn("I'm a Biology major.", [REMEMBER, { fact: MAJOR_FACT }], [REMEMBER, { fact: yearFact }]);
      const planId = await readBiologyPlan();
      backend.clock.moveForward(daysFromNow * DAY);
      const events = await turn("Roadmap please", [
        PROPOSE,
        proposal(planId, goal.id, { current_plan_year: year, year_fact: yearFact, goal_milestones: [] }),
      ]);
      return cardIn(events).milestones.filter((milestone: any) => milestone.kind === "plan");
    }

    it("takes a first-year Student in March to the rest of that spring", async () => {
      // March 1, 2027.
      const plan = await planTermsOn(119, 1, "In their first year at Temple.");

      expect(plan[0]).toMatchObject({ name: "Finish your Year 1 Spring courses", when: "By the end of Spring 2027", dueDate: "2027-05-15" });
    });

    it("takes the year a Student gives in the summer as the one they're about to start", async () => {
      // June 15, 2027.
      const plan = await planTermsOn(225, 1, "Starting their first year at Temple.");

      expect(plan[0]).toMatchObject({ name: "Finish your Year 1 Fall courses", when: "By the end of Fall 2027", dueDate: "2027-12-15" });
    });

    it("leaves out a term whose end has just passed", async () => {
      // December 20, 2026.
      const plan = await planTermsOn(48, 2, YEAR_FACT);

      expect(plan[0]).toMatchObject({ name: "Finish your Year 2 Spring courses", when: "By the end of Spring 2027" });
    });
  });

  it("includes going to office hours early and starting the internship search, saying they're Buddy's own advice", async () => {
    const { card } = await aProposedRoadmap();

    const rules = card.milestones.filter((milestone: any) => milestone.kind === "unwritten_rule");
    expect(rules.map((milestone: any) => milestone.name).join(" ")).toMatch(/office hours/i);
    expect(rules.map((milestone: any) => milestone.name).join(" ")).toMatch(/internship/i);
    for (const rule of rules) {
      expect(rule.sources).toEqual([]);
      expect(rule.sourceNote).toMatch(/not from a Temple page/);
    }
  });

  it("orders them by due date", async () => {
    const { card } = await aProposedRoadmap();

    const dates = card.milestones.map((milestone: any) => milestone.dueDate);
    expect(dates).toEqual(dates.toSorted());
  });

  it("changes nothing until the Student accepts", async () => {
    const { card } = await aProposedRoadmap();

    expect(card.status).toBe("waiting");
    expect(await calls.roadmap()).toEqual([]);
  });

  it("isn't a Permission: it makes no Action card", async () => {
    await aProposedRoadmap();

    expect((await backend.history()).filter((entry) => entry.type === "action_card")).toEqual([]);
    expect((await backend.activity()).filter((entry) => entry.kind.startsWith("action_"))).toEqual([]);
  });

  it("comes back with the conversation, as it stands now", async () => {
    const { card } = await aProposedRoadmap();
    await calls.accept(card.id);

    const entry = (await backend.history()).find((item) => item.type === "roadmap_card");

    expect(entry.card).toMatchObject({ id: card.id, status: "accepted" });
  });

  it("refuses to leave out a Goal, so that a quick reading can't skip one", async () => {
    const goal = await aGoal();
    const other = await aGoal("Graduate in four years");
    await aStudentWithMajorAndYear();
    const planId = await readBiologyPlan();

    const events = await turn("Roadmap please", [PROPOSE, proposal(planId, goal.id)]);

    expect(cardIn(events)).toBeUndefined();
    expect(answersIn().at(-1)!.content).toContain(other.text);
  });

  it("refuses a year that isn't in the Profile, so that Buddy asks", async () => {
    const goal = await aGoal();
    await aStudentWithMajorAndYear();
    const planId = await readBiologyPlan();

    const events = await turn("Roadmap please", [PROPOSE, proposal(planId, goal.id, { year_fact: "In their fourth year." })]);

    expect(cardIn(events)).toBeUndefined();
    expect(answersIn().at(-1)!.content).toMatch(/Ask the Student/);
  });

  it("refuses a Milestone for a Goal the Student doesn't have", async () => {
    const goal = await aGoal();
    await aStudentWithMajorAndYear();
    const planId = await readBiologyPlan();
    const wrong = proposal(planId, goal.id, {
      goal_milestones: [{ goal_id: 999, name: "Something", detail: null, due_date: "2027-06-01", guidebook_item_id: null }],
    });

    const events = await turn("Roadmap please", [PROPOSE, wrong]);

    expect(cardIn(events)).toBeUndefined();
    expect(answersIn().at(-1)!.is_error).toBe(true);
  });

  it("refuses a date that isn't real or has passed", async () => {
    const goal = await aGoal();
    await aStudentWithMajorAndYear();
    const planId = await readBiologyPlan();
    for (const due of ["2027-02-30", "2020-01-01", "next spring"]) {
      const wrong = proposal(planId, goal.id, {
        goal_milestones: [{ goal_id: goal.id, name: "Something", detail: null, due_date: due, guidebook_item_id: null }],
      });

      const events = await turn("Roadmap please", [PROPOSE, wrong]);

      expect(cardIn(events)).toBeUndefined();
    }
  });

  it("refuses a course that isn't in the Plan, because Claude's memory of Temple isn't a Source", async () => {
    const goal = await aGoal();
    await aStudentWithMajorAndYear();
    const planId = await readBiologyPlan();
    const wrong = proposal(planId, goal.id, {
      goal_milestones: [{ goal_id: goal.id, name: "Take ZZZZ 9999", detail: null, due_date: "2027-06-01", guidebook_item_id: null }],
    });

    const events = await turn("Roadmap please", [PROPOSE, wrong]);

    expect(cardIn(events)).toBeUndefined();
    expect(answersIn().at(-1)!.content).toContain("ZZZZ 9999");
  });

  it("doesn't take a year for a course", async () => {
    const goal = await aGoal();
    await aStudentWithMajorAndYear();
    const planId = await readBiologyPlan();
    const exam = proposal(planId, goal.id, {
      goal_milestones: [{ goal_id: goal.id, name: "Take the MCAT 2027", detail: null, due_date: "2027-06-01", guidebook_item_id: null }],
    });

    const events = await turn("Roadmap please", [PROPOSE, exam]);

    expect(cardIn(events)).toBeDefined();
  });

  it("can go without a Plan, and says so on the card", async () => {
    const goal = await aGoal();
    await turn("I haven't picked a major, but I'm in my second year.", [REMEMBER, { fact: YEAR_FACT }]);

    const events = await turn("Roadmap please", [PROPOSE, proposal(null, goal.id)]);

    const card = cardIn(events);
    expect(card.note).toMatch(/Suggested Academic Plan/);
    expect(card.milestones.some((milestone: any) => milestone.kind === "plan")).toBe(false);
  });

  it("says which plan it used and that it's a suggestion", async () => {
    const { card } = await aProposedRoadmap();

    expect(card.note).toContain("Bachelor of Science in Biology");
    expect(card.note).toMatch(/advisor/);
  });

  it("refuses a second first Roadmap, once there's one", async () => {
    const { card, goal } = await aProposedRoadmap();
    await calls.accept(card.id);

    const events = await turn("Another one please", [PROPOSE, proposal(null, goal.id)]);

    expect(cardIn(events)).toBeUndefined();
    expect(answersIn().at(-1)!.content).toContain(SUGGEST);
  });

  it("stops an earlier waiting card working when a new one comes", async () => {
    const { card, goal } = await aProposedRoadmap();

    const events = await turn("Try again", [PROPOSE, proposal(null, goal.id)]);

    expect(cardIn(events).status).toBe("waiting");
    expect(await (await calls.accept(card.id)).json()).toMatchObject({ card: { status: "replaced" } });
    expect(await calls.roadmap()).toEqual([]);
  });
});

describe("accepting a Roadmap", () => {
  it("takes one tap, and puts every Milestone on the Roadmap in order", async () => {
    const { card } = await aProposedRoadmap();

    const answer = await calls.accept(card.id);

    expect(answer.status).toBe(200);
    expect(((await answer.json()) as any).card.status).toBe("accepted");
    const milestones = await calls.roadmap();
    expect(milestones.map((milestone) => milestone.name)).toEqual(card.milestones.map((milestone: any) => milestone.name));
    expect(milestones.every((milestone) => milestone.done === false)).toBe(true);
  });

  it("does it only once, however many times it's tapped", async () => {
    const { card } = await aProposedRoadmap();

    await calls.accept(card.id);
    await calls.accept(card.id);

    expect(await calls.roadmap()).toHaveLength(card.milestones.length);
  });

  it("records it in Activity", async () => {
    const { card } = await aProposedRoadmap();

    await calls.accept(card.id);

    expect((await backend.activity())[0]).toMatchObject({ kind: "roadmap_accepted" });
  });

  it("does nothing if the Student taps Not now", async () => {
    const { card } = await aProposedRoadmap();

    const answer = (await (await calls.notNow(card.id)).json()) as any;

    expect(answer.card.status).toBe("not_now");
    expect(await calls.roadmap()).toEqual([]);
    expect(await (await calls.accept(card.id)).json()).toMatchObject({ card: { status: "not_now" } });
    expect(await calls.roadmap()).toEqual([]);
  });

  it("answers 404 for a card that doesn't exist", async () => {
    expect((await calls.accept(999)).status).toBe(404);
    expect((await calls.notNow(999)).status).toBe(404);
  });

  it("tells Claude how the card ended, so it doesn't say a change has been made when it hasn't", async () => {
    const { card } = await aProposedRoadmap();
    await calls.notNow(card.id);
    backend.claude.willReply({ chunks: ["Okay."] });

    await backend.sendAndCollect("Hi");

    expect(backend.claude.requests.at(-1)!.messages.at(-1)!.content).toMatch(/no Roadmap yet/);
  });
});

describe("editing a Roadmap", () => {
  async function accepted() {
    const { card, goal } = await aProposedRoadmap();
    await calls.accept(card.id);
    return { goal, milestones: await calls.roadmap() };
  }

  it("marks a Milestone done, and back", async () => {
    const { milestones } = await accepted();

    await calls.setDone(milestones[0].id, true);
    expect((await calls.roadmap())[0].done).toBe(true);

    await calls.setDone(milestones[0].id, false);
    expect((await calls.roadmap())[0].done).toBe(false);
  });

  it("removes a Milestone, which stays removed", async () => {
    const { milestones } = await accepted();

    expect((await calls.removeMilestone(milestones[0].id)).status).toBe(200);

    expect((await calls.roadmap()).map((milestone) => milestone.id)).not.toContain(milestones[0].id);
    expect((await calls.removeMilestone(milestones[0].id)).status).toBe(404);
  });

  it("reorders them, and keeps that order", async () => {
    const { milestones } = await accepted();
    const reversed = milestones.map((milestone) => milestone.id).toReversed();

    expect((await calls.reorder(reversed)).status).toBe(200);

    expect((await calls.roadmap()).map((milestone) => milestone.id)).toEqual(reversed);
  });

  it("refuses an order that leaves out a Milestone or names one it doesn't have, and changes nothing", async () => {
    const { milestones } = await accepted();
    const ids = milestones.map((milestone) => milestone.id);

    expect((await calls.reorder(ids.slice(1))).status).toBe(409);
    expect((await calls.reorder([...ids.slice(1), 999])).status).toBe(409);
    expect((await calls.reorder([ids[0], ...ids.slice(0, -1)])).status).toBe(409);

    expect((await calls.roadmap()).map((milestone) => milestone.id)).toEqual(ids);
  });

  it("adds a Milestone of the Student's own for a Goal, in date order", async () => {
    const { goal } = await accepted();

    const answer = await calls.addMilestone({ name: "Apply to the PA programs", dueDate: "2026-12-01", goalId: goal.id });

    expect(answer.status).toBe(200);
    const milestones = await calls.roadmap();
    const added = milestones.find((milestone) => milestone.name === "Apply to the PA programs");
    expect(added).toMatchObject({ kind: "added", goal: { id: goal.id }, dueDate: "2026-12-01", sources: [], sourceNote: "You added this." });
    const position = milestones.indexOf(added);
    expect(milestones[position + 1].dueDate >= "2026-12-01").toBe(true);
    expect(position === 0 || milestones[position - 1].dueDate <= "2026-12-01").toBe(true);
  });

  it("adds a Standard one when it's for no Goal", async () => {
    await accepted();

    await calls.addMilestone({ name: "Buy a winter coat", dueDate: "2026-12-01", goalId: null });

    expect((await calls.roadmap()).find((milestone) => milestone.name === "Buy a winter coat").goal).toBeNull();
  });

  it("refuses a Milestone with no name, a date that isn't real or a Goal that doesn't exist", async () => {
    await accepted();

    expect((await calls.addMilestone({ name: " ", dueDate: "2026-12-01", goalId: null })).status).toBe(400);
    expect((await calls.addMilestone({ name: "A", dueDate: "soon", goalId: null })).status).toBe(400);
    expect((await calls.addMilestone({ name: "A", dueDate: "2026-02-30", goalId: null })).status).toBe(400);
    expect((await calls.addMilestone({ name: "A", dueDate: "2026-12-01", goalId: 999 })).status).toBe(400);
  });

  it("hides a secret in a Milestone the Student adds", async () => {
    await accepted();

    await calls.addMilestone({ name: "My password is hunter2", dueDate: "2026-12-01", goalId: null });

    expect((await calls.roadmap()).some((milestone) => milestone.name.includes("hunter2"))).toBe(false);
  });

  it("removes a Goal's Milestones with it, because each Milestone belongs to one Goal or is Standard", async () => {
    const { goal } = await accepted();

    await calls.removeGoal(goal.id);

    const milestones = await calls.roadmap();
    expect(milestones.length).toBeGreaterThan(0);
    expect(milestones.every((milestone) => milestone.goal === null)).toBe(true);
  });

  it("tells Claude the truth about a Roadmap whose last Goal has gone", async () => {
    const { goal } = await accepted();
    await calls.removeGoal(goal.id);
    const left = await calls.roadmap();
    backend.claude.willReply({ chunks: ["Okay."] });

    await backend.sendAndCollect("Hi");

    const note = backend.claude.requests.at(-1)!.messages.at(-1)!.content as string;
    expect(note).toMatch(/no Goal right now/);
    expect(note).not.toMatch(/no Roadmap/);
    expect(note).toContain(left[0].name);
  });

  it("shows a new name for a Goal on its Milestones", async () => {
    const { goal } = await accepted();

    await calls.editGoal(goal.id, "Become a physician assistant");

    expect((await calls.roadmap()).find((milestone) => milestone.goal !== null).goal.text).toBe("Become a physician assistant");
  });

  it("refuses to change a Milestone that doesn't exist", async () => {
    expect((await calls.setDone(999, true)).status).toBe(404);
    expect((await calls.setDone("abc", true)).status).toBe(404);
  });
});

describe("the Add to Google Calendar link", () => {
  it("opens Google's own new-event page for that day, and Buddy creates nothing", async () => {
    const { card } = await aProposedRoadmap();
    await calls.accept(card.id);
    const requestsBefore = backend.web.requests.length;

    const withdraw = (await calls.roadmap()).find((milestone) => milestone.name === WITHDRAW_16_WEEK.name);

    const link = new URL(withdraw.calendarUrl);
    expect(link.origin + link.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(link.searchParams.get("action")).toBe("TEMPLATE");
    expect(link.searchParams.get("text")).toBe(WITHDRAW_16_WEEK.name);
    expect(link.searchParams.get("dates")).toBe("20261207/20261208");
    expect(link.searchParams.get("details")).toContain(CALENDAR_PAGE);
    expect(backend.web.requests.length).toBe(requestsBefore);
  });

  it("covers every day of a date range, and doesn't call a Temple date a target", async () => {
    const { card } = await aProposedRoadmap();

    const finals = card.milestones.find((milestone: any) => milestone.name === FINALS_FIRST_DAYS.name);

    const link = new URL(finals.calendarUrl);
    expect(link.searchParams.get("dates")).toBe("20261209/20261212");
    expect(link.searchParams.get("details")).not.toContain("target");
  });

  it("says a term's date is only Buddy's target", async () => {
    const { card } = await aProposedRoadmap();

    const term = card.milestones.find((milestone: any) => milestone.kind === "plan");

    expect(new URL(term.calendarUrl).searchParams.get("details")).toContain("target");
  });

  it("gets past the end of a month and a year", async () => {
    const { card } = await aProposedRoadmap();
    await calls.accept(card.id);

    const answer = (await (await calls.addMilestone({ name: "New year", dueDate: "2026-12-31", goalId: null })).json()) as any;

    expect(new URL(answer.milestones.find((m: any) => m.name === "New year").calendarUrl).searchParams.get("dates")).toBe("20261231/20270101");
  });
});

describe("what happens to a Standard Milestone later", () => {
  it("follows its page when Temple moves its date", async () => {
    const { card } = await aProposedRoadmap();
    await calls.accept(card.id);

    backend.clock.moveForward(24 * 3_600_000);
    backend.web.save(
      CALENDAR_PAGE,
      backend.web.saved.get(CALENDAR_PAGE)!.text.replace("Monday, December 7", "Monday, December 14"),
    );
    backend.claude.willReply(
      haikuFindsDates(WITHDRAW_7B, { ...WITHDRAW_16_WEEK, date: "2026-12-14", date_quote: "Monday, December 14" }, ADD_DROP_16_WEEK, FINALS_FIRST_DAYS, PRIORITY_REGISTRATION_FALL),
    );
    await backend.discovery.run();

    const withdraw = (await calls.roadmap()).find((milestone) => milestone.name === WITHDRAW_16_WEEK.name);
    expect(withdraw).toMatchObject({ dueDate: "2026-12-14", when: "Monday, December 14, 2026", goneFromSource: false });
  });
});

describe("changes Buddy suggests later", () => {
  async function accepted() {
    const { card, goal } = await aProposedRoadmap();
    await calls.accept(card.id);
    return { goal, milestones: await calls.roadmap() };
  }

  const change = (goalId: number, removeIds: number[] = []) => ({
    why: "Since you want to shadow sooner.",
    goal_milestones: [{ goal_id: goalId, name: "Email a PA about shadowing", detail: null, due_date: "2026-12-20", guidebook_item_id: null }],
    standard_milestone_ids: [],
    remove_milestone_ids: removeIds,
  });

  it("come as a card, and change nothing until the Student accepts", async () => {
    const { goal, milestones } = await accepted();

    const events = await turn("Can we add something?", [SUGGEST, change(goal.id, [milestones[0].id])]);

    const card = cardIn(events);
    expect(card).toMatchObject({ kind: "change", status: "waiting", why: "Since you want to shadow sooner." });
    expect(card.milestones).toMatchObject([{ name: "Email a PA about shadowing", goal: { id: goal.id } }]);
    expect(card.removes).toEqual([{ id: milestones[0].id, name: milestones[0].name }]);
    expect((await calls.roadmap()).map((milestone) => milestone.id)).toEqual(milestones.map((milestone) => milestone.id));
  });

  it("happen with one tap", async () => {
    const { goal, milestones } = await accepted();
    const card = cardIn(await turn("Change it", [SUGGEST, change(goal.id, [milestones[0].id])]));

    await calls.accept(card.id);

    const after = await calls.roadmap();
    expect(after.map((milestone) => milestone.id)).not.toContain(milestones[0].id);
    expect(after.some((milestone) => milestone.name === "Email a PA about shadowing")).toBe(true);
  });

  it("keep the Student's own order and go in by date", async () => {
    const { goal, milestones } = await accepted();
    const reversed = milestones.map((milestone) => milestone.id).toReversed();
    await calls.reorder(reversed);
    const card = cardIn(await turn("Change it", [SUGGEST, change(goal.id)]));

    await calls.accept(card.id);

    const after = (await calls.roadmap()).filter((milestone) => milestone.name !== "Email a PA about shadowing");
    expect(after.map((milestone) => milestone.id)).toEqual(reversed);
  });

  it("can add the Plan's terms to a Roadmap made before the Student chose a major", async () => {
    const goal = await aGoal();
    await turn("I haven't picked a major, but I'm in my second year.", [REMEMBER, { fact: YEAR_FACT }]);
    const first = cardIn(await turn("Roadmap please", [PROPOSE, proposal(null, goal.id)]));
    await calls.accept(first.id);
    await turn("I picked Biology.", [REMEMBER, { fact: MAJOR_FACT }]);
    const planId = await readBiologyPlan();

    const card = cardIn(
      await turn("Add my plan", [
        SUGGEST,
        { why: "You've chosen a major.", plan_id: planId, plan_option: 1, plan_goal_id: goal.id, current_plan_year: 2, year_fact: YEAR_FACT, goal_milestones: [], standard_milestone_ids: [], remove_milestone_ids: [] },
      ]),
    );

    expect(card.milestones.filter((milestone: any) => milestone.kind === "plan")).toHaveLength(6);
    expect(card.note).toContain("Bachelor of Science in Biology");
  });

  it("refuses the Plan's terms when the year isn't in the Profile", async () => {
    const { goal } = await accepted();
    const planId = (await readBiologyPlan());

    const events = await turn("Add my plan", [
      SUGGEST,
      { why: "Why not.", plan_id: planId, plan_option: 1, plan_goal_id: goal.id, current_plan_year: 3, year_fact: "In their third year.", goal_milestones: [], standard_milestone_ids: [], remove_milestone_ids: [] },
    ]);

    expect(cardIn(events)).toBeUndefined();
    expect(answersIn().at(-1)!.content).toMatch(/Ask the Student/);
  });

  it("skip a Milestone the Student has already removed", async () => {
    const { goal, milestones } = await accepted();
    const card = cardIn(await turn("Change it", [SUGGEST, change(goal.id, [milestones[0].id])]));
    await calls.removeMilestone(milestones[0].id);

    const answer = await calls.accept(card.id);

    expect(answer.status).toBe(200);
  });

  it("refuse a change with no Roadmap, or nothing in it", async () => {
    const goal = await aGoal();
    const noRoadmap = await turn("Change it", [SUGGEST, change(goal.id)]);
    expect(cardIn(noRoadmap)).toBeUndefined();
    expect(answersIn().at(-1)!.content).toContain(PROPOSE);

    await backend.stop();
    backend = await BackendHarness.start({ offices: [], milestoneOffices: TEST_MILESTONE_OFFICES });
    saveBulletinPages(backend.web);
    calls = roadmapCalls(backend);
    backend.claude.willReply(haikuFindsDates(WITHDRAW_16_WEEK), haikuFindsDates(FAFSA_PRIORITY));
    await backend.discovery.run();
    backend.claude.requests.length = 0;
    await accepted();
    const nothing = await turn("Change it", [SUGGEST, { why: "No reason.", goal_milestones: [], standard_milestone_ids: [], remove_milestone_ids: [] }]);
    expect(cardIn(nothing)).toBeUndefined();
  });

  it("refuse to remove a Milestone that isn't on the Roadmap", async () => {
    const { goal } = await accepted();

    const events = await turn("Change it", [SUGGEST, change(goal.id, [999])]);

    expect(cardIn(events)).toBeUndefined();
  });

  it("can add a Standard Milestone by its number", async () => {
    await accepted();
    const sevenWeek = (await backend.upcomingMilestones()).find((milestone) => milestone.name === WITHDRAW_7B.name);
    const card = cardIn(await turn("Change it", [SUGGEST, { why: "It matters.", goal_milestones: [], standard_milestone_ids: [sevenWeek.id], remove_milestone_ids: [] }]));

    expect(card.milestones).toMatchObject([{ kind: "standard_date", goal: null, name: sevenWeek.name }]);
  });

  it("won't add a Standard Milestone that's already there", async () => {
    await accepted();
    const onRoadmap = (await backend.upcomingMilestones()).find((milestone) => milestone.name === WITHDRAW_16_WEEK.name);

    const events = await turn("Change it", [SUGGEST, { why: "It matters.", goal_milestones: [], standard_milestone_ids: [onRoadmap.id], remove_milestone_ids: [] }]);

    expect(cardIn(events)).toBeUndefined();
  });

  it("go out of date when the Goal they're for is removed", async () => {
    const { goal } = await accepted();
    const card = cardIn(await turn("Change it", [SUGGEST, change(goal.id)]));

    await calls.removeGoal(goal.id);

    expect(await (await calls.accept(card.id)).json()).toMatchObject({ card: { status: "out_of_date" } });
    expect((await calls.roadmap()).some((milestone) => milestone.name === "Email a PA about shadowing")).toBe(false);
  });

  it("tell Claude what's on the Roadmap, with each turn", async () => {
    const { milestones } = await accepted();
    backend.claude.willReply({ chunks: ["Okay."] });

    await backend.sendAndCollect("Hi");

    const note = backend.claude.requests.at(-1)!.messages.at(-1)!.content as string;
    expect(note).toContain(`"id":${milestones[0].id}`);
    expect(note).toContain(milestones[0].name);
  });
});

describe("what Claude is given", () => {
  it("includes the Goal and Roadmap tools and what they're for", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hi");

    const request = backend.claude.requests.at(-1)!;
    const names = (request.tools as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([SAVE_GOAL, READ_PLAN, PROPOSE, SUGGEST]));
  });
});
