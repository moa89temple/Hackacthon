import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { canvas } from "./canvas.ts";
import { CANVAS_BLOCKED_PAGES, CANVAS_HOME, CANVAS_ID, CANVAS_READABLE_PAGES } from "./canvas-rules.ts";
import { googleCalendar } from "./google-calendar.ts";
import { MILESTONE_OFFICES } from "./milestone-pages.ts";
import { OFFICES } from "./office-pages.ts";

const secretsPath = fileURLToPath(new URL("../../.env.local", import.meta.url));

export const settings = {
  /** The model for conversations. Change it here and nowhere else. */
  chatModel: "claude-sonnet-5-5",
  /** The classifier for unclear messages. The Student's reply waits on it, so it gets little time. */
  crisisCheck: { model: "claude-haiku-5-5", timeoutMs: 5000 },
  /** What reads Temple's office pages for the Guidebook, and the pages it reads. */
  discovery: { model: "claude-haiku-5-5", offices: OFFICES, milestoneOffices: MILESTONE_OFFICES },
  databasePath: fileURLToPath(new URL("../data/buddy.sqlite", import.meta.url)),
  /**
   * Only this laptop can connect. The Android emulator reaches it as 10.0.2.2, and a real phone
   * reaches it through Tailscale Serve, which runs on this laptop.
   */
  host: "127.0.0.1",
  port: 8787,
  /**
   * The names the backend answers to. Buddy's Browser can reach this laptop through Docker, so
   * this is what stops a page it opens from getting answers from the backend.
   * allowedHostsWithTailscale() adds this laptop's Tailscale name to these.
   */
  allowedHosts: ["127.0.0.1", "localhost", "10.0.2.2"],
  /** Where this laptop reaches Buddy's Browser. See browser/compose.yaml. */
  browser: {
    controlUrl: "http://127.0.0.1:9222",
    liveView: { host: "127.0.0.1", port: 6080 },
  },
  /** Every Connection there is. Each stays off until the Student gives its Read Permission. */
  connectionTypes: [googleCalendar, canvas],
  /**
   * Public pages Buddy's Browser may open, each as this exact host. A whole domain would be wrong:
   * Temple's single sign-on could log it in to a Connection that has no Read Permission.
   */
  publicHosts: [
    "www.temple.edu",
    "bulletin.temple.edu",
    "registrar.temple.edu",
    "now.temple.edu",
    "counseling.temple.edu",
    "studentsuccess.temple.edu",
    "careercenter.temple.edu",
    "sfs.temple.edu",
    "wellness.temple.edu",
    "studentaffairs.temple.edu",
  ],
  /**
   * The sites a Student can log in to through a Takeover. Each site's rules for the network guard go
   * here too, as data: see Site in browser-access.ts. No site has formPages yet, so Buddy can't ask to
   * submit anything in real use.
   */
  sites: {
    [CANVAS_ID]: {
      name: "Canvas",
      homeUrl: CANVAS_HOME,
      // Temple's single sign-on and Duo are listed too. Otherwise a forgotten Canvas login
      // would quietly come back the next time Canvas sent the browser to the sign-on page.
      loginHosts: ["instructure.com", "fim.temple.edu", "duosecurity.com"],
      isConnection: true,
      readablePages: CANVAS_READABLE_PAGES,
      blockedPages: CANVAS_BLOCKED_PAGES,
    },
  },
};

/** Reads the local secrets file that git ignores. */
function readLocalFile(): NodeJS.Dict<string> {
  return existsSync(secretsPath) ? parseEnv(readFileSync(secretsPath, "utf8")) : {};
}

/** Where a real phone reaches this backend, from TAILSCALE_ADDRESS in the local file. See the README. */
export function readTailscaleAddress(address = readLocalFile().TAILSCALE_ADDRESS): string | undefined {
  const trimmed = address?.trim();
  if (!trimmed) return undefined;
  if (URL.parse(trimmed)?.protocol !== "https:") {
    throw new Error(`TAILSCALE_ADDRESS in ${secretsPath} must start with https://`);
  }
  return new URL(trimmed).origin;
}

export function allowedHostsWithTailscale(address = readTailscaleAddress()): string[] {
  return address ? [...settings.allowedHosts, new URL(address).hostname] : settings.allowedHosts;
}

export function readSecrets(): { anthropicApiKey: string } {
  const anthropicApiKey = readLocalFile().ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) {
    throw new Error(`Paste your Anthropic API key after ANTHROPIC_API_KEY= in ${secretsPath}`);
  }
  return { anthropicApiKey };
}
