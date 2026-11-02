import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBrowserAccess, TakeoverInProgress, type Site } from "../../src/browser-access.ts";
import { PageBlocked, type FormToSubmit } from "../../src/buddys-browser.ts";
import { canvasAt } from "../../src/canvas.ts";
import { EXIT_LOGIN_NEEDED, runCanvasCheck } from "../../src/canvas-check.ts";
import { CANVAS_BLOCKED_PAGES, canvasReadablePages } from "../../src/canvas-rules.ts";
import type { ConnectionType } from "../../src/connections.ts";
import { containerBrowser } from "../../src/container-browser.ts";
import { createGuardPolicy } from "../../src/network-guard.ts";
import { navigate360At } from "../../src/navigate360.ts";
import { runNavigate360Check } from "../../src/navigate360-check.ts";
import { isNavigate360LoginPage } from "../../src/navigate360-pages.ts";
import { NAVIGATE360_BLOCKED_PAGES, navigate360Home, navigate360ReadablePages } from "../../src/navigate360-rules.ts";
import { keepToReadablePages } from "../../src/readable-pages.ts";
import { startBackend, type RunningBackend } from "../../src/server.ts";
import { openStore } from "../../src/store.ts";
import { systemClock } from "../../src/clock.ts";
import { partToRead, tuportalAt } from "../../src/tuportal.ts";
import { runTuportalCheck } from "../../src/tuportal-check.ts";
import { readBalancePage, readHoldsPage } from "../../src/tuportal-pages.ts";
import { isTuportalLoginPage, tuportalBlockedPages, tuportalReadablePages } from "../../src/tuportal-rules.ts";
import { tumailAt } from "../../src/tumail.ts";
import { runTumailCheck } from "../../src/tumail-check.ts";
import { TUMAIL_ID, tumailReadablePages, tumailReadOnlyRequests } from "../../src/tumail-rules.ts";

const browserDirectory = fileURLToPath(new URL("../../../browser", import.meta.url));
const CONTROL_PORT = 19222;
const LIVE_VIEW_PORT = 16080;
const controlUrl = `http://127.0.0.1:${CONTROL_PORT}`;

// Two sites on the container's own loopback. Cookies are kept per host, so they don't share a login.
const SITE: Site = {
  name: "Test site",
  homeUrl: "http://127.0.0.1:8000/home",
  loginHosts: ["127.0.0.1"],
  readOnlyRequests: [{ method: "POST", host: "127.0.0.1", path: /^\/search$/ }],
  blockedPages: [{ path: /^\/quizzes(\/|$)/ }],
  formPages: [{ path: /^\/form-page/ }],
};
const OTHER_SITE: Site = { name: "Other site", homeUrl: "http://localhost:8000/home", loginHosts: ["localhost"] };
const SITES = { site: SITE, other: OTHER_SITE };
/** On the container's own loopback too. 127.0.0.3 is listed nowhere, so nothing may reach it. */
const PUBLIC_HOST = "127.0.0.2";
const siteConnection: ConnectionType = {
  id: "site",
  name: "Test site",
  card: { reads: ["Everything."], notes: [], warning: null, address: null },
  whileOnTellClaude: "Nothing to do.",
  read: async () => [],
  describeForClaude: () => "Nothing.",
};

function compose(...args: string[]): string {
  return execFileSync(
    "docker",
    ["compose", "-p", "buddys-browser-check", "-f", "compose.yaml", "-f", "compose.test.yaml", ...args],
    {
      cwd: browserDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BUDDY_BROWSER_CONTROL_PORT: String(CONTROL_PORT),
        BUDDY_BROWSER_LIVE_VIEW_PORT: String(LIVE_VIEW_PORT),
      },
    },
  );
}

async function untilBrowserAnswers(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const answered = await fetch(`${controlUrl}/json/version`).then((r) => r.ok, () => false);
    if (answered) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Buddy's Browser never answered");
}

function startTestPages(): void {
  compose("exec", "-d", "browser", "python3", "/test-pages/server.py");
}

async function untilTestPagesAnswer(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      compose("exec", "browser", "python3", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/login')");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("The test pages never answered");
}

async function restartContainer(): Promise<void> {
  compose("restart", "browser");
  await untilBrowserAnswers();
  startTestPages();
  await untilTestPagesAnswer();
}

const browser = containerBrowser({
  controlUrl,
  liveView: { host: "127.0.0.1", port: LIVE_VIEW_PORT },
});
/** The guard's rules with every Read Permission given, for checks that go straight to the browser. */
const guards = createGuardPolicy({ sites: SITES, publicHosts: [PUBLIC_HOST], hasReadPermission: () => true });
const read = (url: string) => browser.read(url, guards.forReading());

interface LedgerEntry {
  method: string;
  path: string;
  host: string;
  body: string;
}

/** What really reached the test pages, whatever the browser says about it. */
function ledger(): LedgerEntry[] {
  const out = compose(
    "exec",
    "browser",
    "python3",
    "-c",
    "import urllib.request as u; print(u.urlopen('http://127.0.0.1:8000/ledger').read().decode())",
  );
  return JSON.parse(out) as LedgerEntry[];
}

function clearLedger(): void {
  compose("exec", "browser", "python3", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/ledger/clear')");
}

const changesInLedger = () => ledger().filter((entry) => !["GET", "HEAD", "OPTIONS"].includes(entry.method));
const pathsThatChanged = () => changesInLedger().map((entry) => entry.path);
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));
const page = (path: string) => new URL(path, SITE.homeUrl).href;

const FORM: FormToSubmit = {
  pageUrl: page("/form-page"),
  actionUrl: page("/forms/send"),
  form: "advising",
  button: "Send",
  fields: [
    { name: "subject", value: "Meeting" },
    { name: "note", value: "Line one\nLine two" },
    { name: "kind", value: "other" },
    { name: "urgent", value: "yes" },
  ],
  pageFills: ["token"],
};
const formOn = (path: string, more: Partial<FormToSubmit> = {}): FormToSubmit => ({ ...FORM, pageUrl: page(path), ...more });

let directory: string;
let backend: RunningBackend;
let deviceHeaders: Record<string, string>;

async function bootBackend(): Promise<void> {
  backend = await startBackend({
    adapters: {
      claude: { stream: () => { throw new Error("Claude isn't part of these checks"); } },
      clock: systemClock,
      browser,
      web: { get: () => { throw new Error("The web isn't part of these checks"); } },
    },
    sites: SITES,
    publicHosts: [PUBLIC_HOST],
    connectionTypes: [siteConnection],
    allowedHosts: ["127.0.0.1"],
    databasePath: join(directory, "buddy.sqlite"),
    chatModel: "unused",
    crisisCheck: { model: "unused", timeoutMs: 0 },
    discovery: { model: "unused", offices: [], milestoneOffices: [] },
    host: "127.0.0.1",
    port: 0,
    logger: false,
  });
}

const startTakeover = (site: string) =>
  fetch(`${backend.url}/takeover`, {
    method: "POST",
    headers: { ...deviceHeaders, "content-type": "application/json" },
    body: JSON.stringify({ site }),
  });
const finishTakeover = () => fetch(`${backend.url}/takeover/done`, { method: "POST", headers: deviceHeaders });
const giveReadPermission = () =>
  fetch(`${backend.url}/connections/site/read-permission`, {
    method: "POST",
    headers: { ...deviceHeaders, "content-type": "application/json" },
    body: "{}",
  });
const revokeReadPermission = () =>
  fetch(`${backend.url}/connections/site/read-permission`, { method: "DELETE", headers: deviceHeaders });

/** Makes a card the way Claude's tool does. This backend has no Claude. */
function cardFor(form: FormToSubmit) {
  return backend.actionCards.request(
    {
      kind: "submit_form",
      site: "site",
      page_url: form.pageUrl,
      action_url: form.actionUrl,
      form: form.form,
      button: form.button,
      fields: form.fields,
      page_fills: form.pageFills,
    },
    { afterMessageId: 0 },
  );
}

const tapApprove = (card: { id: number; fingerprint: string }) =>
  fetch(`${backend.url}/action-cards/${card.id}/approve`, {
    method: "POST",
    headers: { ...deviceHeaders, "content-type": "application/json" },
    body: JSON.stringify({ fingerprint: card.fingerprint }),
  });

/** Logs the browser in to a site through a Takeover. The test page's /login stands in for the Student. */
async function logIn(site: typeof SITE): Promise<void> {
  await browser.show(new URL("/login", site.homeUrl).href);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

beforeAll(async () => {
  compose("down", "--volumes");
  compose("up", "--detach", "--build", "--wait");
  await untilBrowserAnswers();
  startTestPages();
  await untilTestPagesAnswer();
  directory = mkdtempSync(join(tmpdir(), "buddy-container-"));
  await bootBackend();
  const paired = await fetch(`${backend.url}/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: backend.devices.newPairingCode().code }),
  });
  const { deviceKey } = (await paired.json()) as { deviceKey: string };
  deviceHeaders = { authorization: `Bearer ${deviceKey}` };
  await giveReadPermission();
});

afterAll(async () => {
  await backend?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  compose("down", "--volumes");
});

beforeEach(async () => {
  await browser.forgetLogin(["127.0.0.1", "localhost"]);
  clearLedger();
});

describe("the network guard while reading", () => {
  it("stops every request from a page that changes something, and lets it read", async () => {
    const reading = await read(page("/active"));
    await settle();

    expect(reading.title).toBe("Active");
    const paths = ledger().map((entry) => entry.path);
    expect(paths).toContain("/active");
    expect(paths).toContain("/img-ok");
    expect(paths).toContain("/frame-same");
    expect(pathsThatChanged()).toEqual(["/search"]);
  });

  it("stops requests from a frame on another site, as well as its own", async () => {
    await read(page("/active"));
    await settle();

    const seen = ledger();
    // The other site's frame did load, so its script did run. Only its POST was stopped.
    expect(seen.some((entry) => entry.path === "/frame-other" && entry.host.startsWith(PUBLIC_HOST))).toBe(true);
    expect(seen.map((entry) => entry.path)).not.toContain("/from-other-frame");
    expect(seen.map((entry) => entry.path)).not.toContain("/from-frame");
  });

  it("stops requests from a worker", async () => {
    await read(page("/active"));
    await settle();

    const seen = ledger().map((entry) => entry.path);
    expect(seen).toContain("/worker-ran");
    expect(seen).not.toContain("/from-worker");
    expect(seen).not.toContain("/socket-from-worker");
  });

  it("stops requests and sockets from a worker a worker started", async () => {
    await read(page("/active"));
    await settle();

    const seen = ledger().map((entry) => entry.path);
    expect(seen).toContain("/nested-worker-ran");
    expect(seen).not.toContain("/from-nested-worker");
    expect(seen).not.toContain("/socket-from-nested-worker");
  });

  it("doesn't let a page leave a service worker behind, which could run once the guard has let go", async () => {
    await read(page("/has-service-worker"));
    await settle(1500);

    const seen = ledger().map((entry) => entry.path);
    expect(seen).toContain("/has-service-worker");
    expect(seen).not.toContain("/from-service-worker");
    const targets = (await (await fetch(`${controlUrl}/json/list`)).json()) as { type: string }[];
    expect(targets.filter((target) => target.type === "service_worker")).toEqual([]);
  });

  it("stops requests from a service worker the Student's own browsing left there", async () => {
    await startTakeover("site");
    const connected = await chromium.connectOverCDP(controlUrl);
    const [screen] = connected.contexts()[0]!.pages();
    await screen!.goto(page("/has-service-worker"));
    await screen!.waitForFunction(`document.title === "Registered"`);
    await settle();
    await connected.close();
    await finishTakeover();
    clearLedger();

    try {
      await read(page("/has-service-worker"));
      await settle();

      expect(ledger().map((entry) => entry.path)).toContain("/has-service-worker");
      expect(pathsThatChanged()).toEqual([]);
    } finally {
      const again = await chromium.connectOverCDP(controlUrl);
      const cleaning = await again.contexts()[0]!.newPage();
      await cleaning.goto(page("/forms/landing"));
      await cleaning.evaluate(`navigator.serviceWorker.getRegistrations().then((all) => Promise.all(all.map((one) => one.unregister())))`);
      await cleaning.close();
      await again.close();
      // An unregistered worker can linger, and would look like something left attached to the browser.
      const targets = (await (await fetch(`${controlUrl}/json/list`)).json()) as { id: string; type: string }[];
      for (const { id } of targets.filter((target) => target.type === "service_worker")) {
        await fetch(`${controlUrl}/json/close/${id}`);
      }
      await settle();
    }
  });

  it("doesn't let a WebSocket open, because it could change anything", async () => {
    await read(page("/active"));
    await settle();

    expect(ledger().map((entry) => entry.path)).not.toContain("/socket");
  });

  it("allows only what's on the site's own read-only list", async () => {
    await read(page("/active"));
    await settle();

    const paths = pathsThatChanged();
    expect(paths).toContain("/search");
    expect(paths).not.toContain("/search-ish");
  });

  it("opens a listed public page", async () => {
    const reading = await read(`http://${PUBLIC_HOST}:8000/public`);

    expect(reading.title).toBe("Public page");
  });

  it("refuses to open anywhere else, and nothing reaches it", async () => {
    await expect(read("http://127.0.0.3:8000/secret")).rejects.toThrow(PageBlocked);

    expect(ledger()).toEqual([]);
  });

  it("refuses a redirect to anywhere else, which Playwright alone wouldn't have asked about", async () => {
    await expect(read(page("/redirect-away"))).rejects.toThrow(PageBlocked);

    expect(ledger().map((entry) => entry.path)).toEqual(["/redirect-away"]);
  });

  it("follows a redirect to somewhere allowed", async () => {
    const reading = await read(page("/redirect-to-public"));

    expect(reading.title).toBe("Public page");
  });

  it("doesn't let a page load something from a private address", async () => {
    await read(page("/private-resource"));
    await settle();

    expect(ledger().map((entry) => entry.path)).not.toContain("/from-private");
  });

  it("lets a page load an image and a frame from a public address nobody listed", async () => {
    await read(page("/public-resources"));
    await settle();

    const fromThere = ledger().filter((entry) => entry.host.startsWith("cdn.elsewhere.test"));
    expect(fromThere.map((entry) => entry.path).sort()).toEqual(["/frame-same", "/img-ok"]);
  });

  it("doesn't open that same address as a page", async () => {
    await expect(read("http://cdn.elsewhere.test:8000/public")).rejects.toThrow(PageBlocked);

    expect(ledger()).toEqual([]);
  });

  it("doesn't let a page's own script take the tab there", async () => {
    await read(page("/link-away")).catch(() => {});
    await settle();

    expect(ledger().filter((entry) => entry.host.startsWith("cdn.elsewhere.test"))).toEqual([]);
  });

  it("refuses a blocked page", async () => {
    await expect(read(page("/quizzes/1"))).rejects.toThrow(PageBlocked);

    expect(ledger()).toEqual([]);
  });

  it("refuses a redirect to a blocked page", async () => {
    await expect(read(page("/redirect-to-quiz"))).rejects.toThrow(PageBlocked);

    expect(ledger().map((entry) => entry.path)).toEqual(["/redirect-to-quiz"]);
  });
});

describe("reading a Connection with no Read Permission", () => {
  afterAll(async () => {
    await giveReadPermission();
  });

  it("is refused, while the login check at Done still works", async () => {
    await logIn(SITE);
    await revokeReadPermission();
    clearLedger();

    await expect(backend.browserAccess.read(SITE.homeUrl)).rejects.toThrow(PageBlocked);
    expect(ledger()).toEqual([]);

    await startTakeover("site");
    const finished = (await (await finishTakeover()).json()) as any;

    expect(finished).toMatchObject({ signedIn: true, title: "Dashboard" });
    await giveReadPermission();
  });
});

describe("the form-submit routine", () => {
  it("submits exactly what the card says, once, carrying the page's hidden fields", async () => {
    const submission = await browser.submitForm(FORM, guards.forApprovedStep());
    await settle();

    expect(submission).toEqual({ outcome: "submitted", status: 303 });
    const changes = changesInLedger();
    expect(changes.map((entry) => entry.path)).toEqual(["/forms/send"]);
    expect(Object.fromEntries(new URLSearchParams(changes[0]!.body))).toEqual({
      token: "from-the-page",
      subject: "Meeting",
      note: "Line one\r\nLine two",
      kind: "other",
      urgent: "yes",
    });
  });

  it("carries the button's own value when the card names that button", async () => {
    await browser.submitForm({ ...FORM, button: "Save draft", pageFills: ["token", "draft"] }, guards.forApprovedStep());
    await settle();

    expect(new URLSearchParams(changesInLedger()[0]!.body).get("draft")).toBe("1");
  });

  it("leaves a checkbox unticked when the card's value for it is empty", async () => {
    const fields = FORM.fields.map((field) => (field.name === "urgent" ? { ...field, value: "" } : field));

    await browser.submitForm({ ...FORM, fields }, guards.forApprovedStep());
    await settle();

    expect(new URLSearchParams(changesInLedger()[0]!.body).has("urgent")).toBe(false);
  });

  it.each([
    ["has a field the card doesn't", formOn("/form-page-extra-field"), /cc/],
    ["lacks a field the card has", formOn("/form-page-missing-field"), /note/],
    ["has a hidden field the card doesn't", formOn("/form-page-extra-hidden-field"), /hidden field.*to/],
    ["lacks a hidden field the card has", { ...FORM, pageFills: ["token", "another"] }, /hidden field.*another/],
    ["has a button that sends a value the card doesn't list", { ...FORM, button: "Save draft" }, /hidden field.*draft/],
    ["now sends somewhere else", formOn("/form-page-elsewhere"), /somewhere other/],
    ["no longer sends by POST", formOn("/form-page-gets"), /POST/],
    ["has a password field", formOn("/form-page-password"), /never fills in/],
    ["has no such form", { ...FORM, form: "another" }, /0 forms/],
    ["has no such button", { ...FORM, button: "Delete" }, /0 buttons/],
    ["can't take a value on the card", { ...FORM, fields: [...FORM.fields.slice(0, 2), { name: "kind", value: "nope" }, FORM.fields[3]!] }, /kind/],
    ["sent the browser somewhere else", formOn("/redirect-to-public"), /somewhere else/],
  ])("doesn't submit when the page %s", async (_, form, problem) => {
    const guard = guards.forApprovedStep();

    const submission = await browser.submitForm(form, guard);
    await settle(200);

    expect(submission.outcome).toBe("form_changed");
    expect((submission as { problems: string[] }).problems.join(" ")).toMatch(problem);
    expect(guard.progress()).toBe("disarmed");
    expect(changesInLedger()).toEqual([]);
  });

  it("stops the request when the page changes a value at the last moment", async () => {
    const submission = await browser.submitForm(formOn("/form-page-swaps-value"), guards.forApprovedStep());
    await settle(200);

    expect(submission.outcome).toBe("not_sent");
    expect(changesInLedger()).toEqual([]);
  });

  it("lets through the form and stops what else the page tries to send with it", async () => {
    const submission = await browser.submitForm(formOn("/form-page-sends-more"), guards.forApprovedStep());
    await settle();

    expect(submission.outcome).toBe("submitted");
    expect(pathsThatChanged()).toEqual(["/forms/send"]);
  });

  it("lets one request through when the page tries to send the form three times", async () => {
    await browser.submitForm(formOn("/form-page-sends-twice"), guards.forApprovedStep());
    await settle();

    expect(pathsThatChanged()).toEqual(["/forms/send"]);
  });

  it("says nothing was sent when pressing the button sends nothing", async () => {
    const guard = guards.forApprovedStep();

    const submission = await browser.submitForm(formOn("/form-page-refuses"), guard);

    expect(submission.outcome).toBe("not_sent");
    expect(guard.progress()).toBe("armed");
    expect(changesInLedger()).toEqual([]);
  });

  it("can't tell, and says so, when the site answers with an error", async () => {
    const form = formOn("/form-page-to-error", { actionUrl: page("/forms/error") });

    const submission = await browser.submitForm(form, guards.forApprovedStep());
    await settle(200);

    expect(submission).toEqual({ outcome: "no_clear_answer" });
    expect(pathsThatChanged()).toEqual(["/forms/error"]);
  });

  it("lets the one request through but not a redirect that would send it again", async () => {
    const form = formOn("/form-page-redirects-post", { actionUrl: page("/forms/307") });

    await browser.submitForm(form, guards.forApprovedStep());
    await settle();

    expect(pathsThatChanged()).toEqual(["/forms/307"]);
  });

  it("won't open a blocked page, even armed", async () => {
    await expect(browser.submitForm(formOn("/quizzes/1"), guards.forApprovedStep())).rejects.toThrow(PageBlocked);

    expect(ledger()).toEqual([]);
  });

  it("won't submit to a blocked page, even armed with an approved card for exactly that", async () => {
    const form = formOn("/form-page-to-quiz", { actionUrl: page("/quizzes/1/submit") });

    const submission = await browser.submitForm(form, guards.forApprovedStep());
    await settle(200);

    expect(submission.outcome).toBe("not_sent");
    expect(changesInLedger()).toEqual([]);
  });
});

describe("the whole way from a card to the page", () => {
  it("doesn't submit anything until the Approve tap", async () => {
    cardFor(FORM);
    await settle(200);

    expect(ledger()).toEqual([]);
  });

  it("submits once for Approve tapped twice, with what the card showed", async () => {
    const card = cardFor(FORM);

    const answers = await Promise.all([tapApprove(card), tapApprove(card)]);
    await settle();

    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    expect(pathsThatChanged()).toEqual(["/forms/send"]);
    expect(new URLSearchParams(changesInLedger()[0]!.body).get("subject")).toBe("Meeting");
    expect(backend.actionCards.get(card.id)).toMatchObject({ status: "done" });
  });

  it("doesn't submit when the form no longer matches, and the card says so", async () => {
    const card = cardFor(formOn("/form-page-extra-field"));

    const answer = (await (await tapApprove(card)).json()) as { card: any };
    await settle(200);

    expect(answer.card.status).toBe("not_run");
    expect(answer.card.outcome).toMatch(/no longer matches/);
    expect(changesInLedger()).toEqual([]);
  });

  it("won't take an Approve during a Takeover, and works again after Done", async () => {
    const card = cardFor(FORM);
    await startTakeover("site");

    expect((await tapApprove(card)).status).toBe(409);
    await settle(200);
    expect(changesInLedger()).toEqual([]);

    await finishTakeover();
    expect((await tapApprove(card)).status).toBe(200);
    await settle();
    expect(pathsThatChanged()).toEqual(["/forms/send"]);
  });
});

describe("the guard around a Takeover", () => {
  /** Stands in for the Student's fingers in the live view. */
  async function asTheStudent(work: (screen: Page) => Promise<void>): Promise<void> {
    const connected = await chromium.connectOverCDP(controlUrl);
    const [screen] = connected.contexts()[0]!.pages();
    await work(screen!);
    await connected.close();
  }

  it("steps aside, so that the Student's own submit goes through", async () => {
    await startTakeover("site");

    await asTheStudent(async (screen) => {
      await screen.goto(page("/form-page"));
      await screen.fill('[name="subject"]', "From the Student");
      await screen.fill('[name="note"]', "Typed myself");
      await screen.getByRole("button", { name: "Send", exact: true }).click();
      await screen.waitForURL(/forms\/sent/);
    });

    expect(pathsThatChanged()).toEqual(["/forms/send"]);
    await finishTakeover();
  });

  it("isn't there at all, so a page the Student opens does what it does, as in any browser", async () => {
    await startTakeover("site");

    await asTheStudent(async (screen) => {
      await screen.goto(page("/active"));
    });
    await settle();

    expect(pathsThatChanged()).toContain("/changes");
    await finishTakeover();
  });

  it("is back as soon as the Student taps Done", async () => {
    await startTakeover("site");
    await finishTakeover();
    clearLedger();

    await backend.browserAccess.read(page("/active"));
    await settle();

    expect(ledger().map((entry) => entry.path)).toContain("/active");
    expect(pathsThatChanged()).toEqual(["/search"]);
  });

  it("leaves nothing from the Student's pages still running after Done", async () => {
    await startTakeover("site");
    await asTheStudent(async (screen) => {
      await screen.goto(page("/ticking"));
      // While still connected: a worker starting just as this connection closes may never run.
      await settle();
    });
    expect(ledger().map((entry) => entry.path)).toContain("/tick");

    await finishTakeover();
    await settle(200);
    clearLedger();
    await settle(1000);

    expect(ledger()).toEqual([]);
  });

  it("stops what the page left on the screen tries to send as it's cleared at Done", async () => {
    await startTakeover("site");
    await asTheStudent(async (screen) => {
      await screen.goto(page("/form-page"));
      await screen.evaluate(`addEventListener('pagehide', () => navigator.sendBeacon('/left-behind', 'x=1'))`);
    });

    await finishTakeover();
    await settle();

    expect(pathsThatChanged()).toEqual([]);
  });

});

describe("how the container is kept apart", () => {
  it("runs Chromium with its own sandbox on", async () => {
    // Directly: the guard doesn't let Buddy go to chrome:// pages.
    const connected = await chromium.connectOverCDP(controlUrl);
    const page = await connected.contexts()[0]!.newPage();
    await page.goto("chrome://sandbox");
    const text = await page.locator("body").innerText();
    await page.close();
    await connected.close();

    expect(text).toMatch(/You are adequately sandboxed/i);
  });

  it("mounts no folder from the laptop except the read-only test pages", () => {
    const [container] = JSON.parse(compose("ps", "--format", "json", "--no-trunc").split("\n")[0]!.startsWith("[") ? compose("ps", "--format", "json") : `[${compose("ps", "--format", "json").trim().split("\n").join(",")}]`);
    const mounts = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .Mounts}}", container.Name], { encoding: "utf8" })) as any[];

    const fromLaptop = mounts.filter((mount) => mount.Type === "bind");
    expect(fromLaptop.map((mount) => mount.Destination)).toEqual(["/test-pages"]);
    expect(fromLaptop[0].RW).toBe(false);
  });

  it("can't get answers from the backend through Docker's address for this laptop", () => {
    const { port } = new URL(backend.url);
    // The backend only listens on 127.0.0.1 here, the same as in real use.
    const status = compose(
      "exec",
      "browser",
      "python3",
      "-c",
      `
import urllib.request, urllib.error
try:
    print(urllib.request.urlopen("http://host.docker.internal:${port}/conversation/messages", timeout=5).status)
except urllib.error.HTTPError as error:
    print(error.code)
except Exception:
    print("unreachable")
`,
    ).trim();

    expect(["403", "unreachable"]).toContain(status);
  });

  it("runs as an ordinary user with no capabilities", () => {
    expect(compose("exec", "browser", "id", "-u").trim()).not.toBe("0");
    const capabilities = compose("exec", "browser", "sh", "-c", "grep CapEff /proc/1/status").trim();
    expect(capabilities).toMatch(/0000000000000000$/);
  });
});

describe("reading pages", () => {
  it("loads a page and reads its title, text and accessibility snapshot", async () => {
    await logIn(SITE);

    const reading = await read(SITE.homeUrl);

    expect(reading.url).toBe(SITE.homeUrl);
    expect(reading.title).toBe("Dashboard");
    expect(reading.text).toContain("Your courses");
    expect(reading.accessibilitySnapshot).toContain('heading "Dashboard"');
    expect(reading.accessibilitySnapshot).toContain('button "Open a course"');
  });

  it("follows the site to its login page when the Student isn't logged in", async () => {
    const reading = await read(SITE.homeUrl);

    expect(reading.url).toContain("/login-required");
    expect(reading.title).toBe("Please log in");
  });
});

describe("during a Takeover", () => {
  it("gives Buddy no snapshots, and nothing stays attached to the browser", async () => {
    expect((await startTakeover("site")).status).toBe(200);

    await expect(backend.browserAccess.read(SITE.homeUrl)).rejects.toThrow(TakeoverInProgress);

    const targets = (await (await fetch(`${controlUrl}/json/list`)).json()) as { type: string; url: string }[];
    // Only tabs: a worker from a page the screen has moved on from can still be listed. See the check
    // that nothing keeps running after Done.
    const tabs = targets.filter((target) => target.type === "page" && target.url.startsWith("http"));
    expect(tabs.map((target) => target.url)).toEqual([expect.stringMatching(/\/(home|login-required)$/)]);

    await finishTakeover();
  });

  it("carries the live view through the backend, and cuts it off at Done", async () => {
    const { takeover } = (await (await startTakeover("site")).json()) as { takeover: { liveViewPath: string } };
    const base = takeover.liveViewPath.replace(/takeover\.html$/, "");

    const page = await fetch(`${backend.url}${takeover.liveViewPath}`, { headers: deviceHeaders });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("core/rfb.js");
    const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
    expect((await fetch(`${backend.url}${base}core/rfb.js`, { headers: { cookie } })).status).toBe(200);

    const { hostname, port } = new URL(backend.url);
    const socket = connect(Number(port), hostname);
    let received = "";
    socket.on("data", (bytes) => (received += bytes.toString("latin1")));
    socket.on("error", () => {});
    const closed = new Promise((resolve) => socket.on("close", resolve));
    socket.write(
      `GET ${base}websockify HTTP/1.1\r\nHost: ${hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Cookie: ${cookie}\r\n` +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: binary\r\n\r\n",
    );
    for (let attempt = 0; attempt < 100 && !received.includes("RFB 00"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // The VNC server's greeting, having come from inside the container through the backend.
    expect(received).toContain("101 Switching Protocols");
    expect(received).toContain("RFB 00");

    await finishTakeover();
    await closed;
  });

  it("shows the login, and proves it after Done by reading the site", async () => {
    await logIn(SITE);
    await startTakeover("site");

    const finished = (await (await finishTakeover()).json()) as any;

    expect(finished).toEqual({ site: "site", siteName: "Test site", signedIn: true, title: "Dashboard" });
  });
});

describe("logins", () => {
  it("survive a restart of the backend", async () => {
    await logIn(SITE);

    await backend.close();
    await bootBackend();

    expect((await backend.browserAccess.read(SITE.homeUrl)).title).toBe("Dashboard");
  });

  it("survive a restart of the container, even session cookies", async () => {
    await logIn(SITE);
    // No waiting: Chromium only writes cookies every 30 seconds unless it's closed properly.

    await restartContainer();

    expect((await read(SITE.homeUrl)).title).toBe("Dashboard");
  });

  it("can be forgotten one site at a time", async () => {
    await logIn(SITE);
    await logIn(OTHER_SITE);

    const response = await fetch(`${backend.url}/sites/site/login`, { method: "DELETE", headers: deviceHeaders });

    expect(response.status).toBe(204);
    expect((await read(SITE.homeUrl)).title).toBe("Please log in");
    expect((await read(OTHER_SITE.homeUrl)).title).toBe("Dashboard");
  });

  it("forgets cookies set on a parent domain or a subdomain, and leaves unrelated ones", async () => {
    const connected = await chromium.connectOverCDP(controlUrl);
    const context = connected.contexts()[0]!;
    await context.addCookies(
      [".temple.test", ".sub.fim.temple.test", "fim.temple.test", "other.temple.test", ".elsewhere.test"].map(
        (domain) => ({ name: "session", value: "1", domain, path: "/" }),
      ),
    );

    await browser.forgetLogin(["fim.temple.test"]);

    const left = (await context.cookies()).map((cookie) => cookie.domain).filter((domain) => domain.endsWith(".test"));
    await context.clearCookies({ domain: /\.test$/ });
    await connected.close();
    // A host-only cookie for a sibling isn't sent to this site, so it stays.
    expect(left.sort()).toEqual([".elsewhere.test", "other.temple.test"]);
  });

  it("stay forgotten after the container restarts", async () => {
    await logIn(SITE);
    await browser.forgetLogin(SITE.loginHosts);

    await restartContainer();

    expect((await read(SITE.homeUrl)).title).toBe("Please log in");
  });
});

describe("the Canvas reader, against made-up pages in the real browser", () => {
  const HOST = "127.0.0.4";
  const HOME = `http://${HOST}:8000/`;
  const CANVAS_SITE: Site = {
    name: "Canvas",
    homeUrl: HOME,
    loginHosts: [HOST],
    isConnection: true,
    readablePages: canvasReadablePages(HOST),
    blockedPages: CANVAS_BLOCKED_PAGES,
    formPages: [{ path: /^\/form-page/ }],
  };
  const sites = { canvas: CANVAS_SITE };
  const canvasGuards = createGuardPolicy({ sites, publicHosts: [], hasReadPermission: () => true });
  const readCanvas = (path: string) => browser.read(new URL(path, HOME).href, keepToReadablePages(canvasGuards.forReading(), sites));
  const logInToCanvas = async () => {
    await browser.show(`${HOME}made-up-canvas-login`);
    await settle(300);
  };
  const visited = () => ledger().filter((entry) => entry.host.startsWith(HOST)).map((entry) => `${entry.method} ${entry.path}`);

  async function runCheck() {
    const lines: string[] = [];
    const exitCode = await runCanvasCheck({
      browser,
      connection: canvasAt(HOME),
      sites,
      student: () => ({ hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: false }),
      print: (line) => lines.push(line),
    });
    return { exitCode, output: lines.join("\n") };
  }

  beforeEach(async () => {
    await browser.forgetLogin([HOST]);
    clearLedger();
  });

  it("reads through the real guard, and what a page fetches for itself after it loads is there to read", async () => {
    await logInToCanvas();

    const { exitCode, output } = await runCheck();

    expect(exitCode).toBe(0);
    expect(output).toMatch(/courses: 2\b/);
    expect(output).toMatch(/assignments: 2\b/);
    expect(output).toMatch(/due dates: 2\b/);
    expect(output).toMatch(/grades: 2\b/);
    expect(output).toMatch(/announcements: 1\b/);
  });

  it("opens only the allowed pages, and nothing a page tries to load that's blocked gets out", async () => {
    await logInToCanvas();
    clearLedger();

    await runCheck();
    await settle();

    const requests = visited();
    expect(requests).toEqual(
      expect.arrayContaining([
        "GET /courses",
        "GET /courses/101/assignments",
        "GET /courses/101/grades",
        "GET /courses/101/announcements",
        "GET /courses/102/assignments",
        "GET /courses/102/announcements",
        "GET /api/v1/courses/101/assignment_groups",
      ]),
    );
    expect(requests.filter((request) => /quizzes|\/users|discussion_topics|submissions/.test(request))).toEqual([]);
    expect(requests.filter((request) => !request.startsWith("GET "))).toEqual([]);
    // Redirected there by the grades page, which the guard refused to follow.
    expect(requests).not.toContain("GET /courses/102");
  });

  it("prints what the guard refused, and no marker, whatever the real page held", async () => {
    await logInToCanvas();

    const { output } = await runCheck();

    expect(output).toContain(`POST ${HOST} /api/graphql`);
    expect(output).toContain(`GET ${HOST} /courses/:id/users`);
    expect(output).toContain(`GET ${HOST} /courses/:id/quizzes/:id`);
    expect(output).toContain("/courses/:id/assignments");
    // The page the reader didn't recognize, as the real browser left it.
    expect(output).toContain("div.made-up-new-layout role=region [data-course]");
    expect(output).toContain("h2.made-up-heading");
    expect(output).toContain("div.user_content (not looked inside)");
    expect(output).not.toMatch(/marker/i);
    expect(output).not.toContain("18");
    expect(output).not.toContain("91.2");
  });

  it("says the login has expired, and goes no further", async () => {
    const { exitCode, output } = await runCheck();
    await settle();

    expect(exitCode).toBe(4);
    expect(output).toMatch(/Login: not logged in/);
    expect(output).not.toMatch(/marker/i);
    expect(visited().filter((request) => request.includes("/courses/101"))).toEqual([]);
  });

  it.each([
    "/courses/101/quizzes/30",
    "/courses/101/users",
    "/courses/101/discussion_topics/900",
    "/groups/8",
    "/courses/101/assignments/501",
    "/courses/101/assignments/501/submissions",
    "/courses/101",
    "/profile",
  ])("refuses %s, and nothing reaches the site", async (path) => {
    await logInToCanvas();
    clearLedger();

    await expect(readCanvas(path)).rejects.toThrow(PageBlocked);

    expect(visited()).toEqual([]);
  });

  it("refuses a redirect to a quiz, and nothing reaches the quiz", async () => {
    await logInToCanvas();
    await expect(
      browser.read(`${HOME}courses/101/grades-redirects-to-quiz`, canvasGuards.forReading()),
    ).rejects.toThrow(PageBlocked);

    expect(visited().filter((request) => request.includes("quizzes"))).toEqual([]);
  });

  it("refuses to send graded work, even with the guard armed for exactly that request", async () => {
    await logInToCanvas();
    clearLedger();
    const form: FormToSubmit = {
      ...FORM,
      pageUrl: `${HOME}form-page-to-graded-work`,
      actionUrl: `${HOME}courses/101/assignments/501/submissions`,
    };

    const outcome = await browser.submitForm(form, canvasGuards.forApprovedStep());
    await settle();

    expect(outcome.outcome).not.toBe("submitted");
    expect(visited().filter((request) => request.startsWith("POST"))).toEqual([]);
  });

  it("refuses the page of a piece of graded work, even with a guard for an approved step", async () => {
    await logInToCanvas();
    clearLedger();
    const form: FormToSubmit = {
      ...FORM,
      pageUrl: `${HOME}courses/101/assignments/501/submit`,
      actionUrl: `${HOME}courses/101/assignments/501/submissions`,
    };

    await expect(browser.submitForm(form, canvasGuards.forApprovedStep())).rejects.toThrow(PageBlocked);

    expect(visited()).toEqual([]);
  });
});

describe("the TUportal reader, against made-up pages in the real browser", () => {
  const HOST = "127.0.0.5";
  const HOME = `http://${HOST}:8000/`;
  const BANNER_HOST = "127.0.0.6";
  const BANNER = `http://${BANNER_HOST}:8000/`;
  const TUPORTAL_SITE: Site = {
    name: "TUportal",
    homeUrl: HOME,
    loginHosts: [HOST, BANNER_HOST],
    isConnection: true,
    readablePages: tuportalReadablePages([HOST], BANNER_HOST),
    blockedPages: tuportalBlockedPages([HOST], BANNER_HOST),
    isLoginPage: (address) => isTuportalLoginPage(address, [HOST], BANNER_HOST),
  };
  const sites = { tuportal: TUPORTAL_SITE };
  const portalGuards = createGuardPolicy({ sites, publicHosts: [], hasReadPermission: () => true });
  const readPortal = (path: string) => browser.read(new URL(path, HOME).href, keepToReadablePages(portalGuards.forReading(), sites));
  const logInToTuportal = async () => {
    await browser.show(`${HOME}made-up-tuportal-login`);
    await settle(300);
  };
  const visited = () => ledger().filter((entry) => entry.host.startsWith(HOST) || entry.host.startsWith(BANNER_HOST)).map((entry) => `${entry.method} ${entry.path}`);

  async function runCheck() {
    const lines: string[] = [];
    const exitCode = await runTuportalCheck({
      browser,
      connection: tuportalAt(HOME, [HOST], BANNER),
      sites,
      student: () => ({ hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: false }),
      print: (line) => lines.push(line),
    });
    return { exitCode, output: lines.join("\n") };
  }

  beforeEach(async () => {
    await browser.forgetLogin([HOST, BANNER_HOST]);
    clearLedger();
  });

  it("understands every page through the real guard, including what a page fills in after it loads, and prints nothing from them", async () => {
    await logInToTuportal();

    const { exitCode, output } = await runCheck();

    expect(exitCode).toBe(0);
    expect(output).toMatch(/holds \/prod8\/bwskoacc\.p_viewhold: understood/);
    expect(output).toMatch(/balance \/group\/home\/costs-and-aid: understood/);
    expect(output).not.toMatch(/marker/i);
    expect(output).not.toContain("876");
  });

  it("reads what a frame fills in after it loads, as the real Cost & Aid tab has it", async () => {
    await logInToTuportal();

    const reading = await browser.read(`${HOME}group/home/costs-and-aid`, portalGuards.forReading());

    expect(reading.frames?.map(({ url }) => new URL(url).pathname)).toEqual(["/html/TEMPLE/apps/tup/Channels/index.jsp"]);
    expect(readBalancePage(partToRead("balance", reading))).toEqual({ cents: 87654, credit: false });
  });

  it("nothing a page tries that's blocked gets out, and nothing is ever submitted", async () => {
    await logInToTuportal();
    clearLedger();

    const { output } = await runCheck();
    await settle();

    const requests = visited();
    expect(requests).toContain("GET /prod8/bwskoacc.P_ViewHold");
    expect(requests.filter((request) => /registration|add-drop/.test(request))).toEqual([]);
    expect(requests.filter((request) => !request.startsWith("GET "))).toEqual([]);
    expect(output).toContain(`POST ${BANNER_HOST} /group/home/student-record-services`);
  });

  it("takes an empty message hidden by the stylesheet for what it is, not for no holds", async () => {
    const page = await browser.read(`${HOME}tuportal-hidden-empty-message`, portalGuards.forReading());

    expect(page.html).toContain("No holds exist");
    expect(page.text).not.toContain("No holds exist");
    expect(readHoldsPage(page)).toBeNull();
  });

  it("says the login has expired, and goes no further", async () => {
    const { exitCode, output } = await runCheck();
    await settle();

    expect(exitCode).toBe(4);
    expect(output).toMatch(/Login: not logged in/);
    expect(output).not.toMatch(/marker/i);
    expect(visited().filter((request) => request.includes("P_ViewHold"))).toEqual([]);
  });

  it.each(["/group/home/registration", "/group/home/add-drop", "/group/home/tupay", "/group/home/forms/1", "/c/portal/logout", "/group/home/student-tools"])(
    "refuses %s, and nothing reaches the site",
    async (path) => {
      await logInToTuportal();
      clearLedger();

      await expect(readPortal(path)).rejects.toThrow(PageBlocked);

      expect(visited()).toEqual([]);
    },
  );
});

describe("what the browser never keeps", () => {
  it("saves no passwords or history, because the policies turn them off", async () => {
    const connected = await chromium.connectOverCDP(controlUrl);
    const page = await connected.contexts()[0]!.newPage();
    await page.goto("chrome://policy");
    await page.getByText("PasswordManagerEnabled").first().waitFor({ timeout: 10_000 });
    // The policy page is built from nested shadow roots, so walk them to get its text.
    const text: string = await page.evaluate(`(() => {
      const walk = (node) => {
        let found = node.shadowRoot ? walk(node.shadowRoot) : "";
        for (const child of node.childNodes) found += child.nodeType === 3 ? child.textContent + " " : walk(child);
        return found;
      };
      return walk(document.body);
    })()`);
    await page.close();
    await connected.close();

    const policies = text.replace(/\s+/g, " ");
    expect(policies).toMatch(/PasswordManagerEnabled false/);
    expect(policies).toMatch(/SavingBrowserHistoryDisabled true/);
  });
});

describe("the TUmail reader, against a made-up app in the real browser", () => {
  const HOST = "127.0.0.5";
  const SIGN_IN_HOST = "127.0.0.6";
  const HOME = `http://${HOST}:8000/mail/`;
  const TUMAIL_SITE: Site = {
    name: "TUmail",
    homeUrl: HOME,
    loginHosts: [HOST, SIGN_IN_HOST],
    isConnection: true,
    readablePages: [...tumailReadablePages([HOST]), { host: SIGN_IN_HOST, path: /^\// }],
    readOnlyRequests: tumailReadOnlyRequests([HOST]),
  };
  const logInToOutlook = async () => {
    await browser.show(`http://${HOST}:8000/made-up-outlook-login`);
    await settle(300);
  };
  const visited = () => ledger().filter((entry) => entry.host.startsWith(HOST)).map((entry) => `${entry.method} ${entry.path}`);

  async function runCheck() {
    const lines: string[] = [];
    const exitCode = await runTumailCheck({
      browser,
      connection: tumailAt(HOME),
      sites: { [TUMAIL_ID]: TUMAIL_SITE },
      student: () => ({ hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: false }),
      print: (line) => lines.push(line),
    });
    return { exitCode, output: lines.join("\n") };
  }

  beforeEach(async () => {
    await browser.forgetLogin([HOST, SIGN_IN_HOST]);
    clearLedger();
  });

  it("waits for a list and a message the app builds long after loading, and asks for them by POST through the guard", async () => {
    await logInToOutlook();

    const { exitCode, output } = await runCheck();

    expect(exitCode).toBe(0);
    expect(output).toMatch(/messages in the list: 2\b/);
    expect(output).toMatch(/with a sender's address: 2\b/);
    expect(output).toMatch(/from temple\.edu addresses: 1\b/);
    expect(output).toMatch(/opened: 1\b/);
    expect(output).toMatch(/words read: 1, kept: 1\b/);
    expect(visited()).toContain("POST /owa/service.svc?action=FindConversation&app=Mail");
    expect(visited()).toContain("POST /owa/service.svc?action=GetConversationItems&app=Mail");
  });

  it("opens only what's from a temple.edu address, and nothing it does marks a message read", async () => {
    await logInToOutlook();

    const { output } = await runCheck();

    expect(visited()).toContain("GET /mail/inbox/id/AAQkMadeUpOne%3D");
    expect(visited()).not.toContain("GET /mail/inbox/id/AAQkMadeUpTwo%3D");
    expect(visited().filter((request) => request.includes("UpdateItem") || request.includes("graphql") || request.includes("action=GetItem"))).toEqual([]);
    expect(output).toMatch(/opened while unread: 1\b/);
    expect(output).toMatch(/still unread afterwards: 1\b/);
    expect(output).toContain(`POST ${HOST} /owa/service.svc?action=UpdateItem`);
  });

  it("prints no words, names or addresses from the app, whatever it held", async () => {
    await logInToOutlook();

    const { output } = await runCheck();

    expect(output).not.toMatch(/marker/i);
    expect(output).not.toContain("elsewhere.test");
    expect(output).not.toContain("AAQk");
  });

  it("says the login has gone when Outlook sends the browser to sign in, and goes no further", async () => {
    const { exitCode, output } = await runCheck();

    expect(exitCode).toBe(4);
    expect(output).toContain("Log in to TUmail");
    expect(output).not.toMatch(/marker/i);
    expect(visited()).toEqual(["GET /mail/inbox"]);
  });
});

describe("the Navigate360 reader, against made-up pages in the real browser", () => {
  const HOST = "127.0.0.5";
  const ORIGIN = `http://${HOST}:8000`;
  const NAVIGATE360_SITE: Site = {
    name: "Navigate360",
    homeUrl: navigate360Home(ORIGIN),
    loginHosts: [HOST],
    isConnection: true,
    readablePages: navigate360ReadablePages(HOST),
    blockedPages: NAVIGATE360_BLOCKED_PAGES,
    isLoginPage: (address) => isNavigate360LoginPage(address, HOST),
  };
  const sites = { navigate360: NAVIGATE360_SITE };
  const guards = createGuardPolicy({ sites, publicHosts: [], hasReadPermission: () => true });
  const readingGuard = () => keepToReadablePages(guards.forReading(), sites);
  const logIn = async () => {
    await browser.show(`${ORIGIN}/made-up-navigate360-login`);
    await settle(300);
  };
  const visited = () => ledger().filter((entry) => entry.host.startsWith(HOST)).map((entry) => `${entry.method} ${entry.path}`);

  async function runCheck() {
    const lines: string[] = [];
    const exitCode = await runNavigate360Check({
      browser,
      connection: navigate360At(ORIGIN),
      sites,
      student: () => ({ hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: false }),
      print: (line) => lines.push(line),
    });
    return { exitCode, output: lines.join("\n") };
  }

  beforeEach(async () => {
    await browser.forgetLogin([HOST]);
    clearLedger();
  });

  it("follows the page that picks the version, waits for an app that fetches late, and gets what it fetched", async () => {
    await logIn();

    const { exitCode, output } = await runCheck();

    expect(output).toMatch(/Login: works/);
    expect(exitCode).toBe(0);
    expect(output).toMatch(/App version: v2/);
    expect(output).toMatch(/advisors: 1\b/);
    expect(output).toMatch(/advisors with an address: 1\b/);
    expect(output).toMatch(/Contacts added: 1\b/);
    expect(output).toMatch(/others on the team, not kept: 1\b/);
    expect(output).toMatch(/upcoming appointments: 1\b/);
  });

  it("prints nothing a person wrote or is called, in the real browser's words either", async () => {
    await logIn();

    const { output } = await runCheck();

    expect(output).not.toMatch(/MARKER/i);
  });

  it("shows why the reader can't go by the page: what's drawn isn't in its HTML, though its tree shows it", async () => {
    await logIn();

    const page = await browser.read(`${ORIGIN}/app/v2/#/native/my/home/`, readingGuard());

    expect(page.html).not.toContain("MARKERDRAWN");
    expect(page.accessibilitySnapshot).toMatch(/heading "MARKERDRAWN"/);
  });

  it("says the login is needed when the app sends a browser with none to its login route, on the same site", async () => {
    const { exitCode, output } = await runCheck();

    expect(exitCode).toBe(EXIT_LOGIN_NEEDED);
    expect(output).toMatch(/Log in to Navigate360/);
  });

  it("keeps the part of the address after the # through the redirects, so a login route can be seen", async () => {
    const page = await browser.read(navigate360Home(ORIGIN), readingGuard());

    expect(isNavigate360LoginPage(page.url, HOST)).toBe(true);
    expect(new URL(page.url).hash).toBe("#/authentication/");
  });

  it("lets nothing that changes anything out, whatever the page tries", async () => {
    await logIn();
    clearLedger();

    await runCheck();
    await settle();

    expect(visited().filter((entry) => !entry.startsWith("GET "))).toEqual([]);
    expect(visited()).toContain("GET /api/students/7/support_team");
  });

  it("is refused a booking page before anything opens, by the part of the address a browser never sends", async () => {
    await logIn();
    clearLedger();

    const access = createBrowserAccess({
      browser,
      clock: systemClock,
      store: openStore(":memory:"),
      sites: { navigate360: { ...NAVIGATE360_SITE, isConnection: false } },
      guards,
      onControlEnded: () => {},
      logError: () => {},
    });
    await expect(access.read(`${ORIGIN}/app/v2/#/native/my/apps/as3/appointment-new`)).rejects.toThrow(PageBlocked);

    expect(visited()).toEqual([]);
  });
});
