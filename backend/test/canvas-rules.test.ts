import { describe, expect, it } from "vitest";
import { keepToReadablePages } from "../src/readable-pages.ts";
import { createGuardPolicy } from "../src/network-guard.ts";
import { settings } from "../src/settings.ts";

const HOME = "https://templeu.instructure.com";
const sites = settings.sites;

/** The real rules, with the Read Permission given, so that only the rules can be what refuses. */
const guards = createGuardPolicy({ sites, publicHosts: settings.publicHosts, hasReadPermission: () => true });
const reading = keepToReadablePages(guards.forReading(), sites);

const opening = (path: string, host = HOME) => ({ url: `${host}${path}`, method: "GET", opensPage: true });
const loading = (path: string) => ({ url: `${HOME}${path}`, method: "GET", opensPage: false });

const BLOCKED = {
  "rosters and people": [
    "/courses/101/users",
    "/courses/101/users/55",
    "/courses/101/users.json",
    "/api/v1/courses/101/users",
    "/api/v1/courses/101/enrollments",
    "/api/v1/courses/101/search_users",
    "/api/v1/courses/101/recent_students",
    "/users/55",
    "/api/v1/users/55",
    "/api/v1/search/recipients",
    "/courses/101/sections/7",
  ],
  "discussion boards": [
    "/courses/101/discussion_topics",
    "/courses/101/discussion_topics/9",
    "/courses/101/discussion_topics/9/entries",
    "/groups/8/discussion_topics/9",
    "/api/v1/courses/101/discussion_topics/9",
    "/api/v1/courses/101/discussion_topics/9/view",
    "/api/v1/courses/101/discussion_topics/9/entries",
  ],
  "groups and classmates' work": [
    "/groups",
    "/groups/8",
    "/courses/101/groups",
    "/api/v1/groups/8/users",
    "/api/v1/courses/101/groups",
    "/api/v1/users/self/groups",
    "/courses/101/collaborations",
    "/courses/101/gradebook",
    "/courses/101/gradebook/speed_grader",
    "/courses/101/assignments/5/peer_reviews",
    "/courses/101/assignments/5/anonymous_submissions/abc",
    "/courses/101/assignments/5/submissions/56",
  ],
  "quizzes and exams": [
    "/courses/101/quizzes",
    "/courses/101/quizzes/3",
    "/courses/101/quizzes/3/take",
    "/courses/101/quizzes.json",
    "/api/v1/courses/101/quizzes",
    "/api/v1/courses/101/quizzes/3/submissions",
    "/api/v1/quiz_submissions/3/questions",
    "/courses/101/quiz_submissions/3",
    "/api/quiz/v1/courses/101/quizzes",
    "/courses/101/external_tools/12",
  ],
  "assignment submission": [
    "/courses/101/assignments/5",
    "/courses/101/assignments/5/submit",
    "/courses/101/assignments/5/submissions",
    "/api/v1/courses/101/assignments/5/submissions",
    "/api/v1/courses/101/assignments/5/submissions/self",
    "/api/v1/courses/101/assignments/5/submissions/self/files",
  ],
};

const ALL_BLOCKED = Object.entries(BLOCKED).flatMap(([kind, paths]) => paths.map((path) => [kind, path] as const));

describe("how Canvas is set up", () => {
  it("is a Connection whose id is its site's, because the guard checks the Read Permission by it", () => {
    const connection = settings.connectionTypes.find((type) => type.name === "Canvas");

    expect(connection?.id).toBe("canvas");
    expect(settings.sites[connection!.id as "canvas"]).toMatchObject({ name: "Canvas", isConnection: true });
    expect(connection?.logsIn).toBe(true);
  });

  it("can't submit a form anywhere on it", () => {
    expect("formPages" in settings.sites.canvas).toBe(false);
  });
});

describe("the blocklist", () => {
  it.each(ALL_BLOCKED)("never opens %s: %s", (_kind, path) => {
    expect(guards.isBlockedPage(`${HOME}${path}`)).toBe(true);
    expect(guards.forReading().check(opening(path)).allowed).toBe(false);
    expect(guards.forReading().check(loading(path)).allowed).toBe(false);
    expect(guards.forLoginCheck("canvas").check(opening(path)).allowed).toBe(false);
  });

  it.each([
    "/COURSES/101/QUIZZES",
    "/courses/101/%71uizzes/3",
    "/courses/101/users%2F55",
    "//courses//101//users",
    "/courses/101/discussion_topics/",
    "/courses/101/quizzes;x=1",
  ])("can't be reached by spelling the address another way: %s", (path) => {
    expect(guards.isBlockedPage(`${HOME}${path}`)).toBe(true);
  });

  it("leaves what the pages Buddy reads need to load", () => {
    for (const path of [
      "/api/v1/courses/101/assignment_groups",
      "/api/v1/courses/101/students/submissions",
      "/api/v1/users/self/favorites/courses",
      // The announcements page loads its list from here. What's under each topic stays blocked.
      "/api/v1/courses/101/discussion_topics",
      "/courses/101/assignments/syllabus",
    ]) {
      expect(guards.isBlockedPage(`${HOME}${path}`), path).toBe(false);
    }
  });

  it.each(ALL_BLOCKED)("isn't open to an approved step either: %s %s", (_kind, path) => {
    const step = guards.forApprovedStep();
    const url = `${HOME}${path}`;
    step.arm({ method: "POST", url, fields: [["answer", "b"]] });

    const decision = step.check({ url, method: "POST", opensPage: false, body: "answer=b", contentType: "application/x-www-form-urlencoded" });

    expect(decision.allowed).toBe(false);
    expect(step.progress()).toBe("armed");
  });
});

describe("the allowlist", () => {
  it.each(["/", "/courses", "/courses/101/assignments", "/courses/101/grades", "/courses/101/announcements"])(
    "opens %s",
    (path) => {
      expect(reading.check(opening(path)).allowed).toBe(true);
    },
  );

  it.each([
    "/profile",
    "/calendar",
    "/conversations",
    "/courses/101",
    "/courses/101/",
    "/courses/101/modules",
    "/courses/101/pages/week-one",
    "/courses/101/files",
    "/courses/101/grades/56",
    "/courses/101/announcements/9",
    "/courses/101/assignments/syllabus",
    "/courses/abc/grades",
    "/courses/101%2Fgrades",
    "/api/v1/courses",
    "/api/v1/courses/101/discussion_topics",
  ])("refuses to open anything else: %s", (path) => {
    expect(reading.check(opening(path))).toMatchObject({ allowed: false });
  });

  it("refuses every other Instructure host as a page, such as where new quizzes run", () => {
    expect(reading.check(opening("/", "https://temple.quiz-lti-iad-prod.instructure.com")).allowed).toBe(false);
    expect(reading.check(opening("/", "https://community.instructure.com")).allowed).toBe(false);
  });

  it("lets a read reach the login pages, so that it can see a login has expired", () => {
    expect(reading.check(opening("/login/saml")).allowed).toBe(true);
    expect(reading.check(opening("/idp/profile/SAML2/Redirect/SSO", "https://fim.temple.edu")).allowed).toBe(true);
  });

  it("leaves what a page loads to the blocklist and the guard's own rules", () => {
    expect(reading.check(loading("/api/v1/courses/101/assignment_groups")).allowed).toBe(true);
    expect(reading.check(loading("/api/v1/courses/101/quizzes")).allowed).toBe(false);
  });

  it("can't let through what the guard refuses", () => {
    const noPermission = keepToReadablePages(
      createGuardPolicy({ sites, publicHosts: [], hasReadPermission: () => false }).forReading(),
      sites,
    );

    expect(noPermission.check(opening("/courses")).allowed).toBe(false);
  });

  it("leaves a site without a list alone", () => {
    const other = { other: { name: "Other", homeUrl: "https://other.test/", loginHosts: ["other.test"] } };
    const guard = keepToReadablePages(
      createGuardPolicy({ sites: other, publicHosts: [], hasReadPermission: () => true }).forReading(),
      other,
    );

    expect(guard.check(opening("/anything", "https://other.test")).allowed).toBe(true);
  });
});
