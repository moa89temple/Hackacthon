import { describe, expect, it } from "vitest";
import { EXIT_LOGIN_NEEDED, EXIT_NO_READ_PERMISSION, EXIT_OK, EXIT_OLD_LOGIN_REMAINS, EXIT_TAKEOVER_UNDER_WAY } from "../src/canvas-check.ts";
import { runDarsCheck } from "../src/dars-check.ts";
import { settings } from "../src/settings.ts";
import { auditWith, darsPage, expireDarsLogin, LIST_PAGE, NEWEST_AUDIT, saveDarsPages } from "./support/dars-pages.ts";
import { RecordingBrowser } from "./support/recording-browser.ts";

/** Every page these read is made up, so this proves what the check prints, not that the reader fits the real DARS. */
const ALLOWED = { hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: false };

async function check(browser: RecordingBrowser, student = () => ALLOWED) {
  const lines: string[] = [];
  const exitCode = await runDarsCheck({ browser, sites: { dars: settings.sites.dars! }, student, print: (line) => lines.push(line) });
  return { exitCode, output: lines.join("\n") };
}

function pages(more: { list?: string; audit?: string } = {}) {
  const browser = new RecordingBrowser();
  saveDarsPages(browser, more);
  return browser;
}

describe("the DARS check", () => {
  it("says each page was understood, and prints nothing from them", async () => {
    const { exitCode, output } = await check(pages());

    expect(exitCode).toBe(EXIT_OK);
    expect(output).toMatch(/list of audits \/selfservice\/audit\/list\.html: understood/);
    expect(output).toMatch(/audit \/selfservice\/audit\/read\.html\?id=:value: understood/);
    expect(output).not.toMatch(/MARKER|GENED|MAJOR|MADE-UP|10\/30\/2026|made-up-newest/);
  });

  it("shows the shape of a page it couldn't understand, and still nothing from it", async () => {
    const { exitCode, output } = await check(pages({ audit: auditWith({ "MARKERTITLE ONE": "Status_MAYBE" }, "<h3>MARKERHEADING</h3><a href='/selfservice/MARKERLINK/x.html?id=MARKERID'>MARKERWORDS</a>") }));

    expect(exitCode).toBe(6);
    expect(output).toMatch(/audit .*: NOT understood/);
    expect(output).toMatch(/Status_MAYBE/);
    expect(output).toMatch(/heading: :word/);
    expect(output).not.toMatch(/marker/i);
  });

  it("doesn't say how many requirements a page has, by its rows or anything else", async () => {
    const many = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`NOT READ ${index}`, "Status_MAYBE"]));

    const { output } = await check(pages({ audit: auditWith(many) }));

    expect(output).not.toMatch(/×\d/);
  });

  it("prints what the guard refused, with what its fields are called and never their values", async () => {
    const browser = pages();
    browser.savedPages.set(
      LIST_PAGE,
      darsPage(browser.savedPages.get(LIST_PAGE)!.html!, {
        alsoRequests: [
          { url: "https://prd-dars.temple.edu/selfservice/saml/SSO", method: "POST", body: "SAMLResponse=MARKERSECRET&RelayState=x" },
          { url: "https://prd-dars.temple.edu/selfservice/audit/create.html?who=MARKERSTUDENT", method: "GET" },
        ],
      }),
    );

    const { output } = await check(browser);

    expect(output).toMatch(/POST prd-dars\.temple\.edu \/selfservice\/saml\/:text fields: SAMLResponse, RelayState|POST prd-dars\.temple\.edu \/selfservice\/saml\/sso fields: SAMLResponse, RelayState/);
    expect(output).toMatch(/GET prd-dars\.temple\.edu \/selfservice\/audit\/create\.html\?who=:value/);
    expect(output).not.toMatch(/marker/i);
  });

  it("says when the login has expired, and opens nothing further", async () => {
    const browser = pages();
    expireDarsLogin(browser);

    const { exitCode, output } = await check(browser);

    expect(exitCode).toBe(EXIT_LOGIN_NEEDED);
    expect(output).toMatch(/not logged in/);
    expect(browser.actions.filter((action) => action.type === "read").map((action: any) => action.url)).toEqual([LIST_PAGE]);
  });

  it.each([
    ["no Read Permission", { ...ALLOWED, hasReadPermission: false }, EXIT_NO_READ_PERMISSION],
    ["a Takeover under way", { ...ALLOWED, takeoverUnderWay: true }, EXIT_TAKEOVER_UNDER_WAY],
    ["an old login still to delete", { ...ALLOWED, oldLoginRemains: true }, EXIT_OLD_LOGIN_REMAINS],
  ])("opens nothing with %s", async (_, state, exit) => {
    const browser = pages();

    const { exitCode } = await check(browser, () => state);

    expect(exitCode).toBe(exit);
    expect(browser.actions).toEqual([]);
  });

  it("stops if the Student revokes during the check, and says so", async () => {
    const browser = pages();
    let asked = 0;

    const { exitCode, output } = await check(browser, () => (++asked > 1 ? { ...ALLOWED, hasReadPermission: false } : ALLOWED));

    expect(exitCode).toBe(EXIT_NO_READ_PERMISSION);
    expect(output).toMatch(/revoked during the check/);
    expect(browser.actions).toEqual([]);
  });

  it("only ever reads, so the login in a real container can't be touched", async () => {
    const browser = pages();

    await check(browser);

    expect(browser.actions.map((action) => action.type)).toEqual(["read", "read"]);
    expect(browser.actions.at(-1)).toEqual({ type: "read", url: NEWEST_AUDIT });
  });
});
