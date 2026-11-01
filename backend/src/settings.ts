import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const secretsPath = fileURLToPath(new URL("../../.env.local", import.meta.url));

export const settings = {
  /** The model for conversations. Change it here and nowhere else. */
  chatModel: "claude-sonnet-5-5",
  databasePath: fileURLToPath(new URL("../data/buddy.sqlite", import.meta.url)),
  /** Only this laptop can connect. The Android emulator reaches it as 10.0.2.2. */
  host: "127.0.0.1",
  port: 8787,
  /**
   * The names the backend answers to. Buddy's Browser can reach this laptop through Docker, so
   * this is what stops a page it opens from getting answers from the backend. Add the Tailscale
   * name here when the phone moves to Tailscale.
   */
  allowedHosts: ["127.0.0.1", "localhost", "10.0.2.2"],
  /** Where this laptop reaches Buddy's Browser. See browser/compose.yaml. */
  browser: {
    controlUrl: "http://127.0.0.1:9222",
    liveView: { host: "127.0.0.1", port: 6080 },
  },
  /** The sites a Student can log in to through a Takeover. */
  sites: {
    canvas: {
      name: "Canvas",
      homeUrl: "https://templeu.instructure.com/",
      // Temple's single sign-on and Duo are listed too. Otherwise a forgotten Canvas login
      // would quietly come back the next time Canvas sent the browser to the sign-on page.
      loginHosts: ["instructure.com", "fim.temple.edu", "duosecurity.com"],
    },
  },
};

/** Reads the local secrets file that git ignores. */
export function readSecrets(): { anthropicApiKey: string } {
  const secrets = existsSync(secretsPath) ? parseEnv(readFileSync(secretsPath, "utf8")) : {};
  const anthropicApiKey = secrets.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) {
    throw new Error(`Paste your Anthropic API key after ANTHROPIC_API_KEY= in ${secretsPath}`);
  }
  return { anthropicApiKey };
}
