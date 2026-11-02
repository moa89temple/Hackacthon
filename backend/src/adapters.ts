import type { BuddysBrowser } from "./buddys-browser.ts";
import { containerBrowser, type ContainerBrowserSettings } from "./container-browser.ts";
import { anthropicClaude, type Claude } from "./claude.ts";
import { systemClock, type Clock } from "./clock.ts";
import { realWeb, type Web } from "./web.ts";

/**
 * Everything outside Buddy, plugged in at one place when the backend starts.
 * Each part has this production version and a test version in test/support.
 */
export interface Adapters {
  claude: Claude;
  clock: Clock;
  browser: BuddysBrowser;
  web: Web;
}

export function productionAdapters(
  secrets: { anthropicApiKey: string },
  browserSettings: ContainerBrowserSettings,
): Adapters {
  return {
    claude: anthropicClaude(secrets.anthropicApiKey),
    clock: systemClock,
    browser: containerBrowser(browserSettings),
    web: realWeb(),
  };
}
