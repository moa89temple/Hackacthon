import { describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import { PageBlocked } from "../src/buddys-browser.ts";
import { createGuardPolicy } from "../src/network-guard.ts";
import { BackendHarness, TEST_SITE } from "./support/backend-harness.ts";

const canvas: Site = { name: "Canvas", homeUrl: "https://school.canvas.test/", loginHosts: ["canvas.test", "sign-in.test"] };
const portal: Site = { name: "TUportal", homeUrl: "https://portal.test/", loginHosts: ["portal.test"], signOnDomains: ["temple.test"] };

const SEARCH_RESULT = "https://www.scholarships.example/awards/2026";

/** With every Read Permission given, to show that none of them gets a page into a Connection. */
const guard = (address = SEARCH_RESULT) =>
  createGuardPolicy({ sites: { canvas, portal }, publicHosts: ["now.temple.test"], hasReadPermission: () => true }).forPublicPage(address);

const opening = (url: string) => ({ url, method: "GET", opensPage: true });
const loading = (url: string) => ({ url, method: "GET", opensPage: false });

describe("the guard for reading one public page", () => {
  it("opens that page's own host", () => {
    expect(guard().check(opening(SEARCH_RESULT)).allowed).toBe(true);
    expect(guard().check(opening("https://www.scholarships.example/awards/2026/apply")).allowed).toBe(true);
  });

  it("lets it load what a page loads for itself, such as a script that builds it", () => {
    expect(guard().check(loading("https://cdn.elsewhere.example/app.js")).allowed).toBe(true);
    expect(guard().check({ url: "https://www.scholarships.example/api/awards", method: "GET", opensPage: false }).allowed).toBe(true);
  });

  it("refuses to move on to any other host, even a subdomain or the same domain", () => {
    expect(guard().check(opening("https://elsewhere.example/")).allowed).toBe(false);
    expect(guard().check(opening("https://scholarships.example/")).allowed).toBe(false);
    expect(guard().check(opening("https://apply.www.scholarships.example/")).allowed).toBe(false);
  });

  it("refuses everything that isn't only reading, with no exception", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(guard().check({ url: SEARCH_RESULT, method, opensPage: false }).allowed).toBe(false);
    }
  });

  it("keeps the page out of every Connection, even one with its Read Permission, because the login is in this browser", () => {
    expect(guard().check(loading("https://school.canvas.test/api/v1/courses")).allowed).toBe(false);
    expect(guard().check(loading("https://sign-in.test/idp")).allowed).toBe(false);
    expect(guard().check(opening("https://portal.test/")).allowed).toBe(false);
  });

  it("keeps it off the domain a single sign-on works across", () => {
    expect(guard().check(loading("https://anything.temple.test/frame")).allowed).toBe(false);
  });

  it("refuses to read a Connection as if it were a search result", () => {
    expect(guard("https://school.canvas.test/courses").check(opening("https://school.canvas.test/courses")).allowed).toBe(false);
  });

  it("refuses private addresses and addresses given as numbers, for the page and for what it loads", () => {
    for (const address of ["http://127.0.0.1:8000/", "http://169.254.169.254/latest/meta-data", "http://host.docker.internal/", "http://localhost/", "http://[::1]/"]) {
      expect(guard(address).check(opening(address)).allowed).toBe(false);
      expect(guard().check(loading(address)).allowed).toBe(false);
    }
  });

  it("refuses anything that isn't the web", () => {
    expect(guard().check(loading("file:///etc/passwd")).allowed).toBe(false);
    expect(guard("file:///etc/passwd").check(opening("file:///etc/passwd")).allowed).toBe(false);
  });

  it("opens a listed public page, and still can't go past it onto its sign-on domain", () => {
    const onNow = guard("https://now.temple.test/events");

    expect(onNow.check(opening("https://now.temple.test/events")).allowed).toBe(true);
    expect(onNow.check(loading("https://fim.temple.test/idp")).allowed).toBe(false);
  });
});

describe("reading one public page through Buddy's Browser", () => {
  it("reads it with no Read Permission", async () => {
    const backend = await BackendHarness.start();
    backend.browser.savedPages.set(SEARCH_RESULT, { title: "Awards", text: "Awards", accessibilitySnapshot: "", html: "<p>Awards</p>" });

    const reading = await backend.browserAccess.readPublicPage(SEARCH_RESULT);

    expect(reading.title).toBe("Awards");
    await backend.stop();
  });

  it("refuses a Connection before the browser is touched", async () => {
    const backend = await BackendHarness.start();

    await expect(backend.browserAccess.readPublicPage(TEST_SITE.homeUrl)).rejects.toThrow(PageBlocked);

    expect(backend.browser.actions).toEqual([]);
    await backend.stop();
  });

  it("refuses a page that redirects anywhere else", async () => {
    const backend = await BackendHarness.start();
    backend.browser.savedPages.set(SEARCH_RESULT, { title: "Gone", text: "Gone", accessibilitySnapshot: "", finalUrl: "https://elsewhere.example/" });

    await expect(backend.browserAccess.readPublicPage(SEARCH_RESULT)).rejects.toThrow(PageBlocked);
    await backend.stop();
  });

  it("stays out during a Takeover", async () => {
    const backend = await BackendHarness.start();
    await backend.startTakeover("canvas");
    backend.browser.actions.length = 0;

    await expect(backend.browserAccess.readPublicPage(SEARCH_RESULT)).rejects.toThrow(/in control/);

    expect(backend.browser.actions).toEqual([]);
    await backend.stop();
  });
});
