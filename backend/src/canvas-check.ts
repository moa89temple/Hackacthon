import { DatabaseSync } from "node:sqlite";
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { createBrowserAccess, TakeoverInProgress, type Site } from "./browser-access.ts";
import type { BuddysBrowser } from "./buddys-browser.ts";
import { readAnnouncementsPage, readAssignmentsPage, readCoursesPage, readGradesPage } from "./canvas-pages.ts";
import { systemClock } from "./clock.ts";
import { createConnections, type ConnectionType } from "./connections.ts";
import { createGuardPolicy, isOnSite, type RequestGuard } from "./network-guard.ts";
import { createProfile } from "./profile.ts";
import { openStore, THE_STUDENT } from "./store.ts";

/**
 * Checks the Canvas reader against a real login, for someone who must not see the Student's records.
 * It runs the real reader through the real gate and prints only counts, cleaned addresses and page
 * structure. Everything it prints goes through the few functions below, each of which builds its
 * line from fixed words and cleaned names rather than cleaning up what a page said, and nothing from a
 * page is written anywhere: the database is in memory, and it goes when this ends.
 */

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_NO_READ_PERMISSION = 2;
export const EXIT_TAKEOVER_UNDER_WAY = 3;
export const EXIT_LOGIN_NEEDED = 4;

const MOST_STRUCTURE_LINES = 400;
const LONGEST_NAME = 60;
/** Shorter names, such as "grade" or "title", are on most pages in ordinary words and say nothing. */
const SHORTEST_NAME_TO_COMPARE = 8;
/** A whole part of a host name, such as "cloudfront". Shorter ones, such as "events" or "cdn", are ordinary words. */
const SHORTEST_HOST_PART_TO_COMPARE = 8;

/** The words in Canvas's addresses. Anything else in an address could be someone's words, such as a page's name. */
const ADDRESS_WORDS = new Set(
  `about accounts announcements anonymous_submissions api assignment_groups assignments avatars calendar canvas collaborations
  colors conferences context conversations courses custom_data dashboard dist discussion_entries discussion_topics enrollments
  entries external_tools favorites feature_flags files find_recipients gradebook grades graphql group_categories groups idp images
  inbox lti login modules outcomes page_views pages peer_reviews people planner planner_notes profile profile_pictures quiz quiz_sessions
  quiz_submissions quizzes recent_students recipients saml search search_users sections self settings students submissions submit
  syllabus take tabs unread_count users v1 view`
    .split(/\s+/)
    .filter(Boolean),
);
const SAFE_EXTENSIONS = /\.(js|css|map|png|svg|gif|jpg|woff2?|ttf|json)$/;

const ARIA_ROLES = new Set(
  `alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog
  directory document feed figure form grid gridcell group heading img link list listbox listitem log main marquee math menu menubar
  menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup
  rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar
  tooltip tree treegrid treeitem`
    .split(/\s+/)
    .filter(Boolean),
);
/** Ids are values and aren't shown, except these, which are the reader's own landmarks and fixed words here. */
const LANDMARK_IDS = new Set(["my_courses_table", "past_enrollments_table", "grades_summary", "grade-summary-react", "ag-list", "assignments", "content"]);
const NOT_STRUCTURE = new Set(["script", "style", "template", "noscript", "head"]);
/** What these hold is someone's own writing, or another document, so nothing inside them is looked at. */
const NOT_LOOKED_INSIDE_CLASSES = new Set(["user_content", "show-content", "mce-content-body"]);
const NOT_LOOKED_INSIDE_TAGS = new Set(["svg", "iframe", "object", "embed", "video", "audio", "select", "textarea"]);

/** Takes a raw address to its path, with anything that could be someone's words or an id replaced. */
export function cleanPath(address: string): string {
  const url = URL.parse(address);
  if (!url) return ":text";
  const segments = url.pathname.split("/").filter(Boolean).map(cleanSegment);
  return `/${segments.join("/")}`;
}

function cleanSegment(segment: string): string {
  const lower = segment.toLowerCase();
  if (ADDRESS_WORDS.has(lower)) return lower;
  if (/^\d[\d~]*$/.test(segment)) return ":id";
  const extension = SAFE_EXTENSIONS.exec(lower)?.[0] ?? "";
  return `${/\d/.test(segment) ? ":id" : ":text"}${extension}`;
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Everything on a page that's words rather than structure: its text, and every attribute but class and tag names. */
function wordsOfPage(page: Html.Document | Html.DocumentFragment): string {
  const words: string[] = [];
  const visit = (node: Html.ChildNode | Html.Document | Html.DocumentFragment): void => {
    if (node.nodeName === "#text") words.push((node as Html.TextNode).value);
    if ("attrs" in node) {
      for (const { name, value } of node.attrs) {
        if (name !== "class" && name !== "style") words.push(value);
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(page);
  return normalized(words.join(" "));
}

/** What a person reading the page sees. An address on the page doesn't count: a script's own host is always there. */
function shownWords(page: Html.Document): string {
  const words: string[] = [];
  const visit = (node: Html.ChildNode | Html.Document): void => {
    if (node.nodeName === "#text") words.push((node as Html.TextNode).value);
    if ("attrs" in node) {
      for (const { name, value } of node.attrs) {
        if (name === "title" || name === "aria-label" || name === "alt") words.push(value);
      }
    }
    if ("childNodes" in node && !("tagName" in node && NOT_STRUCTURE.has(node.tagName) && node.tagName !== "head")) {
      node.childNodes.forEach(visit);
    }
  };
  visit(page);
  return normalized(words.join(" "));
}

function cleanName(raw: string, pageWords: string): string | null {
  if (raw.length > LONGEST_NAME || !/^[A-Za-z_][\w-]*$/.test(raw)) return null;
  const name = normalized(raw);
  if (name.length >= SHORTEST_NAME_TO_COMPARE && pageWords.includes(name)) return null;
  return raw.replace(/\d+/g, ":id");
}

function describeElement(element: Html.Element, pageWords: string): string {
  const attribute = (name: string) => element.attrs.find((attr) => attr.name === name)?.value;
  const tag = /^[a-z][a-z0-9-]*$/.test(element.tagName) ? element.tagName : "element";
  const id = attribute("id");
  const classes = [...new Set((attribute("class") ?? "").split(/\s+/).filter(Boolean))]
    .map((name) => cleanName(name, pageWords))
    .filter((name): name is string => name !== null);
  const role = attribute("role");
  const dataNames = element.attrs
    .filter((attr) => attr.name.startsWith("data-"))
    .map((attr) => cleanName(attr.name, pageWords))
    .filter((name): name is string => name !== null);

  return [
    `${tag}${id && LANDMARK_IDS.has(id) ? `#${id}` : ""}${classes.map((name) => `.${name}`).join("")}`,
    role === undefined ? "" : `role=${ARIA_ROLES.has(role) ? role : ":other"}`,
    dataNames.length > 0 ? `[${[...new Set(dataNames)].join(" ")}]` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Identical neighbours become one line, so that a long table's rows read as one row. */
function structureLines(element: Html.Element, pageWords: string, depth: number): string[] {
  const line = describeElement(element, pageWords);
  const indent = "  ".repeat(depth);
  const classes = (element.attrs.find((attr) => attr.name === "class")?.value ?? "").split(/\s+/);
  if (classes.some((name) => NOT_LOOKED_INSIDE_CLASSES.has(name)) || NOT_LOOKED_INSIDE_TAGS.has(element.tagName)) {
    return [`${indent}${line} (not looked inside)`];
  }

  const children = element.childNodes
    .filter((child): child is Html.Element => "tagName" in child && !NOT_STRUCTURE.has(child.tagName))
    .map((child) => structureLines(child, pageWords, depth + 1));
  const lines = [`${indent}${line}`];
  let index = 0;
  while (index < children.length) {
    const child = children[index]!;
    let repeats = 1;
    while (children[index + repeats]?.join("\n") === child.join("\n")) repeats++;
    lines.push(repeats > 1 ? `${child[0]} ×${repeats}` : child[0]!, ...child.slice(1));
    index += repeats;
  }
  return lines;
}

/** A page's tags, roles, classes and data- attribute names, with nothing that a page's words could be in. */
export function structureOf(html: string): string[] {
  const page = parse(html);
  const pageWords = wordsOfPage(page);
  const find = (node: Html.Document | Html.ChildNode): Html.Element | null => {
    if (!("childNodes" in node)) return null;
    for (const child of node.childNodes) {
      if ("tagName" in child && child.tagName === "body") return child;
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const body = find(page);
  if (!body) return ["(no body)"];
  const lines = structureLines(body, pageWords, 0);
  return lines.length > MOST_STRUCTURE_LINES
    ? [...lines.slice(0, MOST_STRUCTURE_LINES), `(and ${lines.length - MOST_STRUCTURE_LINES} more lines)`]
    : lines;
}

interface PageVisit {
  /** Cleaned. */
  asked: string;
  /** Cleaned, and null if it didn't get there. */
  landed: string | null;
  landedHost: string | null;
  html: string | null;
  /** The kind of error, never its words, which often quote the address. */
  failed: string | null;
}

interface Refusal {
  method: string;
  host: string;
  path: string;
}

/**
 * What the check sees of the browser. It lets through reading and nothing else: the login in a real
 * container must survive this, so anything but a read fails here rather than reach it.
 */
function watchingBrowser(
  inner: BuddysBrowser,
  isStudentInControl: () => boolean,
  visits: PageVisit[],
  refusals: Refusal[],
): BuddysBrowser {
  const notInACheck = (): never => {
    throw new Error("The check only ever reads");
  };
  return {
    liveView: inner.liveView,
    show: async () => notInACheck(),
    submitForm: async () => notInACheck(),
    clearScreen: async () => notInACheck(),
    forgetLogin: async () => notInACheck(),

    async read(url, guard) {
      if (isStudentInControl()) throw new TakeoverInProgress();
      const watching: RequestGuard = {
        check(request) {
          const decision = guard.check(request);
          if (!decision.allowed) {
            refusals.push({
              method: /^[A-Z]{1,10}$/.test(request.method) ? request.method : "OTHER",
              host: URL.parse(request.url)?.hostname ?? ":text",
              path: cleanPath(request.url),
            });
          }
          return decision;
        },
      };
      try {
        const page = await inner.read(url, watching);
        visits.push({
          asked: cleanPath(url),
          landed: cleanPath(page.url),
          landedHost: URL.parse(page.url)?.hostname ?? null,
          html: page.html,
          failed: null,
        });
        return page;
      } catch (error) {
        visits.push({ asked: cleanPath(url), landed: null, landedHost: null, html: null, failed: kindOfError(error) });
        throw error;
      }
    },
  };
}

/** A class's name is from the code, where its message could say anything. */
function kindOfError(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : "";
  return /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
}

type PageKind = "course list" | "assignments" | "grades" | "announcements";

const PAGES: { path: RegExp; kind: PageKind; found: (html: string, now: Date) => number | null }[] = [
  { path: /^\/courses$/, kind: "course list", found: (html) => readCoursesPage(html)?.length ?? null },
  { path: /^\/courses\/:id\/assignments$/, kind: "assignments", found: (html) => readAssignmentsPage(html)?.length ?? null },
  {
    path: /^\/courses\/:id\/grades$/,
    kind: "grades",
    found: (html, now) => {
      const grades = readGradesPage(html, now);
      return grades ? grades.assignments.length + (grades.total ? 1 : 0) : null;
    },
  },
  { path: /^\/courses\/:id\/announcements$/, kind: "announcements", found: (html, now) => readAnnouncementsPage(html, now)?.length ?? null },
];

function countedLines<T>(items: T[], line: (item: T) => string): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const text = line(item);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([text, count]) => (count > 1 ? `  ${text}  ×${count}` : `  ${text}`));
}

export interface StudentState {
  hasReadPermission: boolean;
  takeoverUnderWay: boolean;
}

/**
 * The Read Permission only the Student's tap can give, from the real database. This opens it read-only,
 * so that it can't change it, and it's how a throwaway database comes to hold a Read Permission without
 * anyone deciding for the Student. If it can't be read, the answer is no.
 */
export function readStudentState(databasePath: string, connection: string): StudentState {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const permission = database
      .prepare("SELECT 1 FROM read_permissions WHERE student_id = ? AND connection = ?")
      .get(THE_STUDENT, connection);
    const takeover = database.prepare("SELECT 1 FROM takeovers WHERE student_id = ?").get(THE_STUDENT);
    return { hasReadPermission: permission !== undefined, takeoverUnderWay: takeover !== undefined };
  } catch {
    return { hasReadPermission: false, takeoverUnderWay: false };
  } finally {
    database?.close();
  }
}

export interface CanvasCheckDeps {
  browser: BuddysBrowser;
  connection: ConnectionType;
  sites: Record<string, Site>;
  /** Asked before anything opens, and before each page, because the Student can start a Takeover at any time. */
  student: () => StudentState;
  print: (line: string) => void;
}

/** Returns the exit code. It never prints what an error says or what a page said. */
export async function runCanvasCheck(deps: CanvasCheckDeps): Promise<number> {
  try {
    return await runChecked(deps);
  } catch (error) {
    deps.print(`The check stopped unexpectedly (${kindOfError(error)}). Nothing was saved.`);
    return EXIT_FAILED;
  }
}

async function runChecked({ browser, connection, sites, student, print }: CanvasCheckDeps): Promise<number> {
  const { hasReadPermission, takeoverUnderWay } = student();
  if (!hasReadPermission) {
    print(`${connection.name} has no Read Permission, so nothing was opened. On the phone: You tab, Connect ${connection.name}, Give Read Permission. Then run this again.`);
    return EXIT_NO_READ_PERMISSION;
  }
  if (takeoverUnderWay) {
    print("The Student is in control of Buddy's Browser in a Takeover, so nothing was opened. Tap Done on the phone, then run this again.");
    return EXIT_TAKEOVER_UNDER_WAY;
  }

  const visits: PageVisit[] = [];
  const refusals: Refusal[] = [];
  const watched = watchingBrowser(browser, () => student().takeoverUnderWay, visits, refusals);

  // In memory, so that there's no file for what's read to be left in. The Read Permission was the Student's tap, checked above.
  const store = openStore(":memory:");
  const clock = systemClock;
  let reading: ReturnType<typeof summarize>;
  try {
    const profile = createProfile({ store, clock, connectionName: () => connection.name });
    const guards = createGuardPolicy({
      sites,
      publicHosts: [],
      hasReadPermission: (site) => store.readPermission(THE_STUDENT, site) !== null,
    });
    const browserAccess = createBrowserAccess({
      browser: watched,
      clock,
      store,
      sites,
      guards,
      onControlEnded: () => {},
      logError: () => {},
    });
    const connections = createConnections({
      types: [connection],
      web: { get: () => Promise.reject(new Error("The check doesn't use the web")) },
      browserAccess,
      clock,
      store,
      profile,
      logError: () => {},
    });
    const status = await connections.give(connection.id, undefined);
    reading = summarize(profile.factsFromConnection(connection.id).map((fact) => fact.data), status);
  } finally {
    store.close();
  }

  print(`${connection.name} check. This shows counts and page structure only, and nothing was saved.`);
  print("Read Permission: given by the Student");
  print(`Login: ${reading.needsLogin ? "not logged in. The Student needs to log in through a Takeover: You tab, Log in to Canvas." : "works"}`);
  if (reading.problem) print(`Problem: ${reading.problem}`);
  print("");
  print("Found:");
  for (const [kind, count] of reading.counts) print(`  ${kind}: ${count}`);
  print("");
  print("Pages opened:");
  for (const line of countedLines(visits, describeVisit)) print(line);
  print("");
  print("Refused by the guard:");
  const pageWords = visits.map((visit) => (visit.html ? shownWords(parse(visit.html)) : "")).join(" ");
  const refusalLines = countedLines(refusals, (refusal) => `${refusal.method} ${cleanHost(refusal.host, sites, pageWords)} ${refusal.path}`);
  if (refusalLines.length === 0) print("  nothing");
  for (const line of refusalLines) print(line);

  const now = clock.now();
  const summaries = reading.needsLogin ? [] : pagesWithNothing(visits, now);
  if (summaries.length > 0) {
    print("");
    print("Structure of the pages where the reader found nothing (the first of each kind):");
    for (const { path, understood, html } of summaries) {
      print("");
      print(`${path}  (${understood ? "the reader knows this page, and it had nothing on it" : "the reader couldn't recognize this page"})`);
      for (const line of structureOf(html)) print(line);
    }
  }
  return reading.needsLogin ? EXIT_LOGIN_NEEDED : EXIT_OK;
}

function summarize(data: unknown[], status: { needsLogin: boolean; lastReadProblem: string | null }) {
  const kinds = data.map((item) => (item ?? {}) as { kind?: string; dueAt?: string | null });
  const count = (...names: string[]) => kinds.filter(({ kind }) => names.includes(kind ?? "")).length;
  return {
    needsLogin: status.needsLogin,
    // Words from Buddy's own code, never from a page. See canvas.ts.
    problem: status.lastReadProblem,
    counts: [
      ["courses", count("course")],
      ["assignments", count("assignment")],
      ["due dates", kinds.filter(({ kind, dueAt }) => kind === "assignment" && dueAt).length],
      ["grades", count("grade", "course_grade")],
      ["announcements", count("announcement")],
    ] as const,
  };
}

function describeVisit(visit: PageVisit): string {
  if (visit.failed) return `${visit.asked}  (${visit.failed})`;
  if (visit.landed === visit.asked) return visit.asked;
  return `${visit.asked}  (ended up at ${visit.landedHost} ${visit.landed})`;
}

/** A host a page chose to load from could be named after something on the page. The site's own never is. */
function cleanHost(host: string, sites: Record<string, Site>, pageWords: string): string {
  if (Object.values(sites).some((site) => isOnSite(host, site))) return host;
  const parts = host.toLowerCase().split(".").map(normalized);
  const onThePage = parts.some((part) => part.length >= SHORTEST_HOST_PART_TO_COMPARE && pageWords.includes(part));
  return onThePage ? "(a host named after words on the page)" : host;
}

function pagesWithNothing(visits: PageVisit[], now: Date): { path: string; understood: boolean; html: string }[] {
  const seen = new Set<PageKind>();
  const summaries: { path: string; understood: boolean; html: string }[] = [];
  for (const visit of visits) {
    if (visit.html === null || visit.landed !== visit.asked) continue;
    const page = PAGES.find(({ path }) => path.test(visit.asked));
    if (!page || seen.has(page.kind)) continue;
    const found = page.found(visit.html, now);
    if (found !== null && found > 0) continue;
    seen.add(page.kind);
    summaries.push({ path: visit.asked, understood: found !== null, html: visit.html });
  }
  return summaries;
}
