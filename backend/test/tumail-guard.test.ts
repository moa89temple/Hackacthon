import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import { PageBlocked } from "../src/buddys-browser.ts";
import { canvas } from "../src/canvas.ts";
import { createGuardPolicy } from "../src/network-guard.ts";
import { keepToReadablePages } from "../src/readable-pages.ts";
import { settings } from "../src/settings.ts";
import { tumail } from "../src/tumail.ts";
import { TUMAIL_APP_HOSTS, TUMAIL_ID } from "../src/tumail-rules.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { saveCanvasPages } from "./support/canvas-pages.ts";
import { saveTumailPages } from "./support/tumail-pages.ts";

const SITES = settings.sites as Record<string, Site>;
const guardFor = (permissions: string[]) =>
  keepToReadablePages(
    createGuardPolicy({ sites: SITES, publicHosts: [], hasReadPermission: (site) => permissions.includes(site) }).forReading(),
    SITES,
  );
const opening = (url: string) => ({ url, method: "GET", opensPage: true });
const posted = (url: string, headers?: Record<string, string>) => ({ url, method: "POST", opensPage: false, ...(headers ? { headers } : {}) });

describe("a read-only request known by more than its path", () => {
  const mail: Site = {
    name: "A mail site",
    homeUrl: "https://mail.test/",
    loginHosts: ["mail.test"],
    readOnlyRequests: [{ method: "POST", host: "mail.test", path: /^\/service$/, query: /^\?action=Read$/, headers: { action: /^Read$/ } }],
  };
  const guard = () => createGuardPolicy({ sites: { mail }, publicHosts: [], hasReadPermission: () => true }).forReading();

  it("goes through when what follows the path matches", () => {
    expect(guard().check(posted("https://mail.test/service?action=Read")).allowed).toBe(true);
    expect(guard().check(posted("https://mail.test/service?action=Read", { action: "Read" })).allowed).toBe(true);
  });

  it("is refused when what follows the path says something else", () => {
    expect(guard().check(posted("https://mail.test/service?action=Delete")).allowed).toBe(false);
    expect(guard().check(posted("https://mail.test/service")).allowed).toBe(false);
  });

  it("is refused when its header says something else, whatever the address says", () => {
    expect(guard().check(posted("https://mail.test/service?action=Read", { action: "Delete" })).allowed).toBe(false);
  });
});

describe("reading TUmail changes nothing in it", () => {
  const SERVICE = "https://outlook.office.com/owa/service.svc";
  const guard = () => guardFor([TUMAIL_ID]);

  it("lets through the app's requests for mail", () => {
    expect(guard().check(posted(`${SERVICE}?action=FindConversation&app=Mail`, { action: "FindConversation" })).allowed).toBe(true);
    expect(guard().check(posted(`${SERVICE}?action=GetConversationItems&app=Mail`, { action: "GetConversationItems" })).allowed).toBe(true);
  });

  it.each(["UpdateItem", "ApplyConversationAction", "MarkAllItemsAsRead", "SendItem", "CreateItem", "DeleteItem", "MoveItem"])(
    "refuses %s, by address or by header",
    (action) => {
      expect(guard().check(posted(`${SERVICE}?action=${action}&app=Mail`, { action })).allowed).toBe(false);
      expect(guard().check(posted(`${SERVICE}?action=GetItem&app=Mail`, { action })).allowed).toBe(false);
    },
  );

  it("refuses a request to anywhere else in Outlook that isn't on the list", () => {
    expect(guard().check(posted("https://outlook.office.com/owa/graphql")).allowed).toBe(false);
    expect(guard().check(posted("https://substrate.office.com/search")).allowed).toBe(false);
  });

  it.each(["/mail/deeplink/compose", "/mail/sentitems", "/mail/drafts", "/mail/options", "/calendar/view/month"])("won't open %s", (path) => {
    expect(guard().check(opening(`https://outlook.office.com${path}`)).allowed).toBe(false);
  });

  it("opens the inbox and one message on each of Outlook's hosts", () => {
    for (const host of TUMAIL_APP_HOSTS) {
      expect(guard().check(opening(`https://${host}/mail/inbox`)).allowed).toBe(true);
      expect(guard().check(opening(`https://${host}/mail/inbox/id/AAQkMadeUp%3D`)).allowed).toBe(true);
    }
  });
});

describe("Temple's sign-on, which Connections share", () => {
  it("can't take Buddy into TUmail with no Read Permission, even with Canvas on", () => {
    const guard = guardFor(["canvas"]);

    expect(guard.check(opening("https://fim.temple.edu/idp/profile/SAML2/POST/SSO")).allowed).toBe(true);
    for (const host of TUMAIL_APP_HOSTS) expect(guard.check(opening(`https://${host}/mail/inbox`)).allowed).toBe(false);
    expect(guard.check(opening("https://login.microsoftonline.com/common/oauth2/authorize")).allowed).toBe(false);
  });

  it("can't take Buddy into Canvas with no Read Permission, even with TUmail on", () => {
    const guard = guardFor([TUMAIL_ID]);

    expect(guard.check(opening("https://fim.temple.edu/idp/profile/SAML2/POST/SSO")).allowed).toBe(true);
    expect(guard.check(opening("https://templeu.instructure.com/courses")).allowed).toBe(false);
  });
});

describe("revoking when a sign-on is shared", () => {
  let backend: BackendHarness;

  beforeEach(async () => {
    backend = await BackendHarness.start({
      sites: { canvas: SITES.canvas!, [TUMAIL_ID]: SITES[TUMAIL_ID]! },
      extraConnectionTypes: [canvas, tumail],
    });
    saveCanvasPages(backend.browser);
    saveTumailPages(backend.browser);
  });

  afterEach(async () => {
    await backend.stop();
  });

  const hostsForgotten = () =>
    backend.browser.actions.flatMap((action) => (action.type === "forget-login" ? [action.hosts] : []));

  it("leaves another Connection's sign-on alone, so that revoking TUmail doesn't break Canvas", async () => {
    await backend.giveReadPermission("canvas", undefined);
    await backend.giveReadPermission(TUMAIL_ID, undefined);
    backend.browser.actions.length = 0;

    await backend.revokeReadPermission(TUMAIL_ID);

    const [hosts] = hostsForgotten();
    expect(hosts).toEqual(expect.arrayContaining([...TUMAIL_APP_HOSTS, "login.microsoftonline.com"]));
    expect(hosts).not.toContain("fim.temple.edu");
    expect(hosts).not.toContain("duosecurity.com");
    expect(hosts).not.toContain("instructure.com");
  });

  it("forgets the sign-on too once no Connection that uses it is left", async () => {
    await backend.giveReadPermission("canvas", undefined);
    await backend.giveReadPermission(TUMAIL_ID, undefined);
    await backend.revokeReadPermission(TUMAIL_ID);
    backend.browser.actions.length = 0;

    await backend.revokeReadPermission("canvas");

    const [hosts] = hostsForgotten();
    expect(hosts).toEqual(expect.arrayContaining(["fim.temple.edu", "duosecurity.com", "instructure.com"]));
  });

  it("forgets the sign-on when TUmail is the only one using it", async () => {
    await backend.giveReadPermission(TUMAIL_ID, undefined);
    backend.browser.actions.length = 0;

    await backend.revokeReadPermission(TUMAIL_ID);

    const [hosts] = hostsForgotten();
    expect(hosts).toEqual(expect.arrayContaining([...TUMAIL_APP_HOSTS, "login.microsoftonline.com", "fim.temple.edu", "duosecurity.com"]));
  });

  it("won't read TUmail after it's revoked, with the sign-on still in the browser for Canvas", async () => {
    await backend.giveReadPermission("canvas", undefined);
    await backend.giveReadPermission(TUMAIL_ID, undefined);
    await backend.revokeReadPermission(TUMAIL_ID);
    backend.browser.actions.length = 0;

    await expect(backend.browserAccess.read("https://outlook.office.com/mail/inbox")).rejects.toThrow(PageBlocked);
    expect(backend.browser.actions).toEqual([]);
  });
});
