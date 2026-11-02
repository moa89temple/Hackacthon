import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { watchForAnswers, type ResponseSeen } from "../src/page-answers.ts";

const TEAM = /^\/api\/team$/;
const OTHER = /^\/api\/other$/;

function response(url: string, { method = "GET", status = 200, body = "{}" as string | Error } = {}): ResponseSeen {
  return {
    url: () => url,
    status: () => status,
    request: () => ({ method: () => method }),
    text: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
  };
}

function watching(...paths: RegExp[]) {
  const page = new EventEmitter();
  return { page, answers: watchForAnswers(page, paths) };
}

describe("what a page's own scripts get back", () => {
  it("keeps an answer to a path it was asked for, with no extra requests of its own", async () => {
    const { page, answers } = watching(TEAM);

    page.emit("response", response("https://x.test/api/team?who=1", { body: '{"team":[]}' }));
    await answers.arrived(100);

    expect(answers.kept()).toEqual([{ url: "https://x.test/api/team?who=1", status: 200, body: '{"team":[]}' }]);
  });

  it("keeps nothing else the page loads", async () => {
    const { page, answers } = watching(TEAM);

    page.emit("response", response("https://x.test/api/other"));
    page.emit("response", response("https://x.test/before/api/team"));
    await answers.arrived(1);

    expect(answers.kept()).toEqual([]);
  });

  it("keeps nothing that's a change rather than a read, whatever its address", async () => {
    const { page, answers } = watching(TEAM);

    page.emit("response", response("https://x.test/api/team", { method: "POST" }));
    page.emit("response", response("https://x.test/api/team", { method: "OPTIONS" }));
    await answers.arrived(1);

    expect(answers.kept()).toEqual([]);
  });

  it("keeps an answer that says the login has gone, for the reader to go by", async () => {
    const { page, answers } = watching(TEAM);

    page.emit("response", response("https://x.test/api/team", { status: 401 }));
    await answers.arrived(100);

    expect(answers.kept()[0]!.status).toBe(401);
  });

  it("gets past an answer with no body to read", async () => {
    const { page, answers } = watching(TEAM);

    page.emit("response", response("https://x.test/api/team", { body: new Error("No resource with given identifier") }));
    await answers.arrived(1);

    expect(answers.kept()).toEqual([]);
  });

  it("doesn't hold on to something enormous", async () => {
    const { page, answers } = watching(TEAM);

    page.emit("response", response("https://x.test/api/team", { body: "x".repeat(2_000_001) }));
    await answers.arrived(1);

    expect(answers.kept()).toEqual([]);
  });
});

describe("waiting for them", () => {
  it("waits for a page that builds itself late, and no longer than it takes", async () => {
    const { page, answers } = watching(TEAM);
    setTimeout(() => page.emit("response", response("https://x.test/api/team")), 30);
    const started = Date.now();

    await answers.arrived(5_000);

    expect(answers.kept()).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("waits for one of each path", async () => {
    const { page, answers } = watching(TEAM, OTHER);
    page.emit("response", response("https://x.test/api/team"));
    setTimeout(() => page.emit("response", response("https://x.test/api/other")), 30);

    await answers.arrived(5_000);

    expect(answers.kept()).toHaveLength(2);
  });

  it("gives up when the time is up, because a page might never ask", async () => {
    const { answers } = watching(TEAM);
    const started = Date.now();

    await answers.arrived(60);

    expect(answers.kept()).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it("doesn't wait at all when a read asked for nothing, and doesn't even listen", async () => {
    const { page, answers } = watching();
    const started = Date.now();

    await answers.arrived(5_000);

    expect(page.listenerCount("response")).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
