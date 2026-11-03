import { describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import { createGuardPolicy, type ApprovedEmail } from "../src/network-guard.ts";
import { settings } from "../src/settings.ts";
import { TUMAIL_APP_HOSTS, TUMAIL_ID, tumailReadablePages, tumailReadOnlyRequests } from "../src/tumail-rules.ts";
import { madeUpSendRequest, SERVICE } from "./support/outlook-send.ts";

const SITES = settings.sites as Record<string, Site>;
const EMAIL: ApprovedEmail = { to: "student@temple.edu", subject: "Hold on my account", body: "Hello,\n\nCan you help?\n\nThanks" };

const policy = (permissions: string[] = [TUMAIL_ID]) =>
  createGuardPolicy({ sites: SITES, publicHosts: [], hasReadPermission: (site) => permissions.includes(site) });
const opening = (url: string) => ({ url, method: "GET", opensPage: true });
const sendRequest = (changes = {}) => madeUpSendRequest(EMAIL, changes);

describe("sending while the guard is shut", () => {
  it("refuses the send request before the routine opens the guard", () => {
    expect(policy().forSending(TUMAIL_ID).check(sendRequest()).allowed).toBe(false);
  });

  it("refuses it for reading, for checking a login, and for an approved step, none of which can open", () => {
    const guards = policy();
    for (const guard of [guards.forReading(), guards.forLoginCheck(TUMAIL_ID), guards.forApprovedStep()]) {
      expect(guard.check(sendRequest()).allowed).toBe(false);
      expect("open" in guard).toBe(false);
    }
  });

  it("isn't opened by another send's guard", () => {
    const guards = policy();
    guards.forSending(TUMAIL_ID).open(EMAIL);
    expect(guards.forSending(TUMAIL_ID).check(sendRequest()).allowed).toBe(false);
    expect(guards.forReading().check(sendRequest()).allowed).toBe(false);
  });

  it("can't be opened for a site with no rule for sending", () => {
    const guard = policy(["canvas"]).forSending("canvas");
    expect(() => guard.open(EMAIL)).toThrow();
    expect(guard.check(sendRequest()).allowed).toBe(false);
  });
});

describe("the one send", () => {
  it("goes through once, and then the guard is shut for good", () => {
    const guard = policy().forSending(TUMAIL_ID);
    guard.open(EMAIL);

    expect(guard.progress()).toBe("open");
    expect(guard.check(sendRequest()).allowed).toBe(true);
    expect(guard.progress()).toBe("sent");
    expect(guard.check(sendRequest()).allowed).toBe(false);
    expect(() => guard.open(EMAIL)).toThrow();
  });

  it("is refused once the routine has closed the guard, whatever the reason, and can't be opened again", () => {
    const guard = policy().forSending(TUMAIL_ID);
    guard.open(EMAIL);
    guard.close();

    expect(guard.progress()).toBe("closed");
    expect(guard.check(sendRequest()).allowed).toBe(false);
    expect(() => guard.open(EMAIL)).toThrow();
  });

  it("stays \"sent\" when it's closed afterwards, so that nobody thinks it's safe to try again", () => {
    const guard = policy().forSending(TUMAIL_ID);
    guard.open(EMAIL);
    guard.check(sendRequest());
    guard.close();
    expect(guard.progress()).toBe("sent");
  });

  it("needs TUmail's Read Permission, even with the guard open", () => {
    const guard = policy(["canvas"]).forSending(TUMAIL_ID);
    guard.open(EMAIL);
    expect(guard.check(sendRequest()).allowed).toBe(false);
    expect(guard.progress()).toBe("open");
  });

  it.each(TUMAIL_APP_HOSTS)("is allowed on %s", (host) => {
    const guard = policy().forSending(TUMAIL_ID);
    guard.open(EMAIL);
    expect(guard.check({ ...sendRequest(), url: `https://${host}${SERVICE}?action=CreateItem&app=Mail` }).allowed).toBe(true);
  });
});

describe("with the guard open, it still refuses", () => {
  const stillOpenAfter = (request: Parameters<ReturnType<ReturnType<typeof policy>["forSending"]>["check"]>[0]) => {
    const guard = policy().forSending(TUMAIL_ID);
    guard.open(EMAIL);
    expect(guard.check(request).allowed).toBe(false);
    expect(guard.progress()).toBe("open");
  };

  it.each(["UpdateItem", "SendItem", "DeleteItem", "MoveItem", "ApplyConversationAction", "MarkAllItemsAsRead"])("%s, by address or by header", (action) => {
    stillOpenAfter({ ...sendRequest(), url: `https://outlook.office.com${SERVICE}?action=${action}&app=Mail` });
    stillOpenAfter({ ...sendRequest(), headers: { action } });
  });

  it("an address with a second action in it", () => {
    stillOpenAfter({ ...sendRequest(), url: `https://outlook.office.com${SERVICE}?action=CreateItem&action=DeleteItem` });
  });

  it("anywhere else in Outlook, or anywhere else at all", () => {
    stillOpenAfter({ ...sendRequest(), url: "https://outlook.office.com/owa/graphql?action=CreateItem" });
    stillOpenAfter({ ...sendRequest(), url: `https://evil.test${SERVICE}?action=CreateItem` });
  });

  it("another method", () => {
    stillOpenAfter({ ...sendRequest(), method: "PUT" });
  });

  it.each([
    ["saving rather than sending", { disposition: "SaveOnly" }],
    ["another recipient", { to: ["someone-else@temple.edu"] }],
    ["a second recipient", { to: [EMAIL.to, "someone-else@temple.edu"] }],
    ["nobody at all", { to: [] }],
    ["a copy to someone", { cc: ["someone-else@temple.edu"] }],
    ["a blind copy to someone", { bcc: ["someone-else@temple.edu"] }],
    ["another subject", { subject: "Something else" }],
    ["other words", { body: "<div>Something else entirely</div>" }],
    ["the approved words with more after them", { body: "<div>Hello, Can you help? Thanks P.S. and more</div>" }],
    ["an attachment", { attachments: [{ Name: "a.txt" }] }],
    ["two messages at once", { secondItem: true }],
  ])("a request carrying %s", (_, changes) => {
    stillOpenAfter(sendRequest(changes));
  });

  it("a request whose data it can't read", () => {
    stillOpenAfter({ ...sendRequest(), body: "not json", headers: { action: "CreateItem" } });
    stillOpenAfter({ url: sendRequest().url, method: "POST", opensPage: false });
  });

  it("a request whose body and header say different things", () => {
    const other = madeUpSendRequest({ ...EMAIL, to: "someone-else@temple.edu" });
    stillOpenAfter({ ...sendRequest(), headers: { action: "CreateItem", "x-owa-urlpostdata": encodeURIComponent(other.body!) } });
  });

  it("a page other than writing an email, or those a read may open", () => {
    const guard = policy([TUMAIL_ID, "canvas"]).forSending(TUMAIL_ID);
    guard.open(EMAIL);
    for (const address of ["https://outlook.office.com/mail/sentitems", "https://outlook.office.com/calendar/view/month", "https://templeu.instructure.com/courses"]) {
      expect(guard.check(opening(address)).allowed).toBe(false);
    }
  });
});

describe("what the guard says it stopped while open, for working out what Outlook really does", () => {
  const open = () => {
    const guard = policy().forSending(TUMAIL_ID);
    guard.open(EMAIL);
    return guard;
  };
  const posted = (address: string, body = "SECRET WORDS") => ({ url: address, method: "POST", opensPage: false, body, contentType: "application/json" });

  it("names the place and the action, and none of what was in the request", () => {
    const guard = open();

    guard.check(posted("https://outlook.office.com/owa/graphql?secret=SECRET"));
    guard.check(posted("https://outlook.office.com/owa/service.svc?action=SendItem&id=SECRET"));

    const said = guard.refusals().join(" ");
    expect(said).toContain("/owa/graphql");
    expect(said).toContain("/owa/service.svc");
    expect(said).toContain("SendItem");
    expect(said).not.toContain("SECRET");
  });

  it("leaves out anything on another host, and an odd-looking address", () => {
    const guard = open();

    guard.check(posted("https://evil.test/collect"));
    guard.check(posted("https://outlook.office.com/owa/SECRET%40temple.edu/thing"));

    expect(guard.refusals().join(" ")).not.toMatch(/evil|SECRET/);
  });

  it("says nothing of what it stopped before opening or after closing", () => {
    const guard = policy().forSending(TUMAIL_ID);
    guard.check(posted("https://outlook.office.com/owa/graphql"));
    guard.open(EMAIL);
    guard.close();
    guard.check(posted("https://outlook.office.com/owa/graphql"));
    expect(guard.refusals()).toEqual([]);
  });

  it("doesn't let a chatty page make a long story of it", () => {
    const guard = open();
    for (let count = 0; count < 50; count++) guard.check(posted(`https://outlook.office.com/owa/path${count}`));
    expect(guard.refusals().length).toBeLessThanOrEqual(8);
  });
});

describe("reaching the window to write in", () => {
  it.each(TUMAIL_APP_HOSTS)("opens on %s only for the send routine", (host) => {
    const address = `https://${host}/mail/deeplink/compose`;
    expect(policy().forSending(TUMAIL_ID).check(opening(address)).allowed).toBe(true);
  });

  it("can still see that a login has expired", () => {
    const guard = policy().forSending(TUMAIL_ID);
    expect(guard.check(opening("https://login.microsoftonline.com/common/oauth2/authorize")).allowed).toBe(true);
  });

  it("doesn't open with no Read Permission", () => {
    expect(policy([]).forSending(TUMAIL_ID).check(opening("https://outlook.office.com/mail/deeplink/compose")).allowed).toBe(false);
  });
});

describe("reading didn't get any broader", () => {
  it("still lists only the inbox's pages and the sign-in pages", () => {
    const pages = tumailReadablePages(["outlook.office.com"]);
    expect(pages.some((page) => page.host === "outlook.office.com" && page.path.test("/mail/deeplink/compose"))).toBe(false);
  });

  it("still lists no request that writes", () => {
    const known = tumailReadOnlyRequests(["outlook.office.com"]).filter((request) => request.query);
    for (const request of known) {
      expect(request.query!.test("?action=CreateItem&app=Mail")).toBe(false);
      expect(request.headers!.action!.test("CreateItem")).toBe(false);
    }
  });
});
