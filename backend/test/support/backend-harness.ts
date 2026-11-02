import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Site } from "../../src/browser-access.ts";
import type { ConnectionType } from "../../src/connections.ts";
import type { Office } from "../../src/office-pages.ts";
import { createDevices } from "../../src/devices.ts";
import { googleCalendar } from "../../src/google-calendar.ts";
import { startBackend, type RunningBackend } from "../../src/server.ts";
import { openStore, THE_STUDENT } from "../../src/store.ts";
import { MovableClock } from "./movable-clock.ts";
import { saveOfficePages, TEST_OFFICES } from "./office-pages.ts";
import { readEvents } from "./read-events.ts";
import { RecordingBrowser } from "./recording-browser.ts";
import { SavedWeb } from "./saved-web.ts";
import { ScriptedClaude } from "./scripted-claude.ts";

export const TEST_CHAT_MODEL = "test-chat-model";
export const TEST_CRISIS_MODEL = "test-crisis-model";
export const TEST_DISCOVERY_MODEL = "test-discovery-model";
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

/** A public page, which Buddy's Browser may open with no Read Permission. */
export const PUBLIC_TEST_PAGE = "https://public.test/";

export const CALENDAR = googleCalendar.id;
/** Made up, in the shape of the address Google gives. */
export const SECRET_ADDRESS =
  "https://calendar.google.com/calendar/ical/student%40example.test/private-0123456789abcdef0123456789abcdef/basic.ics";
export const WARNED_CONNECTION = "warned";

/** A Connection with a warning on its card and no address, standing in for those to come. */
const warnedConnection: ConnectionType = {
  id: WARNED_CONNECTION,
  name: "A service with rules",
  card: { reads: ["Your things."], notes: [], warning: "This service's own rules forbid automated tools.", address: null },
  whileOnTellClaude: "Nothing to do.",
  read: async () => [],
  describeForClaude: () => "Nothing.",
};

/** A real backend on a real port with a fresh SQLite file, and test adapters. */
export class BackendHarness {
  readonly claude = new ScriptedClaude();
  readonly clock = new MovableClock("2026-11-02T14:00:00Z");
  readonly browser = new RecordingBrowser();
  readonly web = new SavedWeb();
  readonly #directory = mkdtempSync(join(tmpdir(), "buddy-test-"));
  #backend!: RunningBackend;
  /** The key of the phone every helper here acts as, paired the way the real app pairs. */
  deviceKey!: string;
  #offices: Office[] = TEST_OFFICES;
  #sites: Record<string, Site> = { canvas: TEST_SITE, tuportal: OTHER_TEST_SITE };
  #extraConnectionTypes: ConnectionType[] = [];

  static async start(
    options: { offices?: Office[]; sites?: Record<string, Site>; extraConnectionTypes?: ConnectionType[] } = {},
  ): Promise<BackendHarness> {
    const harness = new BackendHarness();
    harness.#offices = options.offices ?? TEST_OFFICES;
    harness.#sites = options.sites ?? harness.#sites;
    harness.#extraConnectionTypes = options.extraConnectionTypes ?? [];
    saveOfficePages(harness.web, harness.#offices);
    await harness.browser.startLiveView();
    await harness.#boot();
    await harness.#pairPhone();
    return harness;
  }

  async #pairPhone(): Promise<void> {
    const response = await fetch(`${this.url}/devices/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: this.devices.newPairingCode().code }),
    });
    this.deviceKey = ((await response.json()) as { deviceKey: string }).deviceKey;
  }

  async #boot(): Promise<void> {
    this.#backend = await startBackend({
      adapters: { claude: this.claude, clock: this.clock, browser: this.browser, web: this.web },
      sites: this.#sites,
      publicHosts: [new URL(PUBLIC_TEST_PAGE).hostname],
      connectionTypes: [googleCalendar, warnedConnection, ...this.#extraConnectionTypes],
      allowedHosts: ["127.0.0.1"],
      databasePath: join(this.#directory, "buddy.sqlite"),
      chatModel: TEST_CHAT_MODEL,
      crisisCheck: { model: TEST_CRISIS_MODEL, timeoutMs: 50 },
      discovery: { model: TEST_DISCOVERY_MODEL, offices: this.#offices },
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

  /** What the rest of the backend sees of the Guidebook. */
  get guidebook(): RunningBackend["guidebook"] {
    return this.#backend.guidebook;
  }

  /** What the backend's timer calls each minute. */
  get discovery(): RunningBackend["discovery"] {
    return this.#backend.discovery;
  }

  /** The Student tapping Report on a card. */
  report(id: unknown, key: Record<string, string> = this.deviceHeaders): Promise<Response> {
    return fetch(`${this.url}/guidebook/items/${id}/report`, { method: "POST", headers: key });
  }

  /** The Student saving their changes to a Draft. */
  editDraft(id: unknown, words: { subject: unknown; body: unknown }, key: Record<string, string> = this.deviceHeaders): Promise<Response> {
    return fetch(`${this.url}/drafts/${id}`, {
      method: "PATCH",
      headers: { ...key, "content-type": "application/json" },
      body: JSON.stringify(words),
    });
  }

  get devices(): RunningBackend["devices"] {
    return this.#backend.devices;
  }

  get deviceHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.deviceKey}` };
  }

  /** What npm run pair does: makes a code from outside the running backend. */
  newPairingCodeFromAnotherProcess(): { code: string; close(): void } {
    const store = openStore(join(this.#directory, "buddy.sqlite"));
    const { code } = createDevices({ store, clock: this.clock }).newPairingCode();
    return { code, close: () => store.close() };
  }

  /** Whether these exact characters are anywhere in the database's files on disk. */
  storageContains(text: string): boolean {
    return readdirSync(this.#directory)
      .filter((name) => name.startsWith("buddy.sqlite"))
      .some((name) => readFileSync(join(this.#directory, name)).includes(text));
  }

  /** A second connection to the database, for standing in for something going wrong from outside. */
  #withDatabase(work: (database: DatabaseSync) => void): void {
    const database = new DatabaseSync(join(this.#directory, "buddy.sqlite"));
    work(database);
    database.close();
  }

  /** Changes a card's content behind Buddy's back, as a bug or anything else with the file might. */
  changeStoredCardContent(id: number, content: unknown): void {
    this.#withDatabase((database) => {
      database.prepare("UPDATE action_cards SET content = ? WHERE id = ?").run(JSON.stringify(content), id);
    });
  }

  /** Leaves a card as a backend that stopped in the middle of its step would. */
  stopCardPartway(id: number): void {
    const store = openStore(join(this.#directory, "buddy.sqlite"));
    const card = store.actionCard(THE_STUDENT, id)!;
    store.moveActionCard(THE_STUDENT, id, "waiting", { status: "running", approvedFingerprint: card.fingerprint }, []);
    store.close();
  }

  /** What main.ts does when it starts, unless it's a command run on the laptop. */
  async restart(options: { asCommand?: boolean } = {}): Promise<void> {
    await this.#backend.close();
    await this.#boot();
    if (!options.asCommand) this.#backend.actionCards.endInterrupted();
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
      headers: { ...this.deviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: signal ?? null,
    });
  }

  async history(): Promise<any[]> {
    const response = await fetch(`${this.url}/conversation/messages`, { headers: this.deviceHeaders });
    return ((await response.json()) as { messages: any[] }).messages;
  }

  /** What Buddy says first, before the Student has written anything. */
  async opening(): Promise<string> {
    const response = await fetch(`${this.url}/conversation/messages`, { headers: this.deviceHeaders });
    return ((await response.json()) as { opening: string }).opening;
  }

  async profileFacts(): Promise<any[]> {
    const response = await fetch(`${this.url}/profile/facts`, { headers: this.deviceHeaders });
    return ((await response.json()) as { facts: any[] }).facts;
  }

  editFact(id: unknown, text: unknown): Promise<Response> {
    return fetch(`${this.url}/profile/facts/${id}`, {
      method: "PATCH",
      headers: { ...this.deviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  deleteFact(id: unknown): Promise<Response> {
    return fetch(`${this.url}/profile/facts/${id}`, { method: "DELETE", headers: this.deviceHeaders });
  }

  async connections(): Promise<any[]> {
    const response = await fetch(`${this.url}/connections`, { headers: this.deviceHeaders });
    return ((await response.json()) as { connections: any[] }).connections;
  }

  /** Newest first. */
  async activity(): Promise<any[]> {
    const response = await fetch(`${this.url}/activity`, { headers: this.deviceHeaders });
    return ((await response.json()) as { entries: any[] }).entries;
  }

  /** The Student tapping to give the Read Permission on the card. */
  giveReadPermission(connection: string, address: unknown): Promise<any> {
    return fetch(`${this.url}/connections/${connection}/read-permission`, {
      method: "POST",
      headers: { ...this.deviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
  }

  revokeReadPermission(connection: string): Promise<any> {
    return fetch(`${this.url}/connections/${connection}/read-permission`, {
      method: "DELETE",
      headers: this.deviceHeaders,
    });
  }

  /** The Student tapping Read now. */
  readNow(connection: string): Promise<any> {
    return fetch(`${this.url}/connections/${connection}/read`, { method: "POST", headers: this.deviceHeaders });
  }

  /** What the backend's timer does each minute. */
  readDueConnections(): Promise<void> {
    return this.#backend.connections.readDue();
  }

  startSchedule(everyMs: number): void {
    this.#backend.connections.startSchedule(everyMs);
  }

  startTakeover(site: unknown): Promise<Response> {
    return fetch(`${this.url}/takeover`, {
      method: "POST",
      headers: { ...this.deviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ site }),
    });
  }

  async currentTakeover(): Promise<any> {
    const response = await fetch(`${this.url}/takeover`, { headers: this.deviceHeaders });
    return ((await response.json()) as { takeover: any }).takeover;
  }

  /** The Student tapping Done. */
  finishTakeover(): Promise<Response> {
    return fetch(`${this.url}/takeover/done`, { method: "POST", headers: this.deviceHeaders });
  }

  forgetLogin(site: string): Promise<Response> {
    return fetch(`${this.url}/sites/${site}/login`, { method: "DELETE", headers: this.deviceHeaders });
  }

  get actionCards(): RunningBackend["actionCards"] {
    return this.#backend.actionCards;
  }

  /** The Student tapping Approve on a card. */
  approveCard(id: unknown, body: unknown, key: Record<string, string> = this.deviceHeaders): Promise<Response> {
    return fetch(`${this.url}/action-cards/${id}/approve`, {
      method: "POST",
      headers: { ...key, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  }

  /** The Student tapping Decline on a card. */
  declineCard(id: unknown, key: Record<string, string> = this.deviceHeaders): Promise<Response> {
    return fetch(`${this.url}/action-cards/${id}/decline`, { method: "POST", headers: key });
  }

  async card(id: unknown): Promise<any> {
    const response = await fetch(`${this.url}/action-cards/${id}`, { headers: this.deviceHeaders });
    return ((await response.json()) as { card: any }).card;
  }
}
