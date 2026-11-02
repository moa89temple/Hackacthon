import { describe, expect, it } from "vitest";
import { createGuardPolicy } from "../src/network-guard.ts";
import { keepToReadablePages } from "../src/readable-pages.ts";
import { settings } from "../src/settings.ts";
import { isTuportalLoginPage, TUPORTAL_ID, TUPORTAL_SITE } from "../src/tuportal-rules.ts";
import { BALANCE_PAGE, BANNER, BANNER_MENU, BANNER_SIGN_ON, HOLDS_PAGE, HOME_PAGE, TUPORTAL } from "./support/tuportal-pages.ts";

const sites = { [TUPORTAL_ID]: TUPORTAL_SITE };
/** The real rules, with the Read Permission given, so that only the rules can be what refuses. */
const guards = createGuardPolicy({ sites, publicHosts: settings.publicHosts, hasReadPermission: () => true });
const reading = keepToReadablePages(guards.forReading(), sites);

const opening = (url: string) => ({ url, method: "GET", opensPage: true });
const loading = (url: string, method = "GET") => ({ url, method, opensPage: false });

describe("the pages the reader opens", () => {
  it.each([HOME_PAGE, HOLDS_PAGE, BANNER_SIGN_ON, BANNER_MENU, `${BANNER_SIGN_ON}?ticket=ST-made-up`, BALANCE_PAGE, `${TUPORTAL}/`])("may open %s", (url) => {
    expect(reading.check(opening(url))).toEqual({ allowed: true });
  });

  it("may be sent to the sign-on page, so that a read can see a login has expired", () => {
    expect(reading.check(opening("https://fim.temple.edu/idp/profile/SAML2/Redirect/SSO"))).toEqual({ allowed: true });
  });

  it.each([
    `${TUPORTAL}/group/home/student-tools`,
    `${TUPORTAL}/group/home/some-other-channel`,
    `${TUPORTAL}/group/home/costs-and-aid/statement`,
    `${TUPORTAL}/web/guest/anything`,
    "https://api-made-up.duosecurity.com/frame/prompt",
  ])("won't open anything else, such as %s", (url) => {
    expect(reading.check(opening(url)).allowed).toBe(false);
  });
});

describe("the pages opened on Banner", () => {
  it.each([HOLDS_PAGE, BANNER_SIGN_ON, BANNER_MENU])("%s only ever reads", (url) => {
    expect(guards.forReading().check(loading(url, "POST")).allowed).toBe(false);
  });

  it("are only Banner's, and the same address on the portal isn't one", () => {
    expect(reading.check(opening(`${TUPORTAL}/prod8/bwskoacc.P_ViewHold`)).allowed).toBe(false);
  });
});

describe("pages that are refused whichever way they're reached", () => {
  const NEVER_LOADED: Record<string, string[]> = {
    "paying": [
      `${TUPORTAL}/group/home/makepayment`,
      `${TUPORTAL}/web/home-community/tupay`,
      `${TUPORTAL}/group/home/tupay`,
      `${TUPORTAL}/group/home/make-a-payment`,
      `${TUPORTAL}/group/home/PAY`,
      `${TUPORTAL}/group/home/%70ay`,
      "https://tupay.temple.edu/",
      "https://tupay.temple.edu/anything/at/all",
      "https://secure.touchnet.com/C21551_tsa/web/login.jsp",
      "https://secure.touchnet.net/C21551_tsa/web/login.jsp",
    ],
    "changing registration": [
      `${TUPORTAL}/group/home/classes/add`,
      `${TUPORTAL}/group/home/enroll`,
      `${TUPORTAL}/group/home/registration`,
      `${TUPORTAL}/group/home/register-for-classes`,
      `${TUPORTAL}/group/home/add-drop`,
      `${TUPORTAL}/group/home/plan-your-schedule`,
      `${TUPORTAL}/group/home/withdrawal`,
      "https://prd-wlssb.temple.edu/prod8/bwskfreg.P_AltPin",
      "https://prd-wlssb.temple.edu/prod8/bwckcoms.P_Regs",
      "https://prd-xereg.temple.edu/StudentRegistrationSsb/ssb/classRegistration/classRegistration",
    ],
    "forms": [
      `${TUPORTAL}/group/home/form`,
      `${TUPORTAL}/group/home/forms/anything`,
      `${TUPORTAL}/group/home/veteran-declaration`,
      `${TUPORTAL}/group/home/petition`,
      `${TUPORTAL}/group/home/costs-and-aid/submit`,
    ],
    "logging out, which would lose the login": [
      `${TUPORTAL}/c/portal/logout`,
      "https://fim.temple.edu/idp/profile/Logout",
      "https://prd-wlssb.temple.edu/prod8/twbkwbis.P_Logout",
    ],
    "an action sent as an ordinary link in the portal": [`${HOME_PAGE}?p_p_id=made_up&p_p_lifecycle=1&_made_up_action=drop`],
    "anything else on Banner, which can act on a GET": [
      `${BANNER}/`,
      `${HOLDS_PAGE}?anything=at-all`,
      `${BANNER}/prod8/twbkwbis.P_GenMenu?name=bmenu.P_RegMnu`,
      `${BANNER}/prod8/twbkwbis.P_GenMenu`,
      `${BANNER}/prod8/twbkwbis.P_GenMenu?name=bmenu.P_MainMnu&next=bwskfreg.P_AltPin`,
      `${BANNER}/prod8/bwskoacc.P_ViewHold/../bwskfreg.P_AltPin`,
      `${BANNER}/prod8/bwskoacc.P_ViewHold2`,
      `${BANNER}/ssomanager/c/other`,"https://prd-wlssb.temple.edu/prod8/bwskoacc.P_ViewAcct", "https://prd-xereg.temple.edu/anything"],
    // Temple's sign-on would log a frame or a script in to it, Connection or not.
    "a Temple host nobody has listed": ["https://prd-not-listed.temple.edu/prod8/bwskfreg.P_AltPin", "https://navigate-not-listed.temple.edu/"],
  };

  describe.each(Object.keys(NEVER_LOADED))("%s", (kind) => {
    it.each(NEVER_LOADED[kind]!)("%s", (url) => {
      // As a page, and as what a page loads for itself in a frame or a script.
      expect(guards.forReading().check(opening(url)).allowed).toBe(false);
      expect(guards.forReading().check(loading(url)).allowed).toBe(false);
    });
  });
});

describe("what a page loads for itself", () => {
  it("may read other pages of the portal, such as its stylesheets", () => {
    expect(guards.forReading().check(loading(`${TUPORTAL}/o/made-up-theme/main.css`))).toEqual({ allowed: true });
  });

  it("may load from a public page of Temple's, and from outside Temple", () => {
    expect(guards.forReading().check(loading("https://www.temple.edu/made-up.css"))).toEqual({ allowed: true });
    expect(guards.forReading().check(loading("https://cdn.example.com/made-up.css"))).toEqual({ allowed: true });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("can't %s anything, so nothing is ever submitted", (method) => {
    expect(guards.forReading().check(loading(HOLDS_PAGE, method)).allowed).toBe(false);
    expect(guards.forReading().check(loading(`${TUPORTAL}/group/home/costs-and-aid`, method)).allowed).toBe(false);
  });
});

describe("the sign-on's own pages still work for logging in", () => {
  it.each([
    "https://fim.temple.edu/idp/profile/SAML2/POST/SSO",
    "https://fim.temple.edu/idp/profile/SAML2/Redirect/SSO",
    "https://api-made-up.duosecurity.com/frame/v4/auth/prompt",
    "https://api-made-up.duosecurity.com/oauth/v1/authorize",
  ])("%s isn't blocked", (url) => {
    expect(guards.isBlockedPage(url)).toBe(false);
  });
});

describe("with no Read Permission", () => {
  it("nothing of TUportal is reached, even with Temple's sign-on still logged in", () => {
    const noPermission = createGuardPolicy({ sites, publicHosts: [], hasReadPermission: () => false });

    expect(noPermission.forReading().check(opening(HOLDS_PAGE)).allowed).toBe(false);
    expect(noPermission.forReading().check(loading(`${TUPORTAL}/o/made-up-theme/main.css`)).allowed).toBe(false);
  });
});

describe("as a site", () => {
  it("is set up in Buddy's settings, as a Connection with no forms it can submit", () => {
    expect(settings.sites[TUPORTAL_ID]).toBe(TUPORTAL_SITE);
    expect(settings.connectionTypes.map((type) => type.id)).toContain(TUPORTAL_ID);
    expect(TUPORTAL_SITE.isConnection).toBe(true);
    expect("formPages" in TUPORTAL_SITE).toBe(false);
    expect("readOnlyRequests" in TUPORTAL_SITE).toBe(false);
  });

  it("never claims all of temple.edu, which would let the sign-on log it in to anything", () => {
    expect(TUPORTAL_SITE.loginHosts).not.toContain("temple.edu");
    expect(guards.isBlockedPage("https://www.temple.edu/")).toBe(false);
  });
});

describe("somewhere to log in", () => {
  it.each(["https://fim.temple.edu/idp/profile/SAML2/Redirect/SSO", "https://api-made-up.duosecurity.com/frame/prompt", `${TUPORTAL}/c/portal/login`, "not an address"])(
    "%s is",
    (address) => {
      expect(isTuportalLoginPage(address)).toBe(true);
    },
  );

  it.each([HOME_PAGE, HOLDS_PAGE, "https://tuportal.temple.edu/group/home"])("%s isn't", (address) => {
    expect(isTuportalLoginPage(address)).toBe(false);
  });
});
