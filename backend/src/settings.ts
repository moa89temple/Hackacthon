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
