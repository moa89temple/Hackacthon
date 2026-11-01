import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackend, type RunningBackend } from "../../src/server.ts";
import { MovableClock } from "./movable-clock.ts";
import { readEvents } from "./read-events.ts";
import { ScriptedClaude } from "./scripted-claude.ts";

export const TEST_CHAT_MODEL = "test-chat-model";

/** A real backend on a real port with a fresh SQLite file, and test adapters. */
export class BackendHarness {
  readonly claude = new ScriptedClaude();
  readonly clock = new MovableClock("2026-11-02T14:00:00Z");
  readonly #directory = mkdtempSync(join(tmpdir(), "buddy-test-"));
  #backend!: RunningBackend;

  static async start(): Promise<BackendHarness> {
    const harness = new BackendHarness();
    await harness.#boot();
    return harness;
  }

  async #boot(): Promise<void> {
    this.#backend = await startBackend({
      adapters: { claude: this.claude, clock: this.clock },
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

  async restart(): Promise<void> {
    await this.#backend.close();
    await this.#boot();
  }

  async stop(): Promise<void> {
    await this.#backend.close();
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
}
