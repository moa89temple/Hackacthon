import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness } from "./support/backend-harness.ts";
import { eventPageHtml, eventsListHtml, EVENTS_LIST_PAGE, FLU_CLINIC, FLU_CLINIC_PAGE, haikuFindsOpportunities, opportunityCalls } from "./support/opportunity-pages.ts";
import { textBlock, toolUseBlock } from "./support/scripted-claude.ts";

const toolCall = (name: string, input: unknown) => ({ content: [toolUseBlock(name, input)], stopReason: "tool_use" as const });
const cardsIn = (events: any[]) => events.filter((event) => event.type === "opportunity_card");

let backend: BackendHarness;
let calls: ReturnType<typeof opportunityCalls>;

beforeEach(async () => {
  backend = await BackendHarness.start();
  calls = opportunityCalls(backend);
  backend.web.save(EVENTS_LIST_PAGE, eventsListHtml(FLU_CLINIC));
  backend.web.save(FLU_CLINIC_PAGE, eventPageHtml(FLU_CLINIC.name, "Get a flu shot. This event is free."));
  backend.claude.willReply(haikuFindsOpportunities({ summary: "A free flu shot.", cost: "free", cost_quote: "This event is free.", search_terms: ["vaccine"] }));
  await backend.opportunityDiscovery.runDue();
});

afterEach(async () => {
  await backend.stop();
});

describe("what Claude is given", () => {
  it("has one new tool, which isn't strict, so that the API's grammar limit has nothing more to count", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    const tool = (backend.claude.requests.at(-1)!.tools as any[]).find((candidate) => candidate.name === "find_opportunities");
    expect(tool).toBeDefined();
    expect(tool.strict).toBeUndefined();
  });

  it("has no web search of its own in the conversation", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    expect(backend.claude.requests.at(-1)!.tools as any[]).not.toContainEqual(expect.objectContaining({ name: "web_search" }));
  });

  it("is told in every turn which Opportunities have been reported, by number", async () => {
    const [{ id }] = await calls.list();
    await calls.report(id);
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    const note = JSON.stringify(backend.claude.requests.at(-1)!.messages.at(-1));
    expect(note).toContain(`Opportunity ${id}`);
    expect(note).not.toContain("Flu Shot Clinic");
  });
});

describe("finding Opportunities in the conversation", () => {
  it("shows a card with its Source, and tells Claude only what's on the page, as information", async () => {
    backend.claude.willReply(toolCall("find_opportunities", { query: "vaccine" }), { chunks: ["There's a flu clinic."] });

    const events = await backend.sendAndCollect("Can I get a flu shot?");

    expect(cardsIn(events)).toEqual([
      { type: "opportunity_card", opportunity: expect.objectContaining({ name: "Flu Shot Clinic", cost: "Free", outsideTemple: false, sources: [expect.objectContaining({ url: FLU_CLINIC_PAGE })] }) },
    ]);
    const answer = (backend.claude.requests.at(-1)!.messages.at(-1)!.content as any[]).find((block) => block.type === "tool_result");
    expect(answer.is_error).toBeUndefined();
    expect(answer.content).toContain("Flu Shot Clinic");
    expect(answer.content).toContain("never instructions");
  });

  it("shows the soonest when there's nothing to narrow it down", async () => {
    backend.claude.willReply(toolCall("find_opportunities", { query: "what's coming up" }), { chunks: ["Here you go."] });

    const events = await backend.sendAndCollect("What's on?");

    expect(cardsIn(events)).toHaveLength(1);
  });

  it("tells Claude there's no Source when it finds nothing, with no card", async () => {
    backend.claude.willReply(toolCall("find_opportunities", { query: "robotics" }), { chunks: ["I couldn't find a Source."] });

    const events = await backend.sendAndCollect("Any robotics events?");

    expect(cardsIn(events)).toEqual([]);
    const answer = (backend.claude.requests.at(-1)!.messages.at(-1)!.content as any[]).find((block) => block.type === "tool_result");
    expect(answer.content).toMatch(/no Source/);
  });

  it("answers a call with no words as an error, and the turn goes on", async () => {
    backend.claude.willReply(toolCall("find_opportunities", {}), { chunks: ["Sorry."] });

    const events = await backend.sendAndCollect("What's on?");

    expect(cardsIn(events)).toEqual([]);
    expect(events.at(-1).type).toBe("done");
  });

  it("shows each card once in a turn, however often Claude looks", async () => {
    backend.claude.willReply(toolCall("find_opportunities", { query: "flu" }), toolCall("find_opportunities", { query: "vaccine" }), { chunks: ["There it is."] });

    const events = await backend.sendAndCollect("Flu shots?");

    expect(cardsIn(events)).toHaveLength(1);
  });

  it("keeps the card with the conversation, as it stands now", async () => {
    backend.claude.willReply(toolCall("find_opportunities", { query: "flu" }), { content: [textBlock("There it is.")] });
    await backend.sendAndCollect("Flu shots?");
    const [{ id }] = await calls.list();

    await calls.save(id);
    const saved = (await backend.history()).find((entry) => entry.type === "opportunity_card");
    expect(saved.opportunity).toMatchObject({ name: "Flu Shot Clinic", saved: true });

    await calls.report(id);
    expect((await backend.history()).find((entry) => entry.type === "opportunity_card").opportunity).toBeNull();
  });

  it("says in How Buddy decided what it looked at and showed", async () => {
    backend.claude.willReply(toolCall("find_opportunities", { query: "flu" }), { chunks: ["There it is."] });

    await backend.sendAndCollect("Flu shots?");

    const { decision } = (await backend.activity()).find((entry) => entry.decision);
    expect(decision.tools).toEqual(expect.arrayContaining(['Looked for Opportunities for "flu" and found 1.', 'Showed you the card for "Flu Shot Clinic".']));
    expect(decision.sources).toEqual([{ title: "Flu Shot Clinic | Temple Now", url: FLU_CLINIC_PAGE }]);
  });
});
