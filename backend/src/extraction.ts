import { textOf, type Claude, type ClaudeMessage, type ClaudeRequest } from "./claude.ts";

const EXTRACTION_TIMEOUT_MS = 120_000;

async function finalMessage(claude: Claude, request: ClaudeRequest): Promise<ClaudeMessage> {
  for await (const event of claude.stream(request, { signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS) })) {
    if (event.type === "message") return event.message;
  }
  throw new Error("Discovery's stream ended without a message");
}

/** Throws on anything other than a clean answer in the right shape, including a refusal. */
export async function askModel(claude: Claude, request: ClaudeRequest): Promise<Record<string, unknown>[]> {
  const message = await finalMessage(claude, request);
  if (message.stop_reason !== "end_turn") {
    throw new Error(`The extraction stopped early (stop reason: ${message.stop_reason})`);
  }
  const items = JSON.parse(textOf(message.content))?.items;
  if (!Array.isArray(items)) throw new Error("The extraction's answer had no list of items");
  return items;
}

/** Curly quotes and odd spaces shouldn't stop a quote from matching the page it was copied from. */
export function comparable(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

export function numbersIn(text: string): Set<string> {
  return new Set(text.match(/\d+/g) ?? []);
}

/** The model could write down a number that's not there, and this is one mistake that's easy to catch. */
export function allNumbersAmong(value: string, known: Set<string>): boolean {
  return [...numbersIn(value)].every((number) => known.has(number));
}

/** The words, or null if the model left this empty or gave something other than words. */
export function filled(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
