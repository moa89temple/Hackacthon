import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { wallClockInPhiladelphia } from "./calendar-feed.ts";
import { PHILADELPHIA } from "./clock.ts";

/**
 * Reads Canvas's pages. There's no model here and no fetching: each function takes a page's HTML, as it
 * was after its scripts ran, and gives back what's on it. Each returns null when the page isn't what
 * it should be, because that's different from a page that really has nothing on it: nothing the
 * Student already has should be thrown away over a page Buddy couldn't understand.
 */

export interface CourseOnPage {
  id: string;
  name: string;
  term: string;
  /**
   * Only pages about the Student's own work get read, so a course they help teach isn't opened. Null
   * when the page doesn't say, which is not the same as saying they aren't.
   */
  isStudent: boolean | null;
}

export interface AssignmentOnList {
  id: string;
  name: string;
  /** Null when there's none, or several, such as different dates for different sections. */
  dueAt: string | null;
  points: string | null;
  score: string | null;
}

export interface AssignmentOnGrades extends AssignmentOnList {
  submitted: boolean;
  late: boolean;
  missing: boolean;
}

export interface GradesOnPage {
  assignments: AssignmentOnGrades[];
  /** The course's total, as the page writes it. */
  total: string | null;
}

export interface AnnouncementOnPage {
  id: string;
  title: string;
  postedAt: string | null;
  text: string;
}

type Node = Html.ChildNode | Html.Document;

/** Words that are in the page but aren't what it shows, such as the tooltip inside a grade. */
const NOT_WORDS_ON_THE_PAGE = new Set(["script", "style", "template", "noscript"]);
const NOT_WORDS_CLASSES = ["screenreader-only", "tooltip_wrap"];

function attribute(element: Html.Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function hasClass(element: Html.Element, name: string): boolean {
  return (attribute(element, "class") ?? "").split(/\s+/).includes(name);
}

const withClass = (name: string) => (element: Html.Element) => hasClass(element, name);
const withId = (id: string) => (element: Html.Element) => attribute(element, "id") === id;

function* elementsIn(node: Node): Generator<Html.Element> {
  if (!("childNodes" in node)) return;
  for (const child of node.childNodes) {
    if ("tagName" in child) yield child;
    yield* elementsIn(child);
  }
}

function findAll(node: Node, matches: (element: Html.Element) => boolean): Html.Element[] {
  return [...elementsIn(node)].filter(matches);
}

function find(node: Node, matches: (element: Html.Element) => boolean): Html.Element | undefined {
  for (const element of elementsIn(node)) {
    if (matches(element)) return element;
  }
  return undefined;
}

function collectWords(node: Node, words: string[]): void {
  if (node.nodeName === "#text") {
    words.push((node as Html.TextNode).value);
    return;
  }
  if (!("childNodes" in node)) return;
  if ("tagName" in node) {
    if (NOT_WORDS_ON_THE_PAGE.has(node.tagName)) return;
    if (NOT_WORDS_CLASSES.some((name) => hasClass(node, name))) return;
    if (/display\s*:\s*none/i.test(attribute(node, "style") ?? "")) return;
  }
  for (const child of node.childNodes) collectWords(child, words);
}

function wordsIn(node: Node | undefined): string {
  if (!node) return "";
  const words: string[] = [];
  collectWords(node, words);
  return words.join(" ").replace(/\s+/g, " ").trim();
}

/** Text that's kept out of sight on purpose, which is where Canvas stores a score as a plain number. */
function storedWords(element: Html.Element | undefined): string {
  return element ? element.childNodes.map((child) => ("value" in child ? child.value : "")).join("").trim() : "";
}

/** A number written the way a person would: "18.0" reads as 18. */
function plainNumber(text: string): string {
  return /^-?\d+\.0+$/.test(text) ? text.replace(/\.0+$/, "") : text;
}

function idFromLink(link: Html.Element | undefined, pattern: RegExp): string | null {
  const href = link && attribute(link, "href");
  return href ? (pattern.exec(href)?.[1] ?? null) : null;
}

/** The current enrollments only. Past courses and groups have tables of their own on this page. */
export function readCoursesPage(html: string): CourseOnPage[] | null {
  const page = parse(html);
  const table = find(page, withId("my_courses_table"));
  if (!table) {
    // Canvas leaves the table out when there are no current courses, and keeps the page's header.
    const isCourseList = find(page, withClass("header-bar")) && find(page, withClass("ic-Action-header"));
    return isCourseList ? [] : null;
  }

  const rows = findAll(table, withClass("course-list-table-row"));
  const courses: CourseOnPage[] = [];
  let namedRows = 0;
  for (const row of rows) {
    const title = find(row, withClass("course-list-course-title-column"));
    const id = title ? idFromLink(find(title, (element) => element.tagName === "a"), /\/courses\/(\d+)(?:[/?#]|$)/) : null;
    const name = title ? wordsIn(find(title, withClass("name"))) : "";
    if (name) namedRows++;
    // No link means Canvas won't let the Student into it yet, so there's nothing to read.
    if (!id || !name) continue;
    const role = wordsIn(find(row, withClass("course-list-enrolled-as-column")));
    courses.push({
      id,
      name,
      term: wordsIn(find(row, withClass("course-list-term-column"))),
      isStudent: role === "" ? null : /student/i.test(role),
    });
  }
  // Canvas leaves the table out when there are no courses, so a table with no rows it can read has changed.
  return namedRows === 0 ? null : courses;
}

export function readAssignmentsPage(html: string): AssignmentOnList[] | null {
  const page = parse(html);
  const rows = findAll(page, (element) => hasClass(element, "assignment") && /^assignment_\d+$/.test(attribute(element, "id") ?? ""));
  if (rows.length === 0) return find(page, withClass("ig-empty-msg")) ? [] : null;

  const assignments = rows.flatMap((row) => {
    const name = wordsIn(find(row, withClass("ig-title")));
    if (!name) return [];
    const due = find(row, withClass("assignment-date-due"));
    const time = due && find(due, (element) => element.tagName === "time");
    const moment = time ? Date.parse(attribute(time, "datetime") ?? "") : Number.NaN;
    const score = /^(-|[\d.]+)\s*\/\s*([\d.]+)/.exec(wordsIn(find(row, withClass("score-display"))));
    return [
      {
        id: attribute(row, "id")!.slice("assignment_".length),
        name,
        dueAt: Number.isNaN(moment) ? null : new Date(moment).toISOString(),
        points: score ? score[2]! : null,
        score: score && score[1] !== "-" ? score[1]! : null,
      },
    ];
  });
  return assignments.length > 0 ? assignments : null;
}

export function readGradesPage(html: string, now: Date): GradesOnPage | null {
  const table = find(parse(html), withId("grades_summary"));
  if (!table) return null;

  const assignments: AssignmentOnGrades[] = [];
  let total: string | null = null;
  const studentRows = findAll(table, withClass("student_assignment"));
  // A real grades table always has its total, so cells with no row of the Student's mean it has changed.
  if (studentRows.length === 0 && find(table, (element) => element.tagName === "td")) return null;
  // Only rows marked as the Student's. The class's mean, high and low are in rows of their own.
  for (const row of studentRows) {
    if (hasClass(row, "final_grade")) {
      total = wordsIn(find(row, withClass("grade"))) || null;
      continue;
    }
    if (hasClass(row, "hard_coded") || hasClass(row, "group_total")) continue;

    const id = /^submission_(\d+)$/.exec(attribute(row, "id") ?? "")?.[1];
    const title = find(row, withClass("title"));
    const link = title && find(title, (element) => element.tagName === "a");
    const name = link ? wordsIn(link) : wordsIn(title);
    if (!id || !name) continue;

    assignments.push({
      id,
      name,
      dueAt: readCanvasDate(wordsIn(find(row, withClass("due"))), now),
      points: /\/\s*([\d.]+)/.exec(wordsIn(find(row, withClass("assignment_score"))))?.[1] ?? null,
      score: attribute(row, "data-muted") === "true" ? null : scoreIn(row),
      submitted: wordsIn(find(row, withClass("submitted"))) !== "" || hasClass(row, "assignment_graded"),
      late: find(row, withClass("submission-late-pill")) !== undefined,
      missing: find(row, withClass("submission-missing-pill")) !== undefined,
    });
  }
  return { assignments, total };
}

function scoreIn(row: Html.Element): string | null {
  if (hasClass(row, "excused")) return "Excused";
  const shown = wordsIn(find(row, withClass("grade")));
  if (shown !== "" && shown !== "-") return plainNumber(shown);
  const stored = storedWords(find(row, withClass("original_score")));
  return stored ? plainNumber(stored) : null;
}

/** The author's own column isn't read, so an announcement never records who wrote it. */
export function readAnnouncementsPage(html: string, now: Date): AnnouncementOnPage[] | null {
  const page = parse(html);
  const rows = findAll(page, withClass("ic-announcement-row"));
  if (rows.length === 0) {
    const wrapper = find(page, withClass("announcements-v2__wrapper"));
    return wrapper && /no announcements/i.test(wordsIn(wrapper)) ? [] : null;
  }

  const announcements = rows.flatMap((row) => {
    const link = find(row, withClass("ic-item-row__content-link"));
    const id = idFromLink(link, /\/discussion_topics\/(\d+)(?:[/?#]|$)/);
    const title = wordsIn(link);
    if (!id || !title) return [];
    return [
      {
        id,
        title,
        postedAt: readCanvasDate(wordsIn(find(row, withClass("ic-item-row__meta-content-timestamp"))), now),
        text: wordsIn(find(row, withClass("ic-announcement-row__content"))),
      },
    ];
  });
  return announcements.length > 0 ? announcements : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SIX_MONTHS_MS = 183 * 24 * 3_600_000;
const CANVAS_DATE = /^([a-z]{3})[a-z]*\.? (\d{1,2})(?:, (\d{4}))?(?: (?:by|at) (\d{1,2})(?::(\d{2}))? ?([ap])\.?m?\.?)?$/i;

/**
 * Reads a date as Canvas writes one, such as "Nov 5 by 11:59pm". Canvas writes it on the Student's own
 * clock, which Buddy takes to be Philadelphia's, and a due date with no time means the end of that day.
 * With no year it means the one nearest to now. Null rather than a guess for anything else.
 */
export function readCanvasDate(text: string, now: Date): string | null {
  const match = CANVAS_DATE.exec(text.trim());
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]!.toLowerCase()) + 1;
  const day = Number(match[2]);
  if (month === 0) return null;

  let hour = 23;
  let minute = 59;
  if (match[4]) {
    hour = (Number(match[4]) % 12) + (match[6]!.toLowerCase() === "p" ? 12 : 0);
    minute = Number(match[5] ?? 0);
  }

  const moment = (year: number) => wallClockInPhiladelphia(year, month, day, hour) + minute * 60_000;
  const thisYear = new Date(now).getUTCFullYear();
  let at = moment(match[3] ? Number(match[3]) : thisYear);
  if (!match[3]) {
    if (at < now.getTime() - SIX_MONTHS_MS) at = moment(thisYear + 1);
    else if (at > now.getTime() + SIX_MONTHS_MS) at = moment(thisYear - 1);
  }

  const written = new Date(at);
  // February 31 comes out in March, and isn't a date.
  const sameDay = new Intl.DateTimeFormat("en-US", { timeZone: PHILADELPHIA, day: "numeric" }).format(written);
  return Number(sameDay) === day ? written.toISOString() : null;
}
