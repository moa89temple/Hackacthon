import type { Claude, ClaudeMessage } from "./claude.ts";
import { todayInPhiladelphia, type Clock } from "./clock.ts";
import type { ClaudeWork, SpentByWork } from "./spending-store.ts";
import type { Store } from "./store.ts";

/** All money here is in whole nanodollars, billionths of a dollar, because every published price comes out whole in them. */
export const DAILY_BACKGROUND_LIMIT = 2_000_000_000;

/** Nanodollars per token, which is the published price per million tokens times 1,000. */
interface TokenPrices {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

const prices = (input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number): TokenPrices => ({
  input,
  cacheWrite5m,
  cacheWrite1h,
  cacheRead,
  output,
});

/**
 * From https://platform.claude.com/docs/en/about-claude/pricing, read on 2026-11-03, for the Claude API at
 * standard speed. Buddy sends neither `speed` nor `inference_geo`, so their extra charges don't come into it.
 * This has every model that page lists as still running, not only those Buddy uses, because the most
 * expensive of them is what a model with no price gets charged.
 */
const PRICES: Record<string, TokenPrices> = {
  "claude-fable-5-1": prices(10_000, 12_500, 20_000, 250, 50_000),
  "claude-mythos-5-1": prices(10_000, 12_500, 20_000, 250, 50_000),
  "claude-fable-5": prices(10_000, 12_500, 20_000, 1_000, 50_000),
  "claude-mythos-5": prices(10_000, 12_500, 20_000, 1_000, 50_000),
  "claude-opus-5-5": prices(4_000, 5_000, 8_000, 200, 20_000),
  "claude-opus-5": prices(5_000, 6_250, 10_000, 500, 25_000),
  "claude-opus-4-8": prices(5_000, 6_250, 10_000, 500, 25_000),
  "claude-opus-4-7": prices(5_000, 6_250, 10_000, 500, 25_000),
  "claude-opus-4-6": prices(5_000, 6_250, 10_000, 500, 25_000),
  "claude-opus-4-5": prices(5_000, 6_250, 10_000, 500, 25_000),
  "claude-sonnet-5-5": prices(2_000, 2_500, 4_000, 100, 10_000),
  "claude-sonnet-5": prices(2_000, 2_500, 4_000, 200, 10_000),
  "claude-sonnet-4-6": prices(3_000, 3_750, 6_000, 300, 15_000),
  "claude-sonnet-4-5": prices(3_000, 3_750, 6_000, 300, 15_000),
  "claude-haiku-5-5": prices(100, 125, 200, 10, 500),
  "claude-haiku-4-5": prices(1_000, 1_250, 2_000, 100, 5_000),
};

/** Haiku 5.5 costs more for any call whose prompt, cached tokens included, is over this. */
const HAIKU_5_5 = "claude-haiku-5-5";
const HAIKU_5_5_LONG_PROMPT_TOKENS = 100_000;
const HAIKU_5_5_LONG_PROMPT = prices(500, 625, 1_000, 50, 2_500);

/** $10 per thousand. A web fetch costs nothing beyond its tokens. */
const WEB_SEARCH = 10_000_000;

/** The highest of each kind in the table, so that a model with no price can only stop work early. */
const HIGHEST: TokenPrices = {
  input: Math.max(...Object.values(PRICES).map((price) => price.input)),
  cacheWrite5m: Math.max(...Object.values(PRICES).map((price) => price.cacheWrite5m)),
  cacheWrite1h: Math.max(...Object.values(PRICES).map((price) => price.cacheWrite1h)),
  cacheRead: Math.max(...Object.values(PRICES).map((price) => price.cacheRead)),
  output: Math.max(...Object.values(PRICES).map((price) => price.output)),
};

/** The API can answer with a dated name, such as claude-haiku-5-5-20261001, for the same model. */
const withoutDate = (model: string) => model.replace(/-\d{8}$/, "");

export const knowsPriceOf = (model: string) => withoutDate(model) in PRICES;

function tokenPrices(model: string, promptTokens: number): TokenPrices {
  const name = withoutDate(model);
  if (name === HAIKU_5_5 && promptTokens > HAIKU_5_5_LONG_PROMPT_TOKENS) return HAIKU_5_5_LONG_PROMPT;
  return PRICES[name] ?? HIGHEST;
}

/**
 * The usage of a turn of web searches adds up all of its rounds, and the docs don't say how the 100,000 tokens
 * apply to those. Going by that sum can only overstate what such a turn cost, never understate it.
 */
function costOf(model: string, usage: ClaudeMessage["usage"]): number {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const price = tokenPrices(model, usage.input_tokens + cacheRead + cacheWrite);
  return (
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    cacheRead * price.cacheRead +
    (cacheWrite - cacheWrite1h) * price.cacheWrite5m +
    cacheWrite1h * price.cacheWrite1h +
    (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH
  );
}

/**
 * Today's background work has used its $2, so this call wasn't made. That says nothing about what it would
 * have read, so whoever catches it leaves everything as it was and doesn't count its work as done or failed:
 * it gets its turn again after midnight in Philadelphia.
 */
export class BackgroundLimitReached extends Error {
  constructor() {
    super("Background work has used its limit for today");
    this.name = "BackgroundLimitReached";
  }
}

export interface SpendingTotals {
  chat: number;
  background: number;
  total: number;
}

/**
 * Prices and records every Claude call, by wrapping the Claude that does the work. In server.ts, only these
 * wrapped ones get handed out.
 *
 * Which one a caller gets is what decides whether the limit applies to it:
 * - forChat: replies to the Student and the Crisis check, which the limit must never stop.
 * - forBackground: Discovery, Opportunity discovery and Connection reading. Alert classification (#24 to #26)
 *   must use this too when it comes, because it's named as background work and nothing else would stop it.
 *
 * Tasks, when they come, aren't this kind of background work: the spec has them carry on with their own $1 pause.
 *
 * Briefings use no model, so they have nothing to stop, and neither does anything else that doesn't call
 * Claude: the limit lives only in forBackground, so that free work goes on after it.
 *
 * A call that dies before its final message has no usage to price, so it's recorded as nothing, though
 * Anthropic may charge for what it got through. The same goes for a call the Crisis check gives up on.
 * forBackground checks before each call, so calls already under way can take a day's total past $2.
 */
export interface Spending {
  forChat(claude: Claude): Claude;
  forBackground(claude: Claude): Claude;
  today(): SpendingTotals;
  thisMonth(): SpendingTotals;
  backgroundStoppedForToday(): boolean;
}

const totalled = ({ chat, background }: SpentByWork): SpendingTotals => ({ chat, background, total: chat + background });

export function createSpending(deps: { store: Store; clock: Clock; logError: (error: unknown) => void }): Spending {
  const { store, clock, logError } = deps;
  const modelsWithNoPriceLogged = new Set<string>();

  const today = () => todayInPhiladelphia(clock.now());
  const stopped = () => store.spending.spentOn(today()).background >= DAILY_BACKGROUND_LIMIT;

  function record(work: ClaudeWork, message: ClaudeMessage): void {
    const { model, usage } = message;
    if (!knowsPriceOf(model) && !modelsWithNoPriceLogged.has(model)) {
      modelsWithNoPriceLogged.add(model);
      logError(new Error(`Buddy has no price for ${model}, so it counts it at the highest prices it has. Add it to spending.ts.`));
    }
    const at = clock.now();
    store.spending.record({
      at,
      day: todayInPhiladelphia(at),
      work,
      model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      webSearches: usage.server_tool_use?.web_search_requests ?? 0,
      costNanodollars: costOf(model, usage),
    });
  }

  function recording(work: ClaudeWork, claude: Claude): Claude {
    return {
      async *stream(request, options) {
        for await (const event of claude.stream(request, options)) {
          // Before handing it on, because most callers stop listening once they have the message.
          if (event.type === "message") {
            try {
              record(work, event.message);
            } catch (error) {
              // The reply has been paid for either way, and the Student shouldn't lose it over this.
              logError(error);
            }
          }
          yield event;
        }
      },
    };
  }

  return {
    forChat: (claude) => recording("chat", claude),

    forBackground(claude) {
      const recorded = recording("background", claude);
      return {
        async *stream(request, options) {
          if (stopped()) throw new BackgroundLimitReached();
          yield* recorded.stream(request, options);
        },
      };
    },

    today: () => totalled(store.spending.spentOn(today())),
    thisMonth: () => totalled(store.spending.spentInMonth(today().slice(0, 7))),
    backgroundStoppedForToday: stopped,
  };
}
