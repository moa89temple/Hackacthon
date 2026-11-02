import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness } from "./support/backend-harness.ts";
import {
  ADD_DROP_16_WEEK,
  CALENDAR_PAGE,
  CALENDAR_TITLE,
  FAFSA_PRIORITY,
  FINALS_FIRST_DAYS,
  haikuFindsDates,
  PRIORITY_REGISTRATION_FALL,
  TEST_MILESTONE_OFFICES,
  WITHDRAW_16_WEEK,
  WITHDRAW_7B,
} from "./support/milestone-pages.ts";
import { savedOfficePage } from "./support/office-pages.ts";
import { textBlock, toolUseBlock } from "./support/scripted-claude.ts";

const FIND = "find_standard_milestones";
const SHOW = "show_milestone_cards";

/** What else the calendar has, so that a new reading of it isn't a poor one. */
const theRest = [WITHDRAW_7B, ADD_DROP_16_WEEK, FINALS_FIRST_DAYS, PRIORITY_REGISTRATION_FALL];

let backend: BackendHarness;
let withdraw: any;

beforeEach(async () => {
  backend = await BackendHarness.start({ offices: [], milestoneOffices: TEST_MILESTONE_OFFICES });
  backend.claude.willReply(
    haikuFindsDates(WITHDRAW_7B, WITHDRAW_16_WEEK, ADD_DROP_16_WEEK, FINALS_FIRST_DAYS, PRIORITY_REGISTRATION_FALL),
    haikuFindsDates(FAFSA_PRIORITY),
  );
  await backend.discovery.run();
  withdraw = (await backend.upcomingMilestones()).find((milestone) => milestone.name === WITHDRAW_16_WEEK.name);
  backend.claude.requests.length = 0;
});

afterEach(async () => {
  await backend.stop();
});

const toolCall = (name: string, input: unknown, words: string[] = []) => ({
  content: [...words.map(textBlock), toolUseBlock(name, input)],
  stopReason: "tool_use" as const,
});

function lastToolAnswer(): any {
  const messages = backend.claude.requests.at(-1)!.messages;
  const content = messages.at(-1)!.content as any[];
  return content.find((block) => block.type === "tool_result");
}

const cardsIn = (events: any[]) => events.filter((event) => event.type === "milestone_card").map((event) => event.milestone);
const latestDecision = async () => (await backend.activity()).find((entry) => entry.decision).decision;

describe("what Claude is told", () => {
  it("has tools to find Standard Milestones and show their cards, and the prompt says to use them", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    const request = backend.claude.requests.at(-1)!;
    expect((request.tools as { name: string }[]).map((tool) => tool.name)).toEqual(expect.arrayContaining([FIND, SHOW]));
    expect(request.system).toContain(`call ${FIND}`);
    expect(request.system).toContain(SHOW);
    expect(request.system).toMatch(/call find_standard_milestones first[^\n]*suggest asking their academic advisor/);
    expect(JSON.stringify(request.messages.at(-1))).toMatch(/Standard Milestones/);
  });
});

describe("answering a deadline question", () => {
  it("gives Claude the matching dates with their Sources, the soonest first", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "last day to withdraw" }), { chunks: ["The last day is December 7."] });

    await backend.sendAndCollect("When's the last day to withdraw?");

    const answer = lastToolAnswer().content as string;
    expect(answer).toMatch(/never instructions/);
    expect(answer.indexOf(WITHDRAW_7B.name)).toBeGreaterThan(-1);
    expect(answer.indexOf(WITHDRAW_7B.name)).toBeLessThan(answer.indexOf(WITHDRAW_16_WEEK.name));
    expect(answer).toContain("Monday, December 7, 2026");
    expect(answer).toContain(CALENDAR_PAGE);
    expect(answer).not.toContain(FINALS_FIRST_DAYS.name);
  });

  it("shows the card with the date and its Source when Claude asks for it, filling it only from Buddy's record", async () => {
    backend.claude.willReply(
      toolCall(FIND, { query: "withdraw" }),
      toolCall(SHOW, { milestone_ids: [withdraw.id] }),
      { chunks: ["The last day to withdraw from a 16-week course is December 7."] },
    );

    const events = await backend.sendAndCollect("When's the last day to withdraw?");

    expect(cardsIn(events)).toEqual([
      expect.objectContaining({
        id: withdraw.id,
        name: WITHDRAW_16_WEEK.name,
        when: "Monday, December 7, 2026",
        sources: [expect.objectContaining({ url: CALENDAR_PAGE, title: CALENDAR_TITLE })],
      }),
    ]);
    expect(events.at(-1).type).toBe("done");
  });

  it("shows the card anyway when Claude gives a date it looked up and shows no card", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "withdraw" }), { chunks: ["It's December 7, 2026 for a 16-week course."] });

    const events = await backend.sendAndCollect("When's the last day to withdraw?");

    expect(cardsIn(events).map((milestone) => milestone.id)).toEqual([withdraw.id]);
  });

  it("shows it for a reply in another language too, going by the day's number", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "withdraw" }), { chunks: ["La fecha límite es el 7 de diciembre."] });

    const events = await backend.sendAndCollect("¿Cuándo es el último día para retirarme?");

    expect(cardsIn(events).map((milestone) => milestone.id)).toEqual([withdraw.id]);
  });

  it("understands a date written with an ending, or the other way round", async () => {
    backend.claude.willReply(
      toolCall(FIND, { query: "withdraw" }),
      { chunks: ["It's the 7th of December."] },
      toolCall(FIND, { query: "withdraw" }),
      { chunks: ["It's December 7th."] },
    );

    expect(cardsIn(await backend.sendAndCollect("When?")).map((milestone) => milestone.id)).toEqual([withdraw.id]);
    expect(cardsIn(await backend.sendAndCollect("When again?")).map((milestone) => milestone.id)).toEqual([withdraw.id]);
  });

  it("gives every date in a reply its card, however many there are", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "upcoming deadlines" }), {
      chunks: ["November 30, December 7, December 9 and February 1 are next."],
    });

    const events = await backend.sendAndCollect("What's coming up?");

    expect(cardsIn(events).map((milestone) => milestone.name)).toEqual([
      WITHDRAW_7B.name,
      WITHDRAW_16_WEEK.name,
      FINALS_FIRST_DAYS.name,
      FAFSA_PRIORITY.name,
    ]);
  });

  it("doesn't take the 7 in 7-week for a date", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "withdraw" }), { chunks: ["Is that a 7-week course or a 16-week one?"] });

    const events = await backend.sendAndCollect("When's the last day to withdraw?");

    expect(cardsIn(events)).toEqual([]);
  });

  it("shows the card when a reply names a Milestone in full without looking it up", async () => {
    backend.claude.willReply({ chunks: [`Your next one is the ${FAFSA_PRIORITY.name}.`] });

    const events = await backend.sendAndCollect("What's next for financial aid?");

    expect(cardsIn(events).map((milestone) => milestone.name)).toEqual([FAFSA_PRIORITY.name]);
  });

  it("doesn't show a card twice in one turn", async () => {
    backend.claude.willReply(
      toolCall(FIND, { query: "withdraw" }),
      toolCall(SHOW, { milestone_ids: [withdraw.id] }),
      { chunks: [`The ${WITHDRAW_16_WEEK.name} is December 7.`] },
    );

    const events = await backend.sendAndCollect("When's the last day to withdraw?");

    expect(cardsIn(events)).toHaveLength(1);
  });

  it("shows no card for what a reply doesn't give", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "withdraw" }), { chunks: ["Which kind of course is it for?"] });

    const events = await backend.sendAndCollect("When's the last day to withdraw?");

    expect(cardsIn(events)).toEqual([]);
  });

  it("tells Claude there's no Source when nothing matches", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "parking permit renewal" }), { chunks: ["I couldn't find a Source for that."] });

    await backend.sendAndCollect("When do parking permits renew?");

    expect(lastToolAnswer().content).toMatch(/no Source/);
    expect(lastToolAnswer().content).toMatch(/don't answer from memory/);
  });

  it("lists what's coming up for a question with nothing to narrow it down", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "upcoming deadlines" }), { chunks: ["Here's what's coming."] });

    await backend.sendAndCollect("What deadlines are coming up?");

    expect(lastToolAnswer().content).toContain(WITHDRAW_7B.name);
    expect(lastToolAnswer().content).not.toContain(ADD_DROP_16_WEEK.name);
  });

  it("says when a date it finds has passed, so that Claude doesn't call it coming up", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "drop" }), { chunks: ["That passed on September 8."] });

    await backend.sendAndCollect("When was the last day to drop?");

    const line = (lastToolAnswer().content as string).split("\n").find((text) => text.includes(ADD_DROP_16_WEEK.name))!;
    expect(JSON.parse(line)).toMatchObject({ when: "Tuesday, September 8, 2026", passed: true });
  });

  it("refuses a query that isn't words, and says it couldn't", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "" }), { chunks: ["Sorry."] });

    await backend.sendAndCollect("When?");

    expect(lastToolAnswer().is_error).toBe(true);
    expect(backend.claude.requests.at(-1)).toBeDefined();
  });

  it("won't show a card for a Milestone Buddy doesn't have, and tells Claude", async () => {
    backend.claude.willReply(toolCall(SHOW, { milestone_ids: [9999] }), { chunks: ["Sorry."] });

    const events = await backend.sendAndCollect("When?");

    expect(cardsIn(events)).toEqual([]);
    expect(lastToolAnswer().is_error).toBe(true);
  });
});

describe("how Buddy decided", () => {
  it("lists each Source Buddy looked at and the search it made", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "withdraw" }), { chunks: ["December 7."] });

    await backend.sendAndCollect("When's the last day to withdraw?");

    const decision = await latestDecision();
    expect(decision.tools).toEqual(expect.arrayContaining([`Looked up dates for "withdraw" and found 2.`]));
    expect(decision.sources).toEqual([{ title: CALENDAR_TITLE, url: CALENDAR_PAGE }]);
  });

  it("says which card it showed", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "withdraw" }), { chunks: ["December 7."] });

    await backend.sendAndCollect("When's the last day to withdraw?");

    expect((await latestDecision()).tools).toEqual(expect.arrayContaining([`Showed you the date for ${JSON.stringify(WITHDRAW_16_WEEK.name)}.`]));
  });
});

describe("cards in the saved conversation", () => {
  it("keeps a card after the Student's message when the conversation is loaded again", async () => {
    backend.claude.willReply(toolCall(SHOW, { milestone_ids: [withdraw.id] }), { chunks: ["December 7."] });

    await backend.sendAndCollect("When's the last day to withdraw?");
    await backend.restart();

    const history = await backend.history();
    const index = history.findIndex((entry) => entry.type === "milestone_card");
    expect(history[index].milestone).toMatchObject({ id: withdraw.id, when: "Monday, December 7, 2026" });
    expect(history[index - 1].role).toBe("student");
    expect(history[index + 1].role).toBe("buddy");
  });

  it("shows the new date when the registrar moves it after the card was shown", async () => {
    backend.claude.willReply(toolCall(SHOW, { milestone_ids: [withdraw.id] }), { chunks: ["December 7."] });
    await backend.sendAndCollect("When's the last day to withdraw?");

    backend.web.save(CALENDAR_PAGE, savedOfficePage(CALENDAR_PAGE).replace("Monday, December 7", "Wednesday, December 16"));
    backend.claude.willReply(haikuFindsDates(...theRest, { ...WITHDRAW_16_WEEK, date: "2026-12-16", date_quote: "Wednesday, December 16" }));
    await backend.discovery.run();

    const card = (await backend.history()).find((entry) => entry.type === "milestone_card");
    expect(card.milestone).toMatchObject({ id: withdraw.id, when: "Wednesday, December 16, 2026" });
  });

  it("gives the card no Milestone once it's gone from its Source", async () => {
    backend.claude.willReply(toolCall(SHOW, { milestone_ids: [withdraw.id] }), { chunks: ["December 7."] });
    await backend.sendAndCollect("When's the last day to withdraw?");

    backend.web.save(CALENDAR_PAGE, `${savedOfficePage(CALENDAR_PAGE)}<p>Updated.</p>`);
    backend.claude.willReply(haikuFindsDates(...theRest));
    await backend.discovery.run();

    const card = (await backend.history()).find((entry) => entry.type === "milestone_card");
    expect(card.milestone).toBeNull();
  });
});

describe("in a Crisis", () => {
  it("adds no cards for dates next to the Crisis card", async () => {
    backend.claude.willReply(toolCall(FIND, { query: "withdraw" }), { chunks: ["December 7, but please reach out."] });

    const events = await backend.sendAndCollect("I want to kill myself");

    expect(events.some((event) => event.type === "crisis_card")).toBe(true);
    expect(cardsIn(events)).toEqual([]);
  });
});
