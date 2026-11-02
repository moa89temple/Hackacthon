import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import { PageBlocked } from "../src/buddys-browser.ts";
import { canvas } from "../src/canvas.ts";
import { settings } from "../src/settings.ts";
import { BackendHarness, TEST_CHAT_MODEL } from "./support/backend-harness.ts";
import { canvasPage, CANVAS_HOME, saveCanvasPages } from "./support/canvas-pages.ts";
import { toolUseBlock } from "./support/scripted-claude.ts";

/**
 * The real rules on a Canvas where forms could be submitted anywhere, which is more than the real one
 * has, so that only the blocklist can be what stops these. There's no formPages at all on the real one.
 */
const SUBMITTING_ALLOWED: Site = { ...settings.sites.canvas, formPages: [{ path: /./ }] };

const REQUEST = {
  kind: "submit_form",
  site: "canvas",
  page_url: `${CANVAS_HOME}/courses/101/announcements`,
  action_url: `${CANVAS_HOME}/courses/101/announcements`,
  form: "work",
  button: "Submit",
  fields: [{ name: "answer", value: "Made-up answer" }],
  page_fills: [],
  replaces_card: null,
};

const GRADED_WORK = [
  ["an assignment's own page", `${CANVAS_HOME}/courses/101/assignments/501`],
  ["where an assignment is submitted", `${CANVAS_HOME}/courses/101/assignments/501/submissions`],
  ["the API for submitting", `${CANVAS_HOME}/api/v1/courses/101/assignments/501/submissions`],
  ["a quiz", `${CANVAS_HOME}/courses/101/quizzes/30/take`],
  ["a quiz's answers", `${CANVAS_HOME}/api/v1/quiz_submissions/30/questions`],
  ["a discussion board", `${CANVAS_HOME}/courses/101/discussion_topics/900/entries`],
  ["a roster", `${CANVAS_HOME}/courses/101/users`],
  ["a classmate's work", `${CANVAS_HOME}/courses/101/assignments/501/submissions/57`],
] as const;

let backend: BackendHarness;

async function start(site: Site): Promise<void> {
  backend = await BackendHarness.start({ sites: { canvas: site }, extraConnectionTypes: [canvas] });
  saveCanvasPages(backend.browser);
  await backend.giveReadPermission("canvas", undefined);
  backend.browser.actions.length = 0;
}

afterEach(async () => {
  await backend.stop();
});

const chatRequests = () => backend.claude.requests.filter((request) => request.model === TEST_CHAT_MODEL);
const lastToolAnswer = () => (chatRequests().at(-1)!.messages.at(-1)!.content as any[]).at(-1);
const submissions = () => backend.browser.actions.filter((action) => action.type === "submit");

/** Claude asks for the step and then writes its reply. Returns the card the Student sees. */
async function requestCard(input: unknown): Promise<any> {
  backend.claude.willReply(
    { content: [toolUseBlock("request_action", input)], stopReason: "tool_use" },
    { chunks: ["Here's the card."] },
  );
  const events = await backend.sendAndCollect("Please submit my work.");
  return events.find((event) => event.type === "action_card")?.card;
}

describe("on the real Canvas", () => {
  beforeEach(() => start(settings.sites.canvas));

  it.each(GRADED_WORK)("refuses %s, with its saved page there to be read", async (_name, url) => {
    backend.browser.savedPages.set(url, canvasPage("<h1>Made-up page Buddy must never read</h1>", { text: "Made-up words" }));

    await expect(backend.browserAccess.read(url)).rejects.toThrow(PageBlocked);

    expect(backend.browser.actions).toEqual([]);
  });

  it.each(GRADED_WORK)("refuses a redirect to %s from a page it may open", async (_name, url) => {
    const page = `${CANVAS_HOME}/courses/101/grades`;
    backend.browser.savedPages.set(page, canvasPage("<h1>Made-up page</h1>", { finalUrl: url }));

    await expect(backend.browserAccess.read(page)).rejects.toThrow(PageBlocked);
  });

  it("offers no way to submit anything at all", async () => {
    backend.claude.willReply({ chunks: ["Hello."] });

    await backend.sendAndCollect("Hi");

    expect(chatRequests().at(-1)!.tools!.some((tool: any) => tool.name === "request_action")).toBe(false);
  });
});

describe("even if forms could be submitted on Canvas", () => {
  beforeEach(() => start(SUBMITTING_ALLOWED));

  it.each(GRADED_WORK)("no card can be made for %s, as the page", async (_name, url) => {
    const card = await requestCard({ ...REQUEST, page_url: url });

    expect(card).toBeUndefined();
    expect(lastToolAnswer().is_error).toBe(true);
    expect(submissions()).toEqual([]);
  });

  it.each(GRADED_WORK)("no card can be made for %s, as where it's sent", async (_name, url) => {
    const card = await requestCard({ ...REQUEST, action_url: url });

    expect(card).toBeUndefined();
    expect(submissions()).toEqual([]);
  });
});

describe("with a card the Student has approved", () => {
  /** The site's rules start empty, so that the card can exist, and only arrive before the Approve tap. */
  const site: Site = { ...settings.sites.canvas, formPages: [{ path: /./ }], blockedPages: [] };

  beforeEach(() => start(site));
  afterEach(() => {
    site.blockedPages = [];
  });

  it.each(GRADED_WORK)("still refuses %s as the page, and nothing reaches it", async (_name, url) => {
    const card = await requestCard({ ...REQUEST, page_url: url });
    expect(card).toBeDefined();
    site.blockedPages = settings.sites.canvas.blockedPages!;

    const response = await backend.approveCard(card.id, { fingerprint: card.fingerprint });

    expect(response.status).toBe(200);
    expect((await backend.card(card.id)).status).toBe("not_run");
    expect(submissions()).toEqual([]);
  });

  it.each(GRADED_WORK)("still refuses to send to %s, and nothing leaves the browser", async (_name, url) => {
    const card = await requestCard({ ...REQUEST, action_url: url });
    expect(card).toBeDefined();
    site.blockedPages = settings.sites.canvas.blockedPages!;

    await backend.approveCard(card.id, { fingerprint: card.fingerprint });

    const finished = await backend.card(card.id);
    expect(finished.status).toBe("not_run");
    expect(finished.status).not.toBe("done");
  });
});
