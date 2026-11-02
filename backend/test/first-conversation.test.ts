import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness } from "./support/backend-harness.ts";

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
});

afterEach(async () => {
  await backend.stop();
});

describe("the opening", () => {
  it("is a two-sentence introduction, then a question about the Student's Goals", async () => {
    const [introduction, goals, ...rest] = (await backend.opening()).split("\n\n");

    expect(rest).toEqual([]);
    expect(introduction!.match(/[.!?](\s|$)/g)).toHaveLength(2);
    expect(introduction).toMatch(/AI assistant/);
    expect(introduction).toMatch(/won't/);
    expect(introduction).toMatch(/without your tap/);
    expect(goals).toMatch(/What are you hoping to achieve at Temple\?/);
  });

  it("says why Buddy is asking about Goals, and that the Student can skip it", async () => {
    const goals = (await backend.opening()).split("\n\n")[1];

    expect(goals).toMatch(/helps me/);
    expect(goals).toMatch(/skip/);
  });

  it("comes from Buddy's own words, so it costs nothing and can't fail", async () => {
    await backend.opening();

    expect(backend.claude.requests).toEqual([]);
    expect(await backend.history()).toEqual([]);
  });

  it("is still there once the conversation has started, at the same place", async () => {
    const before = await backend.opening();
    backend.claude.willReply({ chunks: ["Nice."] });

    await backend.sendAndCollect("I want to get into PA school");

    expect(await backend.opening()).toBe(before);
    expect((await backend.history())[0]).toMatchObject({ text: "I want to get into PA school" });
  });

  it("is in Claude's system prompt rather than the history, because a history must start with the Student", async () => {
    const opening = await backend.opening();
    backend.claude.willReply({ chunks: ["Nice."] });

    await backend.sendAndCollect("I want to get into PA school");

    const request = backend.claude.requests[0]!;
    expect(request.system).toContain(opening);
    expect(request.messages[0]).toMatchObject({ role: "user" });
  });
});

describe("what the system prompt asks of Buddy", () => {
  async function systemPrompt(): Promise<string> {
    backend.claude.willReply({ chunks: ["Hi."] });
    await backend.sendAndCollect("Hello");
    return String(backend.claude.requests[0]!.system);
  }

  it.each([
    ["year and graduation plans", /year and graduation plans/],
    ["major", /major/],
    ["first in the family", /first in their family to go to college/],
    ["living on campus or commuting", /live on campus or commute/],
    ["work hours", /work hours/],
    ["financial aid or scholarship requirements", /financial aid or scholarship requirements/],
    ["what feels hardest", /what feels hardest right now/],
  ])("covers %s among its getting-to-know-you questions", async (_, question) => {
    expect(await systemPrompt()).toMatch(question);
  });

  it("asks a couple at a time, says why, and lets the Student skip", async () => {
    const prompt = await systemPrompt();

    expect(prompt).toMatch(/at most two at a time/);
    expect(prompt).toMatch(/say in a few words why/);
    expect(prompt).toMatch(/they can skip/);
  });

  it("never asks about immigration status or health, and treats them like any other fact if raised", async () => {
    expect(await systemPrompt()).toMatch(
      /Never ask about immigration status or health\. If the Student brings either up, treat it like any other Profile fact/,
    );
  });

  it("follows the rules for Buddy's voice", async () => {
    const prompt = await systemPrompt();

    expect(prompt).toMatch(/Reply in whatever language the Student writes in/);
    for (const jargon of ["bursar", "hold", "credit hour", "office hours"]) {
      expect(prompt).toContain(jargon);
    }
    expect(prompt).toMatch(/Explain college jargon in plain words the first time/);
    expect(prompt).toMatch(/you're an AI/);
    expect(prompt).toMatch(/Never pose as Temple staff/);
    expect(prompt).toMatch(/explain the concepts and point them to tutoring/);
    expect(prompt).toMatch(/free options first/);
  });

  it("explains the marks Buddy leaves where it hid something", async () => {
    expect(await systemPrompt()).toMatch(/\[password hidden\]/);
  });
});
