import { describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import { createGuardPolicy } from "../src/network-guard.ts";

const canvas: Site = {
  name: "Canvas",
  homeUrl: "https://school.canvas.test/",
  loginHosts: ["canvas.test", "sign-in.test"],
  readOnlyRequests: [{ method: "POST", host: "school.canvas.test", path: /^\/api\/graphql$/ }],
  blockedPages: [{ path: /\/quizzes(\/|$)/ }, { path: /^\/courses\/\d+\/users/ }],
};
const portal: Site = { name: "TUportal", homeUrl: "https://portal.test/", loginHosts: ["portal.test", "sign-in.test"] };
const sites = { canvas, tuportal: portal };

function policy(permissions: string[] = ["canvas"]) {
  return createGuardPolicy({
    sites,
    publicHosts: ["bulletin.temple.test"],
    hasReadPermission: (site) => permissions.includes(site),
  });
}

const opening = (url: string) => ({ url, method: "GET", opensPage: true });
const loading = (url: string) => ({ url, method: "GET", opensPage: false });
const posting = (url: string, body = "") => ({
  url,
  method: "POST",
  opensPage: false,
  body,
  contentType: "application/x-www-form-urlencoded",
});

describe("where Buddy's Browser may go", () => {
  it("opens a Connection the Student gave a Read Permission for", () => {
    expect(policy().forReading().check(opening("https://school.canvas.test/courses")).allowed).toBe(true);
  });

  it("opens the Connection's single sign-on too", () => {
    expect(policy().forReading().check(opening("https://sign-in.test/idp")).allowed).toBe(true);
  });

  it("refuses a Connection with no Read Permission, even for something a page only loads", () => {
    const guard = policy([]).forReading();

    expect(guard.check(opening("https://school.canvas.test/")).allowed).toBe(false);
    expect(guard.check(loading("https://school.canvas.test/logo.png")).allowed).toBe(false);
  });

  it("allows a host two sites share when either has a Read Permission", () => {
    expect(policy(["tuportal"]).forReading().check(opening("https://sign-in.test/idp")).allowed).toBe(true);
  });

  it("opens a listed public page", () => {
    expect(policy().forReading().check(opening("https://bulletin.temple.test/plan")).allowed).toBe(true);
  });

  it("takes a listed public host to mean that host only, so that it can't reach a login beside it", () => {
    const guard = policy().forReading();

    expect(guard.check(opening("https://private.bulletin.temple.test/")).allowed).toBe(false);
    expect(guard.check(opening("https://temple.test/")).allowed).toBe(false);
  });

  it("refuses to open anywhere else", () => {
    const decision = policy().forReading().check(opening("https://elsewhere.test/"));

    expect(decision).toMatchObject({ allowed: false, why: expect.stringContaining("elsewhere.test") });
  });

  it("lets an open page load what it needs from a public address, such as a font or a script", () => {
    expect(policy().forReading().check(loading("https://cdn.elsewhere.test/app.js")).allowed).toBe(true);
  });

  it.each([
    "http://127.0.0.1:8787/activity",
    "http://localhost:8787/",
    "http://host.docker.internal:8787/",
    "http://10.0.0.8/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://buddys-browser/",
    "http://printer.local/",
    "http://router.lan/",
  ])("never reaches a private address, even to load something: %s", (url) => {
    expect(policy().forReading().check(loading(url)).allowed).toBe(false);
  });

  it.each(["http://localhost./", "http://host.docker.internal./", "http://printer.local./", "http://router./"])(
    "isn't fooled by a dot on the end of a private name: %s",
    (url) => {
      expect(policy().forReading().check(loading(url)).allowed).toBe(false);
    },
  );

  it("treats a site's host the same with a dot on the end", () => {
    const guard = policy([]).forReading();

    expect(guard.check(loading("https://school.canvas.test./logo.png")).allowed).toBe(false);
  });

  it.each(["file:///etc/passwd", "chrome://settings", "ftp://elsewhere.test/", "javascript:alert(1)", "not a url"])(
    "refuses what isn't the web: %s",
    (url) => {
      expect(policy().forReading().check(opening(url)).allowed).toBe(false);
    },
  );

  it.each(["about:blank", "data:text/plain,hi", "blob:https://school.canvas.test/1234"])(
    "leaves alone what never leaves the browser: %s",
    (url) => {
      expect(policy().forReading().check(loading(url)).allowed).toBe(true);
    },
  );
});

describe("requests that change something", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "post"])("blocks %s, even to a Connection", (method) => {
    const decision = policy().forReading().check({ url: "https://school.canvas.test/page_views", method, opensPage: false });

    expect(decision.allowed).toBe(false);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("allows %s, which only reads", (method) => {
    expect(policy().forReading().check({ url: "https://school.canvas.test/x", method, opensPage: false }).allowed).toBe(true);
  });

  it("allows a request the site's list says only reads", () => {
    expect(policy().forReading().check(posting("https://school.canvas.test/api/graphql")).allowed).toBe(true);
  });

  it.each([
    "https://school.canvas.test/api/graphql/extra",
    "https://school.canvas.test/api/%67raphql",
    "https://other.canvas.test/api/graphql",
  ])("doesn't stretch the read-only list to a request that's only similar: %s", (url) => {
    expect(policy().forReading().check(posting(url)).allowed).toBe(false);
  });

  it("doesn't stretch the read-only list to another method", () => {
    const decision = policy()
      .forReading()
      .check({ url: "https://school.canvas.test/api/graphql", method: "DELETE", opensPage: false });

    expect(decision.allowed).toBe(false);
  });

  it("uses each site's list for that site's hosts only", () => {
    const guard = createGuardPolicy({
      sites: { ...sites, other: { ...portal, readOnlyRequests: [{ method: "POST", host: "school.canvas.test", path: /^\/oops$/ }] } },
      publicHosts: [],
      hasReadPermission: () => true,
    }).forReading();

    expect(guard.check(posting("https://school.canvas.test/oops")).allowed).toBe(false);
  });
});

describe("arming for one approved step", () => {
  const step = {
    method: "POST",
    url: "https://school.canvas.test/forms/send",
    fields: [
      ["subject", "Advising"],
      ["authenticity_token", "abc"],
    ] as [string, string][],
  };
  const body = "subject=Advising&authenticity_token=abc";

  function armed() {
    const guard = policy().forApprovedStep();
    guard.arm(step);
    return guard;
  }

  it("blocks the request until it's armed", () => {
    const guard = policy().forApprovedStep();

    expect(guard.check(posting(step.url, body)).allowed).toBe(false);
    expect(guard.progress()).toBe("disarmed");
  });

  it("allows exactly one request once it's armed, and is disarmed after it", () => {
    const guard = armed();
    expect(guard.progress()).toBe("armed");

    expect(guard.check(posting(step.url, body)).allowed).toBe(true);
    expect(guard.progress()).toBe("sent");

    expect(guard.check(posting(step.url, body)).allowed).toBe(false);
  });

  it("doesn't use itself up on another request while it waits", () => {
    const guard = armed();

    expect(guard.check(posting("https://school.canvas.test/analytics", "x=1")).allowed).toBe(false);
    expect(guard.progress()).toBe("armed");
    expect(guard.check(posting(step.url, body)).allowed).toBe(true);
  });

  it.each([
    ["another address", posting("https://school.canvas.test/forms/other", body)],
    ["a different query", posting(`${step.url}?to=someone-else`, body)],
    ["another method", { ...posting(step.url, body), method: "PUT" }],
    ["a changed value", posting(step.url, "subject=Something+else&authenticity_token=abc")],
    ["a field added", posting(step.url, `${body}&cc=someone`)],
    ["a field left out", posting(step.url, "subject=Advising")],
    ["no body", { url: step.url, method: "POST", opensPage: false }],
    ["a body it can't read", { ...posting(step.url, JSON.stringify({ subject: "Advising" })), contentType: "application/json" }],
  ])("blocks %s while armed", (_, request) => {
    const guard = armed();

    expect(guard.check(request).allowed).toBe(false);
    expect(guard.progress()).toBe("armed");
  });

  it("takes the fields in any order, and a textarea's line endings as the browser sends them", () => {
    const guard = policy().forApprovedStep();
    guard.arm({ ...step, fields: [["note", "one\ntwo"], ["to", "a b"]] });

    expect(guard.check(posting(step.url, "to=a+b&note=one%0D%0Atwo")).allowed).toBe(true);
  });

  it("reads a multipart body", () => {
    const guard = policy().forApprovedStep();
    guard.arm({ ...step, fields: [["subject", "Advising"]] });
    const multipart = '--x\r\nContent-Disposition: form-data; name="subject"\r\n\r\nAdvising\r\n--x--\r\n';

    const decision = guard.check({ url: step.url, method: "POST", opensPage: false, body: multipart, contentType: "multipart/form-data; boundary=x" });

    expect(decision.allowed).toBe(true);
  });

  it("counts the step as sent even if the site's read-only list covers the same address", () => {
    const url = "https://school.canvas.test/api/graphql";
    const guard = policy().forApprovedStep();
    guard.arm({ method: "POST", url, fields: [["q", "1"]] });

    expect(guard.check(posting(url, "q=1")).allowed).toBe(true);

    expect(guard.progress()).toBe("sent");
  });

  it("has no way to arm the guard used for ordinary reading", () => {
    expect("arm" in policy().forReading()).toBe(false);
  });
});

describe("pages Buddy never opens", () => {
  it.each([
    "https://school.canvas.test/courses/1/quizzes/2",
    "https://school.canvas.test/courses/1/QUIZZES/2",
    "https://school.canvas.test/courses/1/%71uizzes/2",
    "https://school.canvas.test/courses/1/users",
    "https://school.canvas.test./courses/1/quizzes/2",
  ])("refuses %s when only reading", (url) => {
    const decision = policy().forReading().check(opening(url));

    expect(decision).toMatchObject({ allowed: false, why: expect.stringContaining("never") });
  });

  it("refuses it even armed for exactly that request, because an approved card can't open the door", () => {
    const url = "https://school.canvas.test/courses/1/quizzes/2/submit";
    const guard = policy().forApprovedStep();
    guard.arm({ method: "POST", url, fields: [["answer", "b"]] });

    expect(guard.check(posting(url, "answer=b")).allowed).toBe(false);
    expect(guard.progress()).toBe("armed");
  });

  it("refuses it even when the site's read-only list would have allowed it", () => {
    const guard = createGuardPolicy({
      sites: {
        canvas: { ...canvas, readOnlyRequests: [{ method: "POST", host: "school.canvas.test", path: /quizzes/ }] },
      },
      publicHosts: [],
      hasReadPermission: () => true,
    }).forReading();

    expect(guard.check(posting("https://school.canvas.test/quizzes/2")).allowed).toBe(false);
  });

  it("tells a caller that asks directly", () => {
    expect(policy().isBlockedPage("https://school.canvas.test/quizzes/2")).toBe(true);
    expect(policy().isBlockedPage("https://school.canvas.test/courses")).toBe(false);
    expect(policy().isBlockedPage("https://elsewhere.test/quizzes/2")).toBe(false);
  });
});

describe("the check of a login after a Takeover", () => {
  it("may open that site with no Read Permission", () => {
    expect(policy([]).forLoginCheck("canvas").check(opening("https://school.canvas.test/")).allowed).toBe(true);
    expect(policy([]).forLoginCheck("canvas").check(opening("https://sign-in.test/idp")).allowed).toBe(true);
  });

  it("gives no way into any other site", () => {
    expect(policy([]).forLoginCheck("canvas").check(opening("https://portal.test/")).allowed).toBe(false);
  });

  it("still can't change anything, or open a page Buddy never opens", () => {
    const guard = policy([]).forLoginCheck("canvas");

    expect(guard.check(posting("https://school.canvas.test/page_views")).allowed).toBe(false);
    expect(guard.check(opening("https://school.canvas.test/quizzes/2")).allowed).toBe(false);
  });

  it("doesn't carry over to the next read", () => {
    const shared = policy([]);
    shared.forLoginCheck("canvas");

    expect(shared.forReading().check(opening("https://school.canvas.test/")).allowed).toBe(false);
  });
});
