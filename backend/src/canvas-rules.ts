import type { PagePattern } from "./browser-access.ts";

/** The Connection's id. It's also the site's id, because the guard checks the Read Permission by it. */
export const CANVAS_ID = "canvas";
export const CANVAS_HOST = "templeu.instructure.com";
export const CANVAS_HOME = `https://${CANVAS_HOST}/`;
const SIGN_ON_HOST = "fim.temple.edu";

/**
 * The only pages Buddy opens on Canvas. Each address is tested as it is, so a page that isn't exactly
 * one of these isn't one of these.
 */
export function canvasReadablePages(host: string): PagePattern[] {
  return [
    // Where a login check lands. The reader itself doesn't open it.
    { host, path: /^\/$/ },
    { host, path: /^\/courses$/ },
    { host, path: /^\/courses\/\d+\/(?:assignments|grades|announcements)$/ },
    // Only so that a read can see a login has expired. Nothing is taken from these pages.
    { host, path: /^\/login(?:\/|$)/ },
    { host: SIGN_ON_HOST, path: /^\// },
  ];
}

export const CANVAS_READABLE_PAGES = canvasReadablePages(CANVAS_HOST);

const ANY = "[^/]+";
/** Canvas ignores a doubled slash and answers the same page as .json, so none of them get past this. */
const END = "(?:[/.;]|$)";

/**
 * Written as Canvas's own routes, for both a page and its API. Each is tested decoded and in lower
 * case: see `blockedPages` in browser-access.ts.
 */
function routes(prefix: string, ...paths: string[]): PagePattern[] {
  return paths.map((path) => ({
    path: new RegExp(`^/+${prefix}${path.replaceAll("/", "/+").replaceAll(":id", ANY)}${END}`),
  }));
}

const pagesAndApi = (...paths: string[]) => routes("(?:api/+v1/+)?", ...paths);
const pagesOnly = (...paths: string[]) => routes("", ...paths);

/**
 * Pages Buddy never opens, reads or submits, even with an approved card. The guard refuses these
 * first, for pages, frames, redirects and everything a page loads.
 */
export const CANVAS_BLOCKED_PAGES: PagePattern[] = [
  // Rosters and people.
  ...pagesAndApi(
    "courses/:id/users",
    "courses/:id/people",
    "courses/:id/enrollments",
    "courses/:id/search_users",
    "courses/:id/recent_students",
    "courses/:id/sections",
    "sections/:id",
    "search/recipients",
    "conversations/find_recipients",
    "about/:id",
  ),
  // Someone's page by their number. The Student's own records are under /users/self instead.
  { path: new RegExp(`^/+(?:api/+v1/+)?users/+\\d+${END}`) },
  // A course's students. For a Student, /students/submissions under it is only their own submissions,
  // and it's where the assignments list gets their scores from, so it stays.
  { path: new RegExp(`^/+(?:api/+v1/+)?courses/+${ANY}/+students(?!/+submissions${END})${END}`) },

  // Discussion boards. An announcement is a kind of topic, and the announcements page loads its list
  // from /api/v1/courses/:id/discussion_topics with only_announcements=true. The guard can't see that
  // part of an address, so that one exact list stays open, while it's never opened as a page and
  // nothing under any topic can be loaded. It's narrower than ADR 0002's "skips discussion boards"
  // only in that a page could fetch that list, of titles. Buddy reads only what the page shows.
  ...pagesOnly("courses/:id/discussion_topics", "groups/:id/discussion_topics", "discussion_topics"),
  { path: new RegExp(`^/+api/+v1/+(?:courses|groups)/+${ANY}/+discussion_topics/+.`) },
  ...pagesAndApi("courses/:id/discussion_entries", "discussion_entries"),

  // Groups and classmates' work.
  ...pagesAndApi(
    "groups",
    "courses/:id/groups",
    "users/self/groups",
    "group_categories",
    "courses/:id/group_categories",
    "collaborations",
    "courses/:id/collaborations",
    "courses/:id/gradebook",
    "courses/:id/gradebook2",
    "courses/:id/speed_grader",
  ),

  // Quizzes and exams, wherever they turn up in an address. An outside tool is blocked too, because
  // Buddy can't tell which of them are exams, such as a lockdown browser or a proctoring service.
  { path: new RegExp(`/(?:quiz|quizzes|quiz_submissions|quiz_sessions|exam|exams)${END}`) },
  ...pagesAndApi("courses/:id/external_tools"),

  // Assignment submission. An assignment's own page is where the Student submits, and it's also where
  // a new quiz runs, so everything under an assignment is blocked. The list of them is what's read.
  { path: new RegExp(`^/+(?:api/+v1/+)?courses/+${ANY}/+assignments/+(?!syllabus${END})`) },
  ...pagesOnly("courses/:id/submissions", "submissions"),
];

/** Canvas sends the browser to one of these when it isn't logged in: its own login pages or the sign-on's. */
export function isCanvasLoginPage(address: string, home: string): boolean {
  const url = URL.parse(address);
  return !url || url.hostname !== new URL(home).hostname || /^\/login(?:\/|$)/.test(url.pathname);
}
