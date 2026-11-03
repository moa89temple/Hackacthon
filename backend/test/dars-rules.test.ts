import { describe, expect, it } from "vitest";
import { DARS_SITE, isDarsLoginPage, isDarsPage } from "../src/dars-rules.ts";
import { createGuardPolicy } from "../src/network-guard.ts";
import { keepToReadablePages } from "../src/readable-pages.ts";
import { settings } from "../src/settings.ts";

const DARS = "https://prd-dars.temple.edu";
const LIST = `${DARS}/selfservice/audit/list.html`;
const AUDIT = `${DARS}/selfservice/audit/read.html?id=made-up`;

const guards = (hasPermission = true) => {
  const sites = { dars: DARS_SITE };
  const policy = createGuardPolicy({ sites, publicHosts: [], hasReadPermission: () => hasPermission });
  return { policy, reading: keepToReadablePages(policy.forReading(), sites) };
};
const opening = (url: string) => guards().reading.check({ url, method: "GET", opensPage: true }).allowed;
const loading = (url: string) => guards().reading.check({ url, method: "GET", opensPage: false }).allowed;

describe("what Buddy opens on DARS", () => {
  it("opens the list of audits, an audit, and the steps a login check goes through", () => {
    for (const url of [LIST, AUDIT, `${DARS}/selfservice/`, `${DARS}/selfservice`, `${DARS}/selfservice/general/loginroute.html`, "https://dars.temple.edu/", "https://fim.temple.edu/idp/profile/SAML2/Unsolicited/SSO?providerId=x"]) {
      expect(opening(url), url).toBe(true);
    }
  });

  it("opens nothing else on DARS, however ordinary it sounds", () => {
    for (const path of ["/selfservice/audit/history.html", "/selfservice/general/home.html", "/selfservice/help.html", "/somewhere-else", "/"]) {
      expect(opening(`${DARS}${path}`), path).toBe(false);
    }
  });

  it("opens nothing with no Read Permission", () => {
    const { policy } = guards(false);

    expect(policy.forReading().check({ url: LIST, method: "GET", opensPage: true }).allowed).toBe(false);
  });
});

describe("reads stay reads", () => {
  it("never opens the pages for running or deleting an audit, even as something a page loads", () => {
    for (const path of [
      "/selfservice/audit/create.html",
      "/selfservice/audit/delete.html",
      "/selfservice/audit/run.html",
      "/selfservice/audit/whatif.html",
      "/selfservice/AUDIT/%63reate.html",
    ]) {
      expect(opening(`${DARS}${path}`), path).toBe(false);
      expect(loading(`${DARS}${path}`), path).toBe(false);
      expect(guards().policy.isBlockedPage(`${DARS}${path}`), path).toBe(true);
    }
  });

  it("never opens plans, exceptions, comments, course changes or logging out", () => {
    for (const path of ["/selfservice/planner/list.html", "/selfservice/udirect/roadmap.html", "/selfservice/exceptions/list.html", "/selfservice/comments/list.html", "/selfservice/general/logout.html"]) {
      expect(guards().policy.isBlockedPage(`${DARS}${path}`), path).toBe(true);
    }
  });

  it("refuses anything it doesn't know, even as something a page loads, whatever it's called", () => {
    for (const path of ["/selfservice/runAudit.html", "/selfservice/runDeclaredPrograms", "/api/audits/generate", "/selfservice/something/new-to-buddy.html", "/selfservice/audit/create.html%3F.css"]) {
      expect(loading(`${DARS}${path}`), path).toBe(false);
    }
  });

  it("refuses those on the address Temple gives Students too, which is on the same site", () => {
    for (const path of ["/selfservice/audit/create.html", "/selfservice/audit/delete.html", "/selfservice/audit/list.html", "/selfservice/styles.css"]) {
      expect(loading(`https://dars.temple.edu${path}`), path).toBe(false);
    }
  });

  it("lets a page load its own look", () => {
    for (const path of ["/selfservice/css/site.css", "/selfservice/js/site.js", "/selfservice/images/check.png"]) {
      expect(loading(`${DARS}${path}`), path).toBe(true);
    }
  });

  it("doesn't let the list or an audit be asked to do something by what follows the ?", () => {
    for (const query of ["?action=delete", "?delete=1", "?id=x&run=1", "?id=1&runAudit=true", "?method=create", ""]) {
      expect(guards().policy.isBlockedPage(`${DARS}/selfservice/audit/read.html${query}`), `read ${query}`).toBe(true);
    }
    for (const query of ["?action=delete", "?run=1", "?id=x"]) {
      expect(guards().policy.isBlockedPage(`${LIST}${query}`), `list ${query}`).toBe(true);
    }
  });

  it("doesn't take the word run for an action when it's only inside an audit's id", () => {
    expect(guards().policy.isBlockedPage(`${DARS}/selfservice/audit/read.html?id=JobQueueRun!!!!abc`)).toBe(false);
  });

  it("refuses every request that could change something, so an audit can't be run or deleted", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const url of [LIST, AUDIT, `${DARS}/selfservice/audit/create.html`, `${DARS}/selfservice/saml/SSO`]) {
        expect(guards().policy.forReading().check({ url, method, opensPage: true }).allowed, `${method} ${url}`).toBe(false);
      }
    }
  });

  it("has no list of requests that only read, so nothing has been let through for later", () => {
    expect(DARS_SITE.readOnlyRequests ?? []).toEqual([]);
  });

  it("doesn't reach Temple's sign-on's logout, which would log out every Temple Connection", () => {
    expect(guards().policy.isBlockedPage("https://fim.temple.edu/idp/profile/Logout")).toBe(true);
  });
});

describe("Banner", () => {
  it("isn't part of DARS: no page of it is among DARS's own", () => {
    const hosts = [new URL(DARS_SITE.homeUrl).hostname, ...DARS_SITE.loginHosts];

    expect(hosts.filter((host) => /wlssb|xereg|banner/.test(host))).toEqual([]);
  });

  it("is still refused for a browser that only has DARS's Read Permission", () => {
    const sites = settings.sites;
    const policy = createGuardPolicy({ sites, publicHosts: [], hasReadPermission: (id) => id === "dars" });

    for (const address of ["https://prd-wlssb.temple.edu/prod8/bwskoacc.P_ViewHold", "https://prd-wlssb.temple.edu/prod8/bwskfreg.P_AddDropCrse"]) {
      expect(policy.forReading().check({ url: address, method: "GET", opensPage: true }).allowed, address).toBe(false);
    }
  });
});

describe("telling pages apart", () => {
  it("knows which page an address is, whatever follows the ?", () => {
    expect(isDarsPage("list", LIST)).toBe(true);
    expect(isDarsPage("audit", AUDIT)).toBe(true);
    expect(isDarsPage("audit", LIST)).toBe(false);
    expect(isDarsPage("audit", "https://elsewhere.example/selfservice/audit/read.html")).toBe(false);
  });

  it("takes anywhere off DARS, or its way to the sign-on, for somewhere to log in", () => {
    expect(isDarsLoginPage("https://fim.temple.edu/idp/profile/SAML2/Redirect/SSO?execution=e1s1")).toBe(true);
    expect(isDarsLoginPage(`${DARS}/selfservice/general/loginroute.html`)).toBe(true);
    expect(isDarsLoginPage(LIST)).toBe(false);
  });
});
