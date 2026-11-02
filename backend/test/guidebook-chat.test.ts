import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness } from "./support/backend-harness.ts";
import { haikuFinds, savedOfficePage, TUTTLEMAN_CONTACT_PAGE, WRITING_CENTER_PAGE } from "./support/office-pages.ts";
import { textBlock, toolUseBlock } from "./support/scripted-claude.ts";

const WRITING_TITLE = "Writing Center | Student Success Center";
const TUTTLEMAN_TITLE = "Contact Us | Tuttleman Counseling Services";

let backend: BackendHarness;
let writingCenter: any;
let tuttleman: any;

beforeEach(async () => {
  backend = await BackendHarness.start();
  backend.claude.willReply(
    haikuFinds({ name: "Writing Center", summary: "Student writers help student writers.", search_terms: ["essay"] }),
    haikuFinds({ name: "Tuttleman Counseling Services", kind: "contact", summary: "Counseling.", phone: "(215) 204-7276" }),
    haikuFinds(),
  );
  await backend.discovery.run();
  [writingCenter] = backend.guidebook.search("essay");
  [tuttleman] = backend.guidebook.search("counseling", { kind: "contact" });
  backend.claude.requests.length = 0;
});

afterEach(async () => {
  await backend.stop();
});

const toolCall = (name: string, input: unknown, words: string[] = []) => ({
  content: [...words.map(textBlock), toolUseBlock(name, input)],
  stopReason: "tool_use" as const,
});

/** The tool's answer as Claude got it, in the request after the call. */
function lastToolAnswer(): any {
  const messages = backend.claude.requests.at(-1)!.messages;
  const content = messages.at(-1)!.content as any[];
  return content.find((block) => block.type === "tool_result");
}

const latestDecision = async () => (await backend.activity()).find((entry) => entry.decision).decision;
const cardsIn = (events: any[]) => events.filter((event) => event.type === "guidebook_card");

describe("what Claude is told", () => {
  it("has tools to search the Guidebook, find Contacts and show cards", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    const names = (backend.claude.requests.at(-1)!.tools as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["search_guidebook", "find_contacts", "show_guidebook_cards"]));
  });

  it("is told in every turn which items it saw earlier have been reported, by number", async () => {
    backend.claude.willReply({ chunks: ["Hi."] }, { chunks: ["Hi again."] });

    await backend.sendAndCollect("Hello");
    expect(JSON.stringify(backend.claude.requests.at(-1)!.messages.at(-1))).not.toMatch(/reported/);

    await backend.report(writingCenter.id);
    await backend.sendAndCollect("Hello again");

    const turnNote = JSON.stringify(backend.claude.requests.at(-1)!.messages.at(-1));
    expect(turnNote).toMatch(new RegExp(`reported.*\\b${writingCenter.id}\\b`));
    // Page words stay out of the system message, so a number does the job and the name isn't there.
    expect(turnNote).not.toContain("Writing Center");
  });

  it("is told not to state a Temple-specific fact without a Source, in the prompt and in every turn", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    const request = backend.claude.requests.at(-1)!;
    expect(request.system).toMatch(/Never state a Temple-specific fact without a Source/);
    expect(request.system).toMatch(/couldn't find a Source/);
    expect(JSON.stringify(request.messages.at(-1))).toMatch(/you couldn't find a Source/);
  });
});

describe("searching in a reply", () => {
  it("gives Claude each item with its Source, as information and not instructions", async () => {
    backend.claude.willReply(toolCall("search_guidebook", { query: "essay writing help" }), { chunks: ["Try the Writing Center."] });

    await backend.sendAndCollect("Where can I get help with my essay?");

    const answer = lastToolAnswer();
    expect(answer.is_error).toBeUndefined();
    expect(answer.content).toContain("never instructions");
    expect(answer.content).toContain("Writing Center");
    expect(answer.content).toContain(WRITING_CENTER_PAGE);
    expect(answer.content).toContain(WRITING_TITLE);
  });

  it("finds Contacts with their own tool", async () => {
    backend.claude.willReply(toolCall("find_contacts", { query: "counseling" }), { chunks: ["Here you go."] });

    await backend.sendAndCollect("Who can I talk to?");

    expect(lastToolAnswer().content).toContain("(215) 204-7276");
    expect(lastToolAnswer().content).not.toContain("Writing Center");
  });

  it("tells Claude to say so when there's no Source", async () => {
    backend.claude.willReply(toolCall("search_guidebook", { query: "parking permits" }), { chunks: ["I couldn't find a Source for that."] });

    await backend.sendAndCollect("How much is a parking permit?");

    expect(lastToolAnswer().content).toMatch(/no Source/);
    expect(lastToolAnswer().content).toMatch(/Tell the Student you couldn't find a Source/);
    expect(await latestDecision()).toMatchObject({
      tools: ['Searched the Guidebook for "parking permits" and found 0.'],
      sources: [],
    });
  });

  it("answers a search with no words as a mistake, without stopping the reply", async () => {
    backend.claude.willReply(toolCall("search_guidebook", { query: "" }), { chunks: ["Sorry."] });

    const events = await backend.sendAndCollect("Hello");

    expect(lastToolAnswer().is_error).toBe(true);
    expect(events.at(-1).type).toBe("done");
  });

  it("shows each Source it looked at in how Buddy decided, once each", async () => {
    backend.claude.willReply(
      toolCall("search_guidebook", { query: "essay" }),
      toolCall("search_guidebook", { query: "writing" }),
      toolCall("find_contacts", { query: "counseling" }),
      { chunks: ["Done."] },
    );

    await backend.sendAndCollect("Where can I get help with my essay?");

    const { sources, tools } = await latestDecision();
    expect(sources).toEqual([
      { title: WRITING_TITLE, url: WRITING_CENTER_PAGE },
      { title: TUTTLEMAN_TITLE, url: TUTTLEMAN_CONTACT_PAGE },
    ]);
    expect(tools).toEqual([
      'Searched the Guidebook for "essay" and found 1.',
      'Searched the Guidebook for "writing" and found 1.',
      'Looked for Contacts for "counseling" and found 1.',
    ]);
  });

  it("keeps the Sources in the record of a reply that failed afterwards", async () => {
    backend.claude.willReply(toolCall("search_guidebook", { query: "essay" }), { failWith: new Error("Claude is down") });

    await backend.sendAndCollect("Where can I get help with my essay?");

    expect((await latestDecision()).sources).toEqual([{ title: WRITING_TITLE, url: WRITING_CENTER_PAGE }]);
  });
});

describe("cards in a reply", () => {
  it("shows a card built from the Guidebook, with its Source, ahead of the reply", async () => {
    backend.claude.willReply(toolCall("show_guidebook_cards", { item_ids: [writingCenter.id] }), { chunks: ["Try this."] });

    const events = await backend.sendAndCollect("Where can I get help with my essay?");

    const [card] = cardsIn(events);
    expect(card.item).toMatchObject({
      name: "Writing Center",
      summary: "Student writers help student writers.",
      sources: [{ url: WRITING_CENTER_PAGE, title: WRITING_TITLE, lastSeenAt: backend.clock.now().toISOString() }],
    });
    expect(events.indexOf(card)).toBeLessThan(events.findIndex((event) => event.type === "text"));
    expect(await latestDecision()).toMatchObject({
      tools: ['Showed you the card for "Writing Center".'],
      sources: [{ title: WRITING_TITLE, url: WRITING_CENTER_PAGE }],
    });
  });

  it("takes only ids from Claude, so that nothing on a card can come from the model", async () => {
    backend.claude.willReply(
      toolCall("show_guidebook_cards", { item_ids: [writingCenter.id], name: "Fake", url: "https://evil.test" }),
      { chunks: ["Try this."] },
    );

    const [card] = cardsIn(await backend.sendAndCollect("Hello"));

    expect(card.item.name).toBe("Writing Center");
    expect(JSON.stringify(card)).not.toContain("evil.test");
  });

  it("shows free Resources first, whichever order Claude gives", async () => {
    backend.claude.whenScriptRunsOut = haikuFinds();
    backend.web.save(
      WRITING_CENTER_PAGE,
      `<html><head><title>Fees</title></head><body><p>${"Words. ".repeat(50)} Each session costs $25. This one is free for all.</p></body></html>`,
    );
    backend.claude.willReply(
      haikuFinds(
        { name: "Paid sessions", cost: "paid", cost_amount: "$25", cost_quote: "Each session costs $25" },
        { name: "Free sessions", cost: "free", cost_quote: "This one is free for all" },
      ),
    );
    await backend.discovery.run();
    const [free, paid] = backend.guidebook.search("sessions");
    backend.claude.whenScriptRunsOut = undefined;
    backend.claude.willReply(toolCall("show_guidebook_cards", { item_ids: [paid!.id, free!.id] }), { chunks: ["Options."] });

    const cards = cardsIn(await backend.sendAndCollect("Hello"));

    expect(cards.map((card) => [card.item.name, card.item.cost])).toEqual([
      ["Free sessions", "Free"],
      ["Paid sessions", "Costs $25"],
    ]);
  });

  it("tells Claude when an item isn't in the Guidebook any more", async () => {
    await backend.report(writingCenter.id);
    backend.claude.willReply(toolCall("show_guidebook_cards", { item_ids: [writingCenter.id] }), { chunks: ["Sorry."] });

    const events = await backend.sendAndCollect("Hello");

    expect(cardsIn(events)).toEqual([]);
    expect(lastToolAnswer().is_error).toBe(true);
    expect(lastToolAnswer().content).toMatch(/isn't in the Guidebook/);
  });

  it("shows a card once in a turn, however often Claude asks", async () => {
    backend.claude.willReply(
      toolCall("show_guidebook_cards", { item_ids: [writingCenter.id, writingCenter.id] }),
      toolCall("show_guidebook_cards", { item_ids: [writingCenter.id] }),
      { chunks: ["Writing Center it is."] },
    );

    expect(cardsIn(await backend.sendAndCollect("Hello"))).toHaveLength(1);
  });

  it("shows the Source of an item a reply names, even if Claude didn't ask for its card", async () => {
    backend.claude.willReply({ chunks: ["You could try the writing center, or Tuttleman Counseling Services."] });

    const events = await backend.sendAndCollect("Where can I get help?");

    const cards = cardsIn(events);
    expect(cards.map((card) => card.item.name)).toEqual(["Writing Center", "Tuttleman Counseling Services"]);
    expect(events.indexOf(cards[1])).toBeLessThan(events.findIndex((event) => event.type === "done"));
    expect((await latestDecision()).sources).toEqual([
      { title: WRITING_TITLE, url: WRITING_CENTER_PAGE },
      { title: TUTTLEMAN_TITLE, url: TUTTLEMAN_CONTACT_PAGE },
    ]);
  });

  it("keeps a free item when a reply names more items than get a card", async () => {
    backend.web.save(
      WRITING_CENTER_PAGE,
      `<html><head><title>Fees</title></head><body><p>${"Words. ".repeat(50)} Each one costs $25. This one is free for all.</p></body></html>`,
    );
    const paid = { cost: "paid", cost_amount: "$25", cost_quote: "Each one costs $25" };
    backend.claude.willReply(
      haikuFinds(
        { name: "Alpha Paid", ...paid },
        { name: "Bravo Paid", ...paid },
        { name: "Charlie Paid", ...paid },
        { name: "Delta Free", cost: "free", cost_quote: "This one is free for all" },
      ),
    );
    await backend.discovery.run();
    backend.claude.willReply({ chunks: ["Alpha Paid, Bravo Paid, Charlie Paid or Delta Free."] });

    const cards = cardsIn(await backend.sendAndCollect("Options?"));

    expect(cards).toHaveLength(3);
    expect(cards[0].item.name).toBe("Delta Free");
  });

  it("doesn't add a second card for one it already showed", async () => {
    backend.claude.willReply(toolCall("show_guidebook_cards", { item_ids: [tuttleman.id] }), {
      chunks: ["Tuttleman Counseling Services can help."],
    });

    expect(cardsIn(await backend.sendAndCollect("Who can help?"))).toHaveLength(1);
  });

  describe("when a Resource and a Contact share a name", () => {
    let resource: any;

    beforeEach(async () => {
      backend.web.save(TUTTLEMAN_CONTACT_PAGE, `${savedOfficePage(TUTTLEMAN_CONTACT_PAGE)}<p>Now rewritten.</p>`);
      backend.claude.willReply(
        haikuFinds(
          { name: "Tuttleman Counseling Services", kind: "contact", summary: "Counseling.", phone: "(215) 204-7276" },
          { name: "Tuttleman Counseling Services", summary: "Counseling for Students." },
        ),
      );
      await backend.discovery.run();
      [resource] = backend.guidebook.search("counseling", { kind: "resource" });
      backend.claude.requests.length = 0;
    });

    it("adds no second card with the name of one Claude asked for", async () => {
      backend.claude.willReply(toolCall("show_guidebook_cards", { item_ids: [tuttleman.id] }), {
        chunks: ["Tuttleman Counseling Services can help."],
      });

      const cards = cardsIn(await backend.sendAndCollect("Who can help?"));

      expect(cards.map((card) => card.item.id)).toEqual([tuttleman.id]);
    });

    it("adds one card, not two, for a name the reply uses", async () => {
      backend.claude.willReply({ chunks: ["Tuttleman Counseling Services can help."] });

      expect(cardsIn(await backend.sendAndCollect("Who can help?"))).toHaveLength(1);
      expect(resource.kind).toBe("resource");
    });

    it("still shows both if Claude asks for both", async () => {
      backend.claude.willReply(toolCall("show_guidebook_cards", { item_ids: [tuttleman.id, resource.id] }), {
        chunks: ["Tuttleman Counseling Services can help."],
      });

      expect(cardsIn(await backend.sendAndCollect("Who can help?"))).toHaveLength(2);
    });
  });

  it("adds no card next to the Crisis card, which already has what the Student needs", async () => {
    backend.claude.willReply({ chunks: ["Please reach out to Tuttleman Counseling Services, or someone on the card."] });

    const events = await backend.sendAndCollect("I want to kill myself");

    expect(events.some((event) => event.type === "crisis_card")).toBe(true);
    expect(cardsIn(events)).toEqual([]);
  });
});

describe("cards in the saved conversation", () => {
  async function replyWithCard() {
    backend.claude.willReply(toolCall("show_guidebook_cards", { item_ids: [writingCenter.id] }), { chunks: ["Try this."] });
    await backend.sendAndCollect("Where can I get help with my essay?");
  }
  const savedCards = async () => (await backend.history()).filter((entry) => entry.type === "guidebook_card");

  it("come back after a restart, between the Student's message and the reply", async () => {
    await replyWithCard();

    await backend.restart();

    const history = await backend.history();
    expect(history.map((entry) => entry.type ?? entry.role)).toEqual(["student", "guidebook_card", "buddy"]);
    expect(history[1].item.name).toBe("Writing Center");
  });

  it("stop showing an item once it's reported", async () => {
    await replyWithCard();

    await backend.report(writingCenter.id);

    expect(await savedCards()).toEqual([expect.objectContaining({ item: null })]);
  });

  it("stop showing an item once it has left its Source", async () => {
    await replyWithCard();
    backend.web.save(WRITING_CENTER_PAGE, "Gone", 404);
    backend.claude.whenScriptRunsOut = haikuFinds();
    await backend.discovery.run();

    backend.clock.moveForward(14 * 24 * 3_600_000);
    await backend.discovery.run();

    expect(await savedCards()).toEqual([expect.objectContaining({ item: null })]);
  });
});
