import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Claude } from "../src/claude.ts";
import { settings } from "../src/settings.ts";
import { BackgroundLimitReached, createSpending, DAILY_BACKGROUND_LIMIT, knowsPriceOf, type Spending } from "../src/spending.ts";
import { openStore, type Store } from "../src/store.ts";
import { MovableClock } from "./support/movable-clock.ts";
import { ScriptedClaude, type ScriptedReply } from "./support/scripted-claude.ts";

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
/** Priced from the Haiku rows: 4,000,000 output tokens at $0.50 per million is $2. */
const TWO_DOLLARS: ScriptedReply = { usage: { output_tokens: 4_000_000 } };
/** A nanodollar is a billionth of a dollar, so one cent is this many. */
const CENT = 10_000_000;

let directory: string;
let store: Store;
let clock: MovableClock;
let claude: ScriptedClaude;
let logged: string[];
let spending: Spending;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "buddy-spending-"));
  store = openStore(join(directory, "buddy.sqlite"));
  clock = new MovableClock("2026-11-03T15:00:00Z");
  claude = new ScriptedClaude();
  logged = [];
  spending = createSpending({ store, clock, logError: (error) => logged.push(String(error)) });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

const request = (model: string) => ({ model, max_tokens: 100, messages: [{ role: "user" as const, content: "Hi" }] });

/** Runs one call to the end, as the chat does. */
async function call(through: Claude, model = HAIKU): Promise<void> {
  for await (const _ of through.stream(request(model))) {
    // Only what it records matters here.
  }
}

/** Stops listening as soon as the final message arrives, the way extraction.ts and crisis-check.ts do. */
async function callAndLeaveAtTheMessage(through: Claude, model = HAIKU): Promise<void> {
  for await (const event of through.stream(request(model))) {
    if (event.type === "message") return;
  }
}

async function chatCallCosting(reply: ScriptedReply, model = HAIKU): Promise<void> {
  claude.willReply(reply);
  await call(spending.forChat(claude), model);
}

describe("pricing a Claude call", () => {
  it("prices input, output, cache reads, cache writes and web searches, as Haiku's published rates work out", async () => {
    await chatCallCosting({
      usage: {
        input_tokens: 1000,
        output_tokens: 2000,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 4000,
        server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 },
      },
    });

    // $0.10/M input, $0.50/M output, $0.01/M read, $0.125/M write, and 1 cent a search.
    expect(spending.today().total).toBe(100_000 + 1_000_000 + 100_000 + 500_000 + 3 * CENT);
  });

  it("prices each model at its own rates", async () => {
    await chatCallCosting({ usage: { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1000 } }, SONNET);

    // $2/M input, $10/M output, $0.10/M read.
    expect(spending.today().total).toBe(2_000_000 + 10_000_000 + 100_000);
  });

  it("prices a one-hour cache write apart from a five-minute one", async () => {
    await chatCallCosting(
      {
        usage: {
          cache_creation_input_tokens: 3000,
          cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
        },
      },
      SONNET,
    );

    // $2.50/M for five minutes, $4/M for an hour.
    expect(spending.today().total).toBe(2_500_000 + 8_000_000);
  });

  it("charges nothing for a web fetch, which is free beyond its tokens", async () => {
    await chatCallCosting({ usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 5 } } });

    expect(spending.today().total).toBe(0);
  });

  it("prices Haiku higher once a prompt is over 100,000 tokens, counting cached tokens in the prompt", async () => {
    await chatCallCosting({ usage: { input_tokens: 60_000, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 10_000, output_tokens: 1000 } });
    const atTheLine = spending.today().total;
    await chatCallCosting({ usage: { input_tokens: 60_001, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 10_000, output_tokens: 1000 } });

    // Exactly 100,000 is still the lower price.
    expect(atTheLine).toBe(6_000_000 + 300_000 + 1_250_000 + 500_000);
    // One more, and every kind of token pays the higher price.
    expect(spending.today().total - atTheLine).toBe(30_000_500 + 1_500_000 + 6_250_000 + 2_500_000);
  });

  it("keeps money in whole numbers, however small the call", async () => {
    await chatCallCosting({ usage: { input_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1, output_tokens: 1 } });

    expect(Number.isInteger(spending.today().total)).toBe(true);
    expect(spending.today().total).toBe(100 + 10 + 125 + 500);
  });

  it("knows a price for every model Buddy is set up to use, so that changing one means adding its price", () => {
    for (const model of [settings.chatModel, settings.crisisCheck.model, settings.discovery.model]) {
      expect(knowsPriceOf(model)).toBe(true);
    }
  });

  it("recognizes a model that comes back with a date on its name", async () => {
    await chatCallCosting({ servedBy: `${HAIKU}-20261001`, usage: { input_tokens: 1000 } });

    expect(spending.today().total).toBe(100_000);
    expect(logged).toEqual([]);
  });

  it("prices a model it has no price for at the most expensive rates it has, and logs it", async () => {
    await chatCallCosting({ usage: { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 1000 } }, "claude-from-the-future");

    // The highest of each kind in the table: $10/M input, $50/M output, $1/M read, $12.50/M write.
    expect(spending.today().total).toBe(10_000_000 + 50_000_000 + 1_000_000 + 12_500_000);
    expect(logged.join()).toContain("claude-from-the-future");
  });

  it("logs a model with no price once, rather than at every call", async () => {
    await chatCallCosting({}, "claude-from-the-future");
    await chatCallCosting({}, "claude-from-the-future");

    expect(logged).toHaveLength(1);
  });
});

describe("recording a Claude call", () => {
  it("records a call whose caller stops listening at the final message", async () => {
    claude.willReply({ usage: { input_tokens: 1000 } });
    await callAndLeaveAtTheMessage(spending.forBackground(claude));

    expect(spending.today().background).toBe(100_000);
  });

  it("passes every event through as it came", async () => {
    claude.willReply({ chunks: ["Hel", "lo"] });
    const events = await Array.fromAsync(spending.forChat(claude).stream(request(HAIKU)));

    expect(events.map((event) => event.type)).toEqual(["text", "text", "message"]);
  });

  it("hands on the caller's abort signal", async () => {
    const signal = new AbortController().signal;
    claude.willReply({});
    await Array.fromAsync(spending.forChat(claude).stream(request(HAIKU), { signal }));

    expect(claude.signals[0]).toBe(signal);
  });

  it("records nothing for a call that dies before its final message, which has no usage to price", async () => {
    claude.willReply({ chunks: ["Hel"], failWith: new Error("made up: the stream broke") });

    await expect(call(spending.forChat(claude))).rejects.toThrow("the stream broke");
    expect(spending.today().total).toBe(0);
  });

  it("keeps a reply going if its usage can't be saved, and logs that", async () => {
    claude.willReply({ chunks: ["Hello"], usage: { output_tokens: 10 } });
    const broken = createSpending({
      store: {
        ...store,
        spending: {
          ...store.spending,
          record: () => {
            throw new Error("made up: the disk is full");
          },
        },
      },
      clock,
      logError: (error) => logged.push(String(error)),
    });

    const events = await Array.fromAsync(broken.forChat(claude).stream(request(HAIKU)));

    expect(events.at(-1)?.type).toBe("message");
    expect(logged.join()).toContain("the disk is full");
  });

  it("keeps what it recorded through a restart", async () => {
    await chatCallCosting({ usage: { input_tokens: 1000 } });
    store.close();
    store = openStore(join(directory, "buddy.sqlite"));
    spending = createSpending({ store, clock, logError: () => {} });

    expect(spending.today().total).toBe(100_000);
  });
});

describe("the background limit", () => {
  const backgroundCall = async (reply: ScriptedReply = {}) => {
    claude.willReply(reply);
    await call(spending.forBackground(claude));
  };

  it("lets background work run up to the limit, and stops it there without calling Claude", async () => {
    await backgroundCall(TWO_DOLLARS);
    const callsSoFar = claude.requests.length;

    await expect(call(spending.forBackground(claude))).rejects.toBeInstanceOf(BackgroundLimitReached);

    expect(claude.requests).toHaveLength(callsSoFar);
    expect(spending.today().background).toBe(DAILY_BACKGROUND_LIMIT);
    expect(spending.backgroundStoppedForToday()).toBe(true);
  });

  it("still allows a call while it's just under the limit", async () => {
    await backgroundCall({ usage: { output_tokens: 3_999_999 } });

    expect(spending.backgroundStoppedForToday()).toBe(false);
    await backgroundCall();
    expect(claude.requests).toHaveLength(2);
  });

  it("is $2", () => {
    expect(DAILY_BACKGROUND_LIMIT).toBe(200 * CENT);
  });

  it("doesn't count chat towards the limit", async () => {
    await chatCallCosting(TWO_DOLLARS);

    expect(spending.today().chat).toBe(DAILY_BACKGROUND_LIMIT);
    expect(spending.backgroundStoppedForToday()).toBe(false);
    await backgroundCall();
    expect(claude.requests).toHaveLength(2);
  });

  it("never stops chat, however much background work has used", async () => {
    await backgroundCall(TWO_DOLLARS);
    await chatCallCosting({ usage: { input_tokens: 1000 } });

    expect(spending.today().chat).toBe(100_000);
    expect(claude.requests).toHaveLength(2);
  });

  it("puts chat and background work together in the total", async () => {
    await chatCallCosting({ usage: { input_tokens: 1000 } });
    await backgroundCall({ usage: { input_tokens: 2000 } });

    expect(spending.today()).toEqual({ chat: 100_000, background: 200_000, total: 300_000 });
    expect(spending.thisMonth()).toEqual({ chat: 100_000, background: 200_000, total: 300_000 });
  });

  it("holds through a restart", async () => {
    await backgroundCall(TWO_DOLLARS);
    store.close();
    store = openStore(join(directory, "buddy.sqlite"));
    spending = createSpending({ store, clock, logError: () => {} });

    await expect(call(spending.forBackground(claude))).rejects.toBeInstanceOf(BackgroundLimitReached);
  });
});

describe("which day and month it is, on Philadelphia's clock", () => {
  const reachTheLimit = async () => {
    claude.willReply(TWO_DOLLARS);
    await call(spending.forBackground(claude));
  };

  it("keeps the limit until midnight in Philadelphia, past midnight in UTC, and resumes the next day", async () => {
    // 11 p.m. on November 3 in Philadelphia is already November 4 in UTC.
    clock.moveTo("2026-11-04T04:00:00Z");
    await reachTheLimit();

    // 11:59 p.m. in Philadelphia, and nearly five hours past midnight in UTC.
    clock.moveTo("2026-11-04T04:59:00Z");
    expect(spending.backgroundStoppedForToday()).toBe(true);
    await expect(call(spending.forBackground(claude))).rejects.toBeInstanceOf(BackgroundLimitReached);

    // Midnight in Philadelphia.
    clock.moveTo("2026-11-04T05:00:00Z");
    expect(spending.backgroundStoppedForToday()).toBe(false);
    expect(spending.today().total).toBe(0);
    claude.willReply({});
    await call(spending.forBackground(claude));
  });

  it("gives the day the clocks go back all 25 of its hours", async () => {
    // November 1, 2026 starts at 04:00 UTC, on daylight time, and ends at 05:00 UTC the next day, on standard time.
    clock.moveTo("2026-11-01T04:10:00Z");
    await reachTheLimit();

    // 24 hours later, it's still 11:10 p.m. on November 1.
    clock.moveTo("2026-11-02T04:10:00Z");
    expect(spending.backgroundStoppedForToday()).toBe(true);

    clock.moveTo("2026-11-02T05:00:00Z");
    expect(spending.backgroundStoppedForToday()).toBe(false);
  });

  it("gives the day the clocks go forward only its 23 hours", async () => {
    // March 8, 2026 starts at 05:00 UTC, on standard time, and ends at 04:00 UTC the next day, on daylight time.
    clock.moveTo("2026-03-08T05:10:00Z");
    await reachTheLimit();

    clock.moveTo("2026-03-09T03:59:00Z");
    expect(spending.backgroundStoppedForToday()).toBe(true);

    // Only 23 hours on, and it's the next day.
    clock.moveTo("2026-03-09T04:00:00Z");
    expect(spending.backgroundStoppedForToday()).toBe(false);
  });

  it("counts a month by Philadelphia's clock, and starts afresh on the first", async () => {
    // 11:30 p.m. on November 30 in Philadelphia, and already December in UTC.
    clock.moveTo("2026-12-01T04:30:00Z");
    await chatCallCosting({ usage: { input_tokens: 1000 } });
    expect(spending.thisMonth().total).toBe(100_000);

    // Earlier the same month.
    clock.moveTo("2026-11-15T15:00:00Z");
    expect(spending.thisMonth().total).toBe(100_000);
    await chatCallCosting({ usage: { input_tokens: 500 } });
    expect(spending.thisMonth().total).toBe(150_000);
    expect(spending.today().total).toBe(50_000);

    clock.moveTo("2026-12-01T05:00:00Z");
    expect(spending.today().total).toBe(0);
    expect(spending.thisMonth().total).toBe(0);
  });

  it("adds up every day of the month, not just today", async () => {
    await chatCallCosting({ usage: { input_tokens: 1000 } });
    clock.moveForward(24 * 3_600_000);
    await chatCallCosting({ usage: { input_tokens: 1000 } });

    expect(spending.today().total).toBe(100_000);
    expect(spending.thisMonth().total).toBe(200_000);
  });
});
