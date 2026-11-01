import { request } from "node:http";
import { connect, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness, TEST_SITE } from "./support/backend-harness.ts";

let backend: BackendHarness;
const sockets: Socket[] = [];

beforeEach(async () => {
  backend = await BackendHarness.start();
  backend.browser.savedPages.set(TEST_SITE.homeUrl, {
    title: "Dashboard",
    text: "Your courses",
    accessibilitySnapshot: '- heading "Dashboard"',
  });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await backend.stop();
});

async function startTakeover(): Promise<string> {
  const { takeover } = (await (await backend.startTakeover("canvas")).json()) as { takeover: any };
  return takeover.liveViewPath.replace(/takeover\.html$/, "websockify");
}

/** Opens the live view socket by hand and returns the socket with everything it has received so far. */
function openSocket(path: string): { socket: Socket; received: () => string; closed: Promise<void> } {
  const { hostname, port } = new URL(backend.url);
  const socket = connect(Number(port), hostname);
  sockets.push(socket);
  let received = "";
  socket.on("data", (bytes) => (received += bytes.toString()));
  socket.on("error", () => {});
  socket.write(
    `GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Test: from-app\r\n\r\n`,
  );
  return {
    socket,
    received: () => received,
    closed: new Promise((resolve) => socket.on("close", () => resolve())),
  };
}

async function eventually(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("eventually: the condition never came true");
}

describe("the live view socket", () => {
  it("reaches the container through the backend during a Takeover, in both directions", async () => {
    const path = await startTakeover();

    const view = openSocket(path);

    // The stand-in echoes everything, so the upgrade request comes straight back.
    await eventually(() => view.received().includes("X-Test: from-app"));
    expect(view.received()).toContain("GET /websockify HTTP/1.1");
    view.socket.write("typed by the Student");
    await eventually(() => view.received().includes("typed by the Student"));
  });

  it("is refused when there is no Takeover", async () => {
    const view = openSocket("/takeover/live/made-up-token/websockify");

    await view.closed;

    expect(view.received()).toContain("404");
    expect(backend.browser.liveViewConnections).toBe(0);
  });

  it("is refused with the wrong token during a Takeover", async () => {
    await startTakeover();

    const view = openSocket("/takeover/live/made-up-token/websockify");

    await view.closed;
    expect(view.received()).toContain("404");
    expect(backend.browser.liveViewConnections).toBe(0);
  });

  it("is cut off before Buddy finishes reading anything when the Student taps Done", async () => {
    const path = await startTakeover();
    const view = openSocket(path);
    await eventually(() => backend.browser.liveViewConnections === 1);
    let finishRead!: () => void;
    backend.browser.holdReads = new Promise((resolve) => (finishRead = resolve));

    const finishing = backend.finishTakeover();

    // The read that checks the login is held open, so this can only pass if the cut comes first.
    await view.closed;
    await eventually(() => backend.browser.liveViewConnections === 0);
    finishRead();
    await finishing;
  });

  it("can't be reopened with the old token after Done", async () => {
    const path = await startTakeover();
    await backend.finishTakeover();

    const view = openSocket(path);

    await view.closed;
    expect(view.received()).toContain("404");
  });

  it("uses a new token for each Takeover", async () => {
    const first = await startTakeover();
    await backend.finishTakeover();

    const second = await startTakeover();

    expect(second).not.toBe(first);
  });

  it("keeps one view at a time: a reconnect replaces the old connection", async () => {
    const path = await startTakeover();
    const first = openSocket(path);
    await eventually(() => first.received().includes("X-Test"));

    const second = openSocket(path);

    await first.closed;
    await eventually(() => second.received().includes("X-Test"));
    await eventually(() => backend.browser.liveViewConnections === 1);
  });

  it("is still reachable after the backend restarts mid-Takeover", async () => {
    const path = await startTakeover();

    await backend.restart();

    const view = openSocket(path);
    await eventually(() => view.received().includes("X-Test"));
  });
});

describe("before the screen is the Student's", () => {
  it("keeps the live view closed while the site is still being put on the screen", async () => {
    let finishShow!: () => void;
    backend.browser.holdShows = new Promise((resolve) => (finishShow = resolve));
    const starting = backend.startTakeover("canvas");
    while (!(await backend.currentTakeover())) await new Promise((resolve) => setTimeout(resolve, 5));
    const { liveViewPath } = await backend.currentTakeover();

    expect((await fetch(`${backend.url}${liveViewPath}`)).status).toBe(404);
    const early = openSocket(liveViewPath.replace(/takeover\.html$/, "websockify"));
    await early.closed;
    expect(early.received()).toContain("404");

    finishShow();
    await starting;
    expect((await fetch(`${backend.url}${liveViewPath}`)).status).toBe(200);
  });
});

describe("requests from anywhere but the app", () => {
  /** A request that says it's for this host, which fetch won't let a test choose. */
  function statusWithHost(host: string, path: string): Promise<number> {
    const { hostname, port } = new URL(backend.url);
    return new Promise((resolve, reject) => {
      const outgoing = request({ hostname, port, path, headers: { host } }, (response) => {
        response.resume();
        resolve(response.statusCode!);
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  }

  it("refuses a page in Buddy's Browser reaching the backend through Docker's host address", async () => {
    expect(await statusWithHost("host.docker.internal:8787", "/conversation/messages")).toBe(403);
    expect(await statusWithHost("192.168.65.254:8787", "/takeover")).toBe(403);
  });

  it("refuses the live view socket too", async () => {
    const path = await startTakeover();
    const { hostname, port } = new URL(backend.url);
    const socket = connect(Number(port), hostname);
    sockets.push(socket);
    let received = "";
    socket.on("data", (bytes) => (received += bytes.toString()));
    socket.on("error", () => {});
    const closed = new Promise((resolve) => socket.on("close", resolve));

    socket.write(`GET ${path} HTTP/1.1\r\nHost: host.docker.internal\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);

    await closed;
    expect(received).toContain("403");
    expect(backend.browser.liveViewConnections).toBe(0);
  });

  it("still answers the addresses the app uses", async () => {
    expect(await statusWithHost("127.0.0.1:8787", "/takeover")).toBe(200);
  });
});

describe("the live view page", () => {
  it("comes from the container, through the backend, during a Takeover", async () => {
    const base = (await startTakeover()).replace(/websockify$/, "");

    const response = await fetch(`${backend.url}${base}core/rfb.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("served /core/rfb.js for 127.0.0.1");
  });

  it("can't be pointed at another host", async () => {
    const base = (await startTakeover()).replace(/websockify$/, "");

    const response = await fetch(`${backend.url}${base}//localhost:1/secret`);

    // Whatever the path says, the request goes to the container and nowhere else.
    expect(response.status).toBe(200);
    const { port } = backend.browser.liveView;
    expect(await response.text()).toContain(`for 127.0.0.1:${port}`);
  });

  it("is not served without the token of the Takeover under way", async () => {
    const page = await startTakeover();
    const token = page.split("/")[3];
    await backend.finishTakeover();

    const response = await fetch(`${backend.url}/takeover/live/${token}/takeover.html`);

    expect(response.status).toBe(404);
  });
});
