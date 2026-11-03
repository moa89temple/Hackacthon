import { describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import { HANDSHAKE_HOME, HANDSHAKE_ID, isHandshakeListing, isHandshakeLoginPage } from "../src/handshake-rules.ts";
import { createGuardPolicy } from "../src/network-guard.ts";
import { keepToReadablePages } from "../src/readable-pages.ts";
import { settings } from "../src/settings.ts";

const SCHOOL = "https://temple.joinhandshake.com";
const APP = "https://app.joinhandshake.com";
const site: Site = settings.sites[HANDSHAKE_ID];
const sites = { [HANDSHAKE_ID]: site };
const guards = (hasPermission = true) => createGuardPolicy({ sites, publicHosts: [], hasReadPermission: () => hasPermission });
const opening = (url: string, hasPermission = true) =>
  keepToReadablePages(guards(hasPermission).forReading(), sites).check({ url, method: "GET", opensPage: true });
const loaded = (url: string, method = "GET", body?: string) =>
  guards().forReading().check({ url, method, opensPage: false, ...(body ? { body, contentType: "application/json" } : {}) });

describe("the pages Buddy opens on Handshake", () => {
  it.each([
    ["the page a Takeover opens", HANDSHAKE_HOME],
    ["the jobs list", `${SCHOOL}/stu/postings`],
    ["the events list", `${SCHOOL}/stu/events`],
    ["the jobs list on the app's host", `${APP}/stu/postings`],
    ["the newer jobs list", `${APP}/job-search`],
    ["one job", `${APP}/stu/jobs/123`],
    ["one job on the newer page", `${APP}/job-search/123`],
    ["one event", `${APP}/stu/events/123`],
    ["its login page, to see that a login has gone", `${SCHOOL}/login`],
    ["the sign-on page, for the same reason", "https://fim.temple.edu/idp/profile/SAML2/Redirect/SSO"],
  ])("opens %s", (_, url) => {
    expect(opening(url!)).toEqual({ allowed: true });
  });

  it.each([
    ["applying for a job", `${APP}/stu/jobs/123/apply`],
    ["the Student's applications", `${APP}/stu/applications`],
    ["one application", `${APP}/stu/job_applications/5`],
    ["an event's RSVP", `${APP}/stu/events/123/rsvp`],
    ["registering for an event", `${APP}/stu/events/123/register`],
    ["registrations", `${APP}/stu/event_registrations`],
    ["messages", `${APP}/stu/messages`],
    ["one conversation", `${APP}/stu/conversations/5`],
    ["the inbox", `${APP}/inbox`],
    ["another student's profile", `${APP}/stu/users/5`],
    ["profiles", `${APP}/profiles/abc`],
    ["the feed", `${APP}/stu/feed`],
    ["saved jobs", `${APP}/stu/saved_jobs`],
    ["the Student's documents", `${APP}/stu/documents`],
    ["a job page with more after it", `${APP}/stu/jobs/123/anything`],
    ["a job that isn't a number", `${APP}/stu/jobs/abc`],
    ["an employer's page", `${APP}/stu/employers/5`],
    ["any other host of theirs", "https://www.joinhandshake.com/stu/postings"],
  ])("won't open %s", (_, url) => {
    expect(opening(url!).allowed).toBe(false);
  });

  it("opens nothing there with no Read Permission", () => {
    expect(opening(`${SCHOOL}/stu/postings`, false).allowed).toBe(false);
    expect(opening(`${APP}/stu/jobs/123`, false).allowed).toBe(false);
  });

  it("gives the site no form Buddy could ask to submit", () => {
    expect(site.formPages).toBeUndefined();
    expect(site.sending).toBeUndefined();
  });

  it("blocks nothing on the sign-on it shares with every other Connection", () => {
    const everySite = createGuardPolicy({ sites: settings.sites, publicHosts: [], hasReadPermission: () => true });

    expect(everySite.isBlockedPage("https://fim.temple.edu/idp/profile/SAML2/Redirect/SSO")).toBe(false);
    expect(everySite.isBlockedPage("https://fim.temple.edu/idp/users/feed")).toBe(false);
  });
});

describe("what a Handshake page may load", () => {
  it("lets what only reads go through", () => {
    expect(loaded(`${APP}/assets/app.js`)).toEqual({ allowed: true });
  });

  it.each([
    ["a job's apply address", `${APP}/stu/jobs/123/apply`],
    ["an RSVP", `${APP}/stu/events/123/rsvp`],
    ["saving a job", `${APP}/saved_jobs`],
    ["a message", `${APP}/stu/messages/5`],
  ])("refuses %s, even by GET", (_, url) => {
    expect(loaded(url!).allowed).toBe(false);
  });

  it.each([
    ["GraphQL, which does everything by a body field", `${APP}/hs/graphql`],
    ["GraphQL at its other address", `${APP}/graphql`],
    ["applying", `${APP}/stu/jobs/123/apply`],
    ["anything else", `${APP}/stu/postings`],
  ])("refuses a POST to %s", (_, url) => {
    expect(loaded(url!, "POST", '{"operationName":"JobSearch"}').allowed).toBe(false);
  });

  it("refuses GraphQL by GET too, because one address does everything", () => {
    expect(loaded(`${APP}/hs/graphql?query=mutation`).allowed).toBe(false);
  });

  it("allows no request that changes something by its address", () => {
    expect(site.readOnlyRequests).toBeUndefined();
  });
});

describe("telling Handshake's addresses apart", () => {
  it.each([
    [`${SCHOOL}/login`],
    [`${APP}/login?next=x`],
    ["https://fim.temple.edu/idp/profile"],
    ["https://api-1.duosecurity.com/frame"],
    ["not an address"],
  ])("takes %s for somewhere to log in", (url) => {
    expect(isHandshakeLoginPage(url)).toBe(true);
  });

  it.each([[`${SCHOOL}/stu`], [`${APP}/stu/postings`], [`${APP}/stu/jobs/1`]])("doesn't take %s for somewhere to log in", (url) => {
    expect(isHandshakeLoginPage(url)).toBe(false);
  });

  it("knows a listing's address by its host, however it's spelled", () => {
    expect(isHandshakeListing(`${APP}/stu/jobs/1`)).toBe(true);
    expect(isHandshakeListing(`${SCHOOL}/stu/events/1`)).toBe(true);
    expect(isHandshakeListing("https://joinhandshake.com.evil.example/stu/jobs/1")).toBe(false);
    expect(isHandshakeListing("https://www.nursing-foundation.example/scholarship")).toBe(false);
  });
});
