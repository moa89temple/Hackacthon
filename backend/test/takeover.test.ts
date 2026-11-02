import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TakeoverInProgress, UnknownSite } from "../src/browser-access.ts";
import { PageBlocked } from "../src/buddys-browser.ts";
import { BackendHarness, OTHER_TEST_SITE, PUBLIC_TEST_PAGE, TEST_SITE } from "./support/backend-harness.ts";

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
  backend.browser.savedPages.set(TEST_SITE.homeUrl, {
    title: "Dashboard",
    text: "Your courses",
    accessibilitySnapshot: '- heading "Dashboard"',
  });
  backend.browser.savedPages.set(PUBLIC_TEST_PAGE, {
    title: "Dashboard",
    text: "Your courses",
    accessibilitySnapshot: '- heading "Dashboard"',
  });
});

afterEach(async () => {
  await backend.stop();
});

describe("starting a Takeover", () => {
  it("puts the site on the screen and gives the app a live view through the backend", async () => {
    const response = await backend.startTakeover("canvas");

    expect(response.status).toBe(200);
    const { takeover } = (await response.json()) as { takeover: any };
    expect(takeover).toMatchObject({ site: "canvas", siteName: "Canvas" });
    expect(takeover.liveViewPath).toMatch(/^\/takeover\/live\/[^/]+\/takeover\.html$/);
    expect(backend.browser.actions).toEqual([{ type: "show", url: TEST_SITE.homeUrl }]);
    expect(await backend.currentTakeover()).toEqual(takeover);
  });

  it.each([["nope"], [42], [undefined], ["__proto__"], ["constructor"]])("refuses an unknown site: %j", async (site) => {
    const response = await backend.startTakeover(site);

    expect(response.status).toBe(404);
    expect(backend.browser.actions).toEqual([]);
    expect(await backend.currentTakeover()).toBeNull();
  });

  it("returns to the same Takeover when the Student asks for the same site again", async () => {
    const first = await (await backend.startTakeover("canvas")).json();

    const second = await backend.startTakeover("canvas");

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(first);
    expect(backend.browser.actions).toHaveLength(1);
  });

  it("refuses a second site until the first Takeover is finished", async () => {
    await backend.startTakeover("canvas");

    const response = await backend.startTakeover("tuportal");

    expect(response.status).toBe(409);
    expect(backend.browser.actions).not.toContainEqual({ type: "show", url: OTHER_TEST_SITE.homeUrl });
    expect((await backend.currentTakeover()).site).toBe("canvas");
  });

  it("doesn't start when Buddy's Browser can't be reached, and doesn't lock Buddy out", async () => {
    backend.browser.unreachable = true;

    const response = await backend.startTakeover("canvas");

    expect(response.status).toBe(503);
    expect(await backend.currentTakeover()).toBeNull();
    backend.browser.unreachable = false;
    await expect(backend.browserAccess.read(PUBLIC_TEST_PAGE)).resolves.toMatchObject({ title: "Dashboard" });
  });

  it("waits for a read already under way before giving the Student the screen", async () => {
    let finishRead!: () => void;
    backend.browser.holdReads = new Promise((resolve) => (finishRead = resolve));
    const read = backend.browserAccess.read(PUBLIC_TEST_PAGE);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const starting = backend.startTakeover("canvas");
    await new Promise((resolve) => setTimeout(resolve, 20));

    // New reads are already refused, but the screen isn't the Student's until the read ends.
    await expect(backend.browserAccess.read(TEST_SITE.homeUrl)).rejects.toThrow(TakeoverInProgress);
    expect(backend.browser.actions).toEqual([{ type: "read", url: PUBLIC_TEST_PAGE }]);

    finishRead();
    await read;
    await starting;
    expect(backend.browser.actions).toEqual([
      { type: "read", url: PUBLIC_TEST_PAGE },
      { type: "show", url: TEST_SITE.homeUrl },
    ]);
  });
});

describe("a Takeover that fails to start", () => {
  it("doesn't end a newer Takeover when it fails late", async () => {
    let failShow!: (error: Error) => void;
    backend.browser.holdShows = new Promise((_, reject) => (failShow = reject));
    const first = backend.startTakeover("canvas");
    while (!(await backend.currentTakeover())) await new Promise((resolve) => setTimeout(resolve, 5));

    // The Student gives up on the first one and starts another, while the first is still loading.
    backend.browser.holdShows = undefined;
    const finishing = backend.finishTakeover();
    while (await backend.currentTakeover()) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = backend.startTakeover("tuportal");
    while (!(await backend.currentTakeover())) await new Promise((resolve) => setTimeout(resolve, 5));

    failShow(new Error("the page timed out"));
    expect((await first).status).toBe(503);
    await finishing;
    await second;

    expect((await backend.currentTakeover())?.site).toBe("tuportal");
    await expect(backend.browserAccess.read(TEST_SITE.homeUrl)).rejects.toThrow(TakeoverInProgress);
  });
});

describe("during a Takeover", () => {
  it("gives Buddy no snapshots: reads are refused before they reach the browser", async () => {
    await backend.startTakeover("canvas");

    await expect(backend.browserAccess.read(TEST_SITE.homeUrl)).rejects.toThrow(TakeoverInProgress);

    expect(backend.browser.actions).toEqual([{ type: "show", url: TEST_SITE.homeUrl }]);
  });

  it("keeps Buddy locked out if the backend restarts", async () => {
    await backend.startTakeover("canvas");
    const before = await backend.currentTakeover();

    await backend.restart();

    expect(await backend.currentTakeover()).toEqual(before);
    await expect(backend.browserAccess.read(TEST_SITE.homeUrl)).rejects.toThrow(TakeoverInProgress);
  });

  it("refuses a read that was waiting its turn when the Takeover started", async () => {
    let finishFirstRead!: () => void;
    backend.browser.holdReads = new Promise((resolve) => (finishFirstRead = resolve));
    const first = backend.browserAccess.read(PUBLIC_TEST_PAGE);
    const waiting = backend.browserAccess.read(PUBLIC_TEST_PAGE);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const starting = backend.startTakeover("canvas");
    while (!(await backend.currentTakeover())) await new Promise((resolve) => setTimeout(resolve, 5));
    finishFirstRead();

    await first;
    await expect(waiting).rejects.toThrow(TakeoverInProgress);
    await starting;
    expect(backend.browser.actions.filter((action) => action.type === "read")).toHaveLength(1);
  });
});

describe("reading a site with no Read Permission", () => {
  it("is refused before it reaches the browser", async () => {
    await expect(backend.browserAccess.read(TEST_SITE.homeUrl)).rejects.toThrow(PageBlocked);

    expect(backend.browser.actions).toEqual([]);
  });

  it("is refused even right after the Student logged in, because Done checks the login only", async () => {
    await backend.startTakeover("canvas");
    await backend.finishTakeover();
    const before = backend.browser.actions.length;

    await expect(backend.browserAccess.read(TEST_SITE.homeUrl)).rejects.toThrow(PageBlocked);

    expect(backend.browser.actions).toHaveLength(before);
  });

  it("lets the login check read only the site's home page", async () => {
    await backend.startTakeover("canvas");
    await backend.finishTakeover();

    expect(backend.browser.actions.filter((action) => action.type === "read")).toEqual([
      { type: "read", url: TEST_SITE.homeUrl },
    ]);
  });

  it("makes the login check refuse a site Buddy doesn't know", async () => {
    await expect(backend.browserAccess.readToCheckLogin("nope")).rejects.toThrow(UnknownSite);
  });

  it("says the Student isn't signed in when the site sends the check somewhere the guard refuses", async () => {
    backend.browser.savedPages.get(TEST_SITE.homeUrl)!.finalUrl = "https://elsewhere.test/";
    await backend.startTakeover("canvas");

    const response = await backend.finishTakeover();

    expect(await response.json()).toMatchObject({ signedIn: false });
  });
});

describe("tapping Done", () => {
  it("hands control back to Buddy, who can read the page again", async () => {
    await backend.startTakeover("canvas");

    const response = await backend.finishTakeover();

    expect(response.status).toBe(200);
    expect(await backend.currentTakeover()).toBeNull();
    expect(await backend.browserAccess.read(PUBLIC_TEST_PAGE)).toEqual({
      url: PUBLIC_TEST_PAGE,
      title: "Dashboard",
      text: "Your courses",
      accessibilitySnapshot: '- heading "Dashboard"',
      html: "",
    });
  });

  it("clears the screen and proves the login by reading the site's home page", async () => {
    await backend.startTakeover("canvas");

    const response = await backend.finishTakeover();

    expect(await response.json()).toEqual({
      site: "canvas",
      siteName: "Canvas",
      signedIn: true,
      title: "Dashboard",
    });
    expect(backend.browser.actions).toEqual([
      { type: "show", url: TEST_SITE.homeUrl },
      { type: "clear-screen" },
      { type: "read", url: TEST_SITE.homeUrl },
    ]);
  });

  it("says the Student isn't signed in when the site sends the browser to another host", async () => {
    backend.browser.savedPages.get(TEST_SITE.homeUrl)!.finalUrl = "https://sign-in.test/idp";
    await backend.startTakeover("canvas");

    const response = await backend.finishTakeover();

    expect(await response.json()).toMatchObject({ signedIn: false });
  });

  it("says the Student isn't signed in when the site shows its own login page", async () => {
    backend.browser.savedPages.get(TEST_SITE.homeUrl)!.finalUrl = "https://canvas.test/login";
    await backend.startTakeover("canvas");

    const response = await backend.finishTakeover();

    expect(await response.json()).toMatchObject({ signedIn: false });
  });

  it("still ends the Takeover when the check can't run", async () => {
    await backend.startTakeover("canvas");
    backend.browser.unreachable = true;

    const response = await backend.finishTakeover();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ signedIn: false });
    expect(await backend.currentTakeover()).toBeNull();
  });

  it("is refused when there is no Takeover", async () => {
    const response = await backend.finishTakeover();

    expect(response.status).toBe(409);
    expect(backend.browser.actions).toEqual([]);
  });
});

describe("forgetting a login", () => {
  it("forgets every host that holds that site's login, and nothing else", async () => {
    const response = await backend.forgetLogin("canvas");

    expect(response.status).toBe(204);
    expect(backend.browser.actions).toEqual([
      { type: "clear-screen" },
      { type: "forget-login", hosts: TEST_SITE.loginHosts },
    ]);
  });

  it("refuses an unknown site", async () => {
    const response = await backend.forgetLogin("nope");

    expect(response.status).toBe(404);
    expect(backend.browser.actions).toEqual([]);
  });

  it("waits until the Student has finished a Takeover", async () => {
    await backend.startTakeover("canvas");

    const response = await backend.forgetLogin("canvas");

    expect(response.status).toBe(409);
    expect(backend.browser.actions).toEqual([{ type: "show", url: TEST_SITE.homeUrl }]);
  });

  it("reports when Buddy's Browser can't be reached", async () => {
    backend.browser.unreachable = true;

    const response = await backend.forgetLogin("canvas");

    expect(response.status).toBe(503);
  });
});
