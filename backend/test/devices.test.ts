import { connect } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pairingLink } from "../src/pairing-link.ts";
import { BackendHarness, TEST_SITE } from "./support/backend-harness.ts";

const FIVE_MINUTES = 5 * 60_000;

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
  backend.browser.savedPages.set(TEST_SITE.homeUrl, {
    title: "Dashboard",
    text: "Your courses",
    accessibilitySnapshot: '- heading "Dashboard"',
  });
});

afterEach(async () => {
  await backend.stop();
});

function pair(code: unknown): Promise<Response> {
  return fetch(`${backend.url}/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

async function keyFrom(response: Response): Promise<string> {
  return ((await response.json()) as { deviceKey: string }).deviceKey;
}

async function statusWithKey(deviceKey: string): Promise<number> {
  const response = await fetch(`${backend.url}/takeover`, { headers: { authorization: `Bearer ${deviceKey}` } });
  return response.status;
}

/** Sends raw bytes to the backend and collects whatever comes back until it hangs up. */
function rawRequest(text: string): Promise<string> {
  const { hostname, port } = new URL(backend.url);
  const socket = connect(Number(port), hostname);
  let received = "";
  socket.on("data", (bytes) => (received += bytes.toString()));
  socket.on("error", () => {});
  const closed = new Promise<string>((resolve) => socket.on("close", () => resolve(received)));
  socket.write(text);
  return closed;
}

describe("pairing a phone", () => {
  it("gives the phone a device key that opens the backend", async () => {
    const { code } = backend.devices.newPairingCode();

    const response = await pair(code);

    expect(response.status).toBe(200);
    const deviceKey = await keyFrom(response);
    expect(deviceKey.length).toBeGreaterThanOrEqual(32);
    expect(await statusWithKey(deviceKey)).toBe(200);
  });

  it("gives each phone its own key", async () => {
    const first = await keyFrom(await pair(backend.devices.newPairingCode().code));
    const second = await keyFrom(await pair(backend.devices.newPairingCode().code));

    expect(second).not.toBe(first);
    expect(await statusWithKey(first)).toBe(200);
    expect(await statusWithKey(second)).toBe(200);
  });

  it("makes a code that's short enough to type, with no letters that look like digits", () => {
    const { code } = backend.devices.newPairingCode();

    expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("accepts a code typed in lower case, or without the dash", async () => {
    const { code } = backend.devices.newPairingCode();

    const response = await pair(` ${code.replace("-", "").toLowerCase()} `);

    expect(response.status).toBe(200);
  });

  it("keeps the phone paired across a backend restart", async () => {
    const deviceKey = await keyFrom(await pair(backend.devices.newPairingCode().code));

    await backend.restart();

    expect(await statusWithKey(deviceKey)).toBe(200);
  });

  it("accepts a code made by another process using the same database", async () => {
    // npm run pair makes the code from its own process, while the backend is running.
    const { code, close } = backend.newPairingCodeFromAnotherProcess();

    expect((await pair(code)).status).toBe(200);
    close();
  });
});

describe("the pairing QR code", () => {
  it("holds the address and the code, in the form the app reads", () => {
    // The app's own test reads this same text. See app/test/pairing_test.dart.
    expect(pairingLink("https://laptop.tail1234.ts.net", "ABCD-EFGH")).toBe(
      "buddy://pair?address=https%3A%2F%2Flaptop.tail1234.ts.net&code=ABCD-EFGH",
    );
  });
});

describe("a pairing code", () => {
  it("can't be used twice", async () => {
    const { code } = backend.devices.newPairingCode();
    await pair(code);

    const second = await pair(code);

    expect(second.status).toBe(401);
    expect(await second.text()).not.toContain("deviceKey");
  });

  it("works until just before five minutes are up", async () => {
    const { code } = backend.devices.newPairingCode();

    backend.clock.moveForward(FIVE_MINUTES - 1);

    expect((await pair(code)).status).toBe(200);
  });

  it("expires after five minutes", async () => {
    const { code, expiresAt } = backend.devices.newPairingCode();
    expect(expiresAt.getTime() - backend.clock.now().getTime()).toBe(FIVE_MINUTES);

    backend.clock.moveForward(FIVE_MINUTES);

    expect((await pair(code)).status).toBe(401);
  });

  it("stops working when a newer one is made", async () => {
    const { code: older } = backend.devices.newPairingCode();
    const { code: newer } = backend.devices.newPairingCode();

    expect((await pair(older)).status).toBe(401);
    expect((await pair(newer)).status).toBe(200);
  });

  it("is thrown away after five wrong tries, so it can't be guessed", async () => {
    const { code } = backend.devices.newPairingCode();

    for (let attempt = 0; attempt < 5; attempt++) expect((await pair("WRNG-CODE")).status).toBe(401);

    expect((await pair(code)).status).toBe(401);
  });

  it("survives fewer than five wrong tries", async () => {
    const { code } = backend.devices.newPairingCode();

    for (let attempt = 0; attempt < 4; attempt++) await pair("WRNG-CODE");

    expect((await pair(code)).status).toBe(200);
  });

  it("doesn't say why it was refused", async () => {
    const { code } = backend.devices.newPairingCode();
    const wrong = await (await pair("WRNG-CODE")).text();
    await pair(code);
    const used = await (await pair(code)).text();
    const { code: expiring } = backend.devices.newPairingCode();
    backend.clock.moveForward(FIVE_MINUTES);
    const expired = await (await pair(expiring)).text();

    expect(used).toBe(wrong);
    expect(expired).toBe(wrong);
  });

  it.each([[42], [undefined], [null], [["ABCD-EFGH"]]])("refuses a malformed code: %j", async (code) => {
    expect((await pair(code)).status).toBe(400);
  });
});

describe("without a valid device key", () => {
  const OPERATIONS: [string, string, unknown?][] = [
    ["GET", "/conversation/messages"],
    ["POST", "/conversation/messages", { text: "Hello" }],
    ["GET", "/takeover"],
    ["POST", "/takeover", { site: "canvas" }],
    ["POST", "/takeover/done"],
    ["DELETE", "/sites/canvas/login"],
    // A route nobody has added yet is refused too, so a new one can't forget the check.
    ["GET", "/not-a-route-yet"],
  ];

  const BAD_KEYS: [string, Record<string, string>][] = [
    ["no key", {}],
    ["a made-up key", { authorization: "Bearer made-up-key" }],
    ["an empty key", { authorization: "Bearer " }],
    ["the wrong scheme", { authorization: "Basic made-up-key" }],
  ];

  describe.each(BAD_KEYS)("%s", (_name, headers) => {
    it.each(OPERATIONS)("%s %s is refused and does nothing", async (method, path, body) => {
      const response = await fetch(`${backend.url}${path}`, {
        method,
        headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : null,
      });

      expect(response.status).toBe(401);
      expect(backend.claude.requests).toEqual([]);
      expect(backend.browser.actions).toEqual([]);
    });
  });

  it("refuses a pairing code used as a device key", async () => {
    const { code } = backend.devices.newPairingCode();

    expect(await statusWithKey(code)).toBe(401);
  });

  describe("the live view", () => {
    let page: string;
    let token: string;

    beforeEach(async () => {
      const { takeover } = (await (await backend.startTakeover("canvas")).json()) as { takeover: any };
      page = takeover.liveViewPath;
      token = page.split("/")[3]!;
    });

    it("won't serve its page or scripts, even with the Takeover's token", async () => {
      expect((await fetch(`${backend.url}${page}`)).status).toBe(401);
      expect((await fetch(`${backend.url}/takeover/live/${token}/core/rfb.js`)).status).toBe(401);
    });

    it("won't open its socket, even with the Takeover's token", async () => {
      const { hostname } = new URL(backend.url);

      const received = await rawRequest(
        `GET /takeover/live/${token}/websockify HTTP/1.1\r\nHost: ${hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
      );

      expect(received).toContain("401");
      expect(backend.browser.liveViewConnections).toBe(0);
    });

    it("won't accept a made-up pass", async () => {
      const response = await fetch(`${backend.url}/takeover/live/${token}/core/rfb.js`, {
        headers: { cookie: "buddy_live_view=made-up" },
      });

      expect(response.status).toBe(401);
    });
  });
});

describe("a live view socket request", () => {
  const upgrade = (path: string, headers = "") =>
    `GET ${path} HTTP/1.1\r\nHost: ${new URL(backend.url).hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${headers}\r\n`;

  it("can't bring the backend down with an address that can't be read", async () => {
    const received = await rawRequest(upgrade("//"));

    expect(received).toContain("401");
    expect((await fetch(`${backend.url}/takeover`, { headers: backend.deviceHeaders })).status).toBe(200);
  });

  it("is refused with a made-up key or a made-up pass, even with the Takeover's token", async () => {
    const { takeover } = (await (await backend.startTakeover("canvas")).json()) as { takeover: any };
    const socket = takeover.liveViewPath.replace(/takeover\.html$/, "websockify");

    expect(await rawRequest(upgrade(socket, "Authorization: Bearer made-up-key\r\n"))).toContain("401");
    expect(await rawRequest(upgrade(socket, "Cookie: buddy_live_view=made-up\r\n"))).toContain("401");
    expect(backend.browser.liveViewConnections).toBe(0);
  });

  describe("with the pass from an earlier Takeover", () => {
    let oldToken: string;
    let oldCookie: string;
    let newToken: string;

    beforeEach(async () => {
      const first = (await (await backend.startTakeover("canvas")).json()) as { takeover: any };
      const page = await fetch(`${backend.url}${first.takeover.liveViewPath}`, { headers: backend.deviceHeaders });
      oldToken = first.takeover.liveViewPath.split("/")[3];
      oldCookie = page.headers.get("set-cookie")!.split(";")[0]!;
      await backend.finishTakeover();
      const second = (await (await backend.startTakeover("canvas")).json()) as { takeover: any };
      newToken = second.takeover.liveViewPath.split("/")[3];
    });

    it("is refused for the Takeover under way", async () => {
      const received = await rawRequest(upgrade(`/takeover/live/${newToken}/websockify`, `Cookie: ${oldCookie}\r\n`));

      expect(received).toContain("401");
      expect(backend.browser.liveViewConnections).toBe(0);
    });

    it("can't get there through a path that starts with the old token", async () => {
      const path = `/takeover/live/${oldToken}/../${newToken}/websockify`;

      const received = await rawRequest(upgrade(path, `Cookie: ${oldCookie}\r\n`));

      expect(received).toContain("401");
      expect(backend.browser.liveViewConnections).toBe(0);
    });
  });
});

describe("the pairing route", () => {
  it("is only open for POST", async () => {
    expect((await fetch(`${backend.url}/devices/pair`)).status).toBe(401);
  });

  it("still refuses a page in Buddy's Browser reaching it through Docker's address", async () => {
    const { code } = backend.devices.newPairingCode();
    const body = JSON.stringify({ code });

    const received = await rawRequest(
      `POST /devices/pair HTTP/1.1\r\nHost: host.docker.internal:8787\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
    );

    expect(received).toContain("403");
    expect((await pair(code)).status).toBe(200);
  });
});

describe("the live view with a device key", () => {
  let page: string;
  let base: string;

  beforeEach(async () => {
    const { takeover } = (await (await backend.startTakeover("canvas")).json()) as { takeover: any };
    page = takeover.liveViewPath;
    base = page.replace(/takeover\.html$/, "");
  });

  /** What the WebView does: opens the page with the key, then relies on the cookie it was given. */
  async function openPage(): Promise<string> {
    const response = await fetch(`${backend.url}${page}`, { headers: backend.deviceHeaders });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!;
  }

  const cookieFrom = (setCookie: string): string => setCookie.split(";")[0]!;

  it("gives the page a pass limited to that Takeover's live view", async () => {
    const setCookie = await openPage();

    expect(setCookie).toMatch(/^buddy_live_view=[^;]+;/);
    expect(setCookie).toContain(`Path=${base}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("never puts the device key in the pass", async () => {
    expect(await openPage()).not.toContain(backend.deviceKey);
  });

  it("lets the page load its scripts with the pass", async () => {
    const cookie = cookieFrom(await openPage());

    const response = await fetch(`${backend.url}${base}core/rfb.js`, { headers: { cookie } });

    expect(response.status).toBe(200);
  });

  it("doesn't accept the pass anywhere else", async () => {
    const cookie = cookieFrom(await openPage());

    expect((await fetch(`${backend.url}/takeover`, { headers: { cookie } })).status).toBe(401);
    expect((await fetch(`${backend.url}/conversation/messages`, { headers: { cookie } })).status).toBe(401);
  });

  it("doesn't accept the pass for the next Takeover", async () => {
    const cookie = cookieFrom(await openPage());
    await backend.finishTakeover();
    const { takeover } = (await (await backend.startTakeover("canvas")).json()) as { takeover: any };

    const response = await fetch(`${backend.url}${takeover.liveViewPath}`, { headers: { cookie } });

    expect(response.status).toBe(401);
  });

  it("keeps accepting the pass after the backend restarts mid-Takeover", async () => {
    const cookie = cookieFrom(await openPage());

    await backend.restart();

    expect((await fetch(`${backend.url}${base}core/rfb.js`, { headers: { cookie } })).status).toBe(200);
  });

  it("opens the socket with the pass, and keeps everything but the handshake from the container", async () => {
    const cookie = cookieFrom(await openPage());
    const { hostname, port } = new URL(backend.url);
    const socket = connect(Number(port), hostname);
    let received = "";
    socket.on("data", (bytes) => (received += bytes.toString()));
    socket.on("error", () => {});

    socket.write(
      `GET ${base}websockify HTTP/1.1\r\nHost: ${hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Authorization: Bearer ${backend.deviceKey}\r\nCookie: ${cookie}\r\n` +
        `Tailscale-User-Login: student@temple.test\r\nSec-WebSocket-Protocol: from-app\r\n\r\n`,
    );

    // The stand-in echoes everything it's sent, so this is exactly what the container saw.
    for (let attempt = 0; attempt < 200 && !received.includes("from-app"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    socket.destroy();
    expect(received).toContain("Sec-WebSocket-Protocol: from-app");
    expect(received).not.toContain(backend.deviceKey);
    expect(received).not.toContain(cookie);
    expect(received).not.toContain("student@temple.test");
  });
});
