import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TakeoverInProgress } from "../../src/browser-access.ts";
import { containerBrowser } from "../../src/container-browser.ts";
import { startBackend, type RunningBackend } from "../../src/server.ts";
import { systemClock } from "../../src/clock.ts";

const browserDirectory = fileURLToPath(new URL("../../../browser", import.meta.url));
const CONTROL_PORT = 19222;
const LIVE_VIEW_PORT = 16080;
const controlUrl = `http://127.0.0.1:${CONTROL_PORT}`;

// Two sites on the container's own loopback. Cookies are kept per host, so they don't share a login.
const SITE = { name: "Test site", homeUrl: "http://127.0.0.1:8000/home", loginHosts: ["127.0.0.1"] };
const OTHER_SITE = { name: "Other site", homeUrl: "http://localhost:8000/home", loginHosts: ["localhost"] };

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
    sites: { site: SITE, other: OTHER_SITE },
    connectionTypes: [],
    allowedHosts: ["127.0.0.1"],
    databasePath: join(directory, "buddy.sqlite"),
    chatModel: "unused",
    crisisCheck: { model: "unused", timeoutMs: 0 },
    discovery: { model: "unused", offices: [] },
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
});

afterAll(async () => {
  await backend?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  compose("down", "--volumes");
});

beforeEach(async () => {
  await browser.forgetLogin(["127.0.0.1", "localhost"]);
});

describe("how the container is kept apart", () => {
  it("runs Chromium with its own sandbox on", async () => {
    const reading = await browser.read("chrome://sandbox");

    expect(reading.text).toMatch(/You are adequately sandboxed/i);
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

    const reading = await browser.read(SITE.homeUrl);

    expect(reading.url).toBe(SITE.homeUrl);
    expect(reading.title).toBe("Dashboard");
    expect(reading.text).toContain("Your courses");
    expect(reading.accessibilitySnapshot).toContain('heading "Dashboard"');
    expect(reading.accessibilitySnapshot).toContain('button "Open a course"');
  });

  it("follows the site to its login page when the Student isn't logged in", async () => {
    const reading = await browser.read(SITE.homeUrl);

    expect(reading.url).toContain("/login-required");
    expect(reading.title).toBe("Please log in");
  });
});

describe("during a Takeover", () => {
  it("gives Buddy no snapshots, and nothing stays attached to the browser", async () => {
    expect((await startTakeover("site")).status).toBe(200);

    await expect(backend.browserAccess.read(SITE.homeUrl)).rejects.toThrow(TakeoverInProgress);

    const targets = (await (await fetch(`${controlUrl}/json/list`)).json()) as { url: string }[];
    expect(targets.filter((target) => target.url.startsWith("http"))).toHaveLength(1);

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

    expect((await browser.read(SITE.homeUrl)).title).toBe("Dashboard");
  });

  it("can be forgotten one site at a time", async () => {
    await logIn(SITE);
    await logIn(OTHER_SITE);

    const response = await fetch(`${backend.url}/sites/site/login`, { method: "DELETE", headers: deviceHeaders });

    expect(response.status).toBe(204);
    expect((await browser.read(SITE.homeUrl)).title).toBe("Please log in");
    expect((await browser.read(OTHER_SITE.homeUrl)).title).toBe("Dashboard");
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

    expect((await browser.read(SITE.homeUrl)).title).toBe("Please log in");
  });
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
