import { anthropicClaude, type Claude } from "./claude.ts";
import { systemClock, type Clock } from "./clock.ts";

/**
 * Everything outside Buddy, plugged in at one place when the backend starts.
 * Each part has this production version and a test version in test/support.
 */
export interface Adapters {
  claude: Claude;
  clock: Clock;
}

export function productionAdapters(secrets: { anthropicApiKey: string }): Adapters {
  return {
    claude: anthropicClaude(secrets.anthropicApiKey),
    clock: systemClock,
  };
}
