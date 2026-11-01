import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackend, type RunningBackend } from "../../src/server.ts";
import { MovableClock } from "./movable-clock.ts";
import { readEvents } from "./read-events.ts";
import { RecordingBrowser } from "./recording-browser.ts";
import { ScriptedClaude } from "./scripted-claude.ts";

export const TEST_CHAT_MODEL = "test-chat-model";
export const TEST_SITE = {
  name: "Canvas",
  homeUrl: "https://canvas.test/",
  loginHosts: ["canvas.test", "sign-in.test"],
};
export const OTHER_TEST_SITE = {
  name: "TUportal",
  homeUrl: "https://portal.test/",
  loginHosts: ["portal.test"],
};

/** A real backend on a real port with a fresh SQLite file, and test adapters. */
export class BackendHarness {
  readonly claude = new ScriptedClaude();
  readonly clock = new MovableClock("2026-11-02T14:00:00Z");
  readonly browser = new RecordingBrowser();
  readonly #directory = mkdtempSync(join(tmpdir(), "buddy-test-"));
  #backend!: RunningBackend;

  static async start(): Promise<BackendHarness> {
    const harness = new BackendHarness();
    await harness.browser.startLiveView();
    await harness.#boot();
    return harness;
  }

  async #boot(): Promise<void> {
    this.#backend = await startBackend({
      adapters: { claude: this.claude, clock: this.clock, browser: this.browser },
      sites: { canvas: TEST_SITE, tuportal: OTHER_TEST_SITE },
      allowedHosts: ["127.0.0.1"],
      databasePath: join(this.#directory, "buddy.sqlite"),
      chatModel: TEST_CHAT_MODEL,
      host: "127.0.0.1",
      port: 0,
      logger: false,
    });
  }

  get url(): string {
    return this.#backend.url;
  }

  /** The way the rest of the backend reads pages. */
  get browserAccess(): RunningBackend["browserAccess"] {
    return this.#backend.browserAccess;
  }

  async restart(): Promise<void> {
    await this.#backend.close();
    await this.#boot();
  }

  async stop(): Promise<void> {
    await this.#backend.close();
    await this.browser.stopLiveView();
    rmSync(this.#directory, { recursive: true, force: true });
  }

  /** Sends a message the way the app does. Events arrive as the backend writes them. */
  async *send(text: string): AsyncGenerator<any> {
    const response = await this.post(text);
    if (!response.ok) throw new Error(`send failed with ${response.status}`);
    yield* readEvents(response);
  }

  async sendAndCollect(text: string): Promise<any[]> {
    return await Array.fromAsync(this.send(text));
  }

  post(text: unknown, signal?: AbortSignal): Promise<Response> {
    return fetch(`${this.url}/conversation/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: signal ?? null,
    });
  }

  async history(): Promise<any[]> {
    const response = await fetch(`${this.url}/conversation/messages`);
    return ((await response.json()) as { messages: any[] }).messages;
  }

  startTakeover(site: unknown): Promise<Response> {
    return fetch(`${this.url}/takeover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site }),
    });
  }

  async currentTakeover(): Promise<any> {
    const response = await fetch(`${this.url}/takeover`);
    return ((await response.json()) as { takeover: any }).takeover;
  }

  /** The Student tapping Done. */
  finishTakeover(): Promise<Response> {
    return fetch(`${this.url}/takeover/done`, { method: "POST" });
  }

  forgetLogin(site: string): Promise<Response> {
    return fetch(`${this.url}/sites/${site}/login`, { method: "DELETE" });
  }
}
