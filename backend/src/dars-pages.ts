import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { AUDIT_LIST_SHAPE, AUDIT_SHAPE, type RequirementStatus } from "./dars-rules.ts";
import { attribute, elementsIn, elementsNamed, wordsIn, type PageToRead } from "./tuportal-pages.ts";

/**
 * Reads DARS's pages. There's no model here and no fetching. Nobody has checked these against the real site
 * yet: see dars-rules.ts, which holds all that's assumed about them, and `npm run check-dars`.
 *
 * Each function returns null when it can't understand the page, and nothing is ever guessed at. A wrong
 * "requirement complete" could mislead a Student about graduating, so one thing not understood anywhere on a
 * page means the whole page wasn't understood. Only what the reader is after is taken: never a name, an ID, a
 * GPA or a grade.
 */

/** One of the Student's own audits on the list. What-If audits aren't. */
export interface AuditOnList {
  program: string;
  /** As the page shows it. */
  created: string;
  /** YYYY-MM-DD, to compare with today. */
  day: string;
  /** YYYY-MM-DDTHH:MM, to tell which is newest. */
  minute: string;
  /** Where its View Audit link goes, as the page wrote it. */
  address: string;
}

export interface RequirementOnAudit {
  title: string;
  status: RequirementStatus;
  /** The titles of the parts of it that aren't met yet. */
  missingParts: string[];
  /** Course numbers named in a missing requirement. Never a grade. */
  courses: string[];
}

export interface Audit {
  requirements: RequirementOnAudit[];
}

const clean = (words: string) => words.replace(/\s+/g, " ").trim();
const linesOf = (text: string) => text.split(/\r?\n/).map(clean).filter(Boolean);

function createdParts(words: string): Pick<AuditOnList, "day" | "minute"> | null {
  const match = AUDIT_LIST_SHAPE.created.exec(words);
  if (!match) return null;
  const [, month, date, year, hour, minute, half] = match;
  const hours = (Number(hour) % 12) + (half!.toUpperCase() === "PM" ? 12 : 0);
  const day = `${year}-${month}-${date}`;
  return { day, minute: `${day}T${String(hours).padStart(2, "0")}:${minute}` };
}

/** The table with all the columns the reader needs, and which column each is. */
function findList(html: string) {
  for (const table of elementsNamed(parse(html), "table")) {
    const rows = elementsNamed(table, "tr");
    if (rows.length === 0) continue;
    const headings = elementsNamed(rows[0]!, "th", "td").map(wordsIn);
    const columnOf = (pattern: RegExp) => headings.findIndex((heading) => pattern.test(heading));
    const { program, catalogYear, created, type, view } = AUDIT_LIST_SHAPE.columns;
    const columns = { program: columnOf(program), catalogYear: columnOf(catalogYear), created: columnOf(created), type: columnOf(type), view: columnOf(view) };
    if (Object.values(columns).every((column) => column >= 0)) return { rows: rows.slice(1), width: headings.length, columns };
  }
  return null;
}

/** The Student's own audits, with none said only in the page's own words. Null if any row can't be read, because the one that can't could be the newest. */
export function readAuditList({ html, text }: PageToRead): AuditOnList[] | null {
  const shown = clean(text);
  const saysNone = linesOf(text).some((line) => AUDIT_LIST_SHAPE.saysNone.test(line));
  const list = findList(html);
  if (!list) return saysNone ? [] : null;

  const audits: AuditOnList[] = [];
  let anyRows = false;
  for (const row of list.rows) {
    const cells = elementsNamed(row, "td", "th");
    if (cells.every((cell) => wordsIn(cell) === "" && elementsNamed(cell, "a").length === 0)) continue;
    if (cells.length !== list.width) return null;
    anyRows = true;

    const type = wordsIn(cells[list.columns.type]!);
    const catalogYear = wordsIn(cells[list.columns.catalogYear]!);
    if (AUDIT_LIST_SHAPE.whatIfType.test(type) || AUDIT_LIST_SHAPE.whatIfCatalogYear.test(catalogYear)) continue;
    if (!AUDIT_LIST_SHAPE.regularType.test(type)) return null;

    const created = clean(wordsIn(cells[list.columns.created]!));
    const parts = createdParts(created);
    const program = clean(wordsIn(cells[list.columns.program]!));
    const address = elementsNamed(cells[list.columns.view]!, "a").flatMap((link) => attribute(link, "href") ?? [])[0];
    if (!parts || !program || !address || !shown.includes(created)) return null;
    audits.push({ program, created, ...parts, address });
  }
  return anyRows || saysNone ? audits : null;
}

const classesOf = (element: Html.Element) => attribute(element, "class")?.split(/\s+/).filter(Boolean) ?? [];
const hasClass = (element: Html.Element, name: string) => classesOf(element).includes(name);
const marksOn = (element: Html.Element) => classesOf(element).filter((name) => AUDIT_SHAPE.statusPrefix.test(name));
const hasAStatusMark = (element: Html.Element) => marksOn(element).length > 0;

/** Null unless exactly one state is marked, and it's one the reader knows. */
function statusOf(element: Html.Element): RequirementStatus | null {
  const marks = marksOn(element);
  if (marks.length !== 1) return null;
  return Object.hasOwn(AUDIT_SHAPE.statusClasses, marks[0]!) ? AUDIT_SHAPE.statusClasses[marks[0]!]! : null;
}

/** A part's state, from the one element in it that holds a mark. With no mark it has none of its own. Null if it can't be told. */
function statusOfPart(part: Html.Element): RequirementStatus | null {
  const holders = [...elementsIn(part)].filter((inside) => hasClass(inside, AUDIT_SHAPE.partMarkClass));
  if (holders.length > 1) return null;
  return holders[0] && hasAStatusMark(holders[0]) ? statusOf(holders[0]) : "none";
}

/** Whether every mark drawn in this requirement is its own, which is the page saying the same thing twice. */
function drawnMarksAgree(block: Html.Element): boolean {
  const own = marksOn(block)[0]!.replace(AUDIT_SHAPE.statusPrefix, "");
  const drawn = [...elementsIn(block)].flatMap(classesOf).filter((name) => AUDIT_SHAPE.drawnStatusPrefix.test(name));
  return drawn.every((name) => name === `status${own}`);
}

/** Up to its first line break, because what follows is words about it. */
function firstLineOf(element: Html.Element): string {
  const line: string[] = [];
  for (const child of element.childNodes) {
    if (child.nodeName === "br" && clean(line.join(" "))) break;
    line.push(wordsIn(child));
  }
  return clean(line.join(" "));
}

function titleIn(element: Html.Element, titleClass: string): string | null {
  const title = [...elementsIn(element)].find((inside) => hasClass(inside, titleClass));
  return title ? firstLineOf(title).replace(AUDIT_SHAPE.titleLeader, "") || null : null;
}

/** The courses it says are needed, from what the page holds about each: what it shows can leave the department out. */
function neededCoursesIn(block: Html.Element): string[] {
  const inside = [...elementsIn(block)];
  const taken = new Set(inside.filter((element) => hasClass(element, AUDIT_SHAPE.takenCoursesClass)).flatMap((table) => [...elementsIn(table)]));
  const courses = inside
    .filter((element) => hasClass(element, AUDIT_SHAPE.courseClass) && !taken.has(element))
    .map((element) => clean(`${attribute(element, "department") ?? ""} ${attribute(element, "number") ?? ""}`))
    .filter((course) => AUDIT_SHAPE.course.test(course));
  return [...new Set(courses)];
}

/** Null if it can't be understood. A note with no title and no state isn't a requirement, so it's skipped. */
function readRequirement(block: Html.Element, shown: string): RequirementOnAudit | "note" | null {
  const status = statusOf(block);
  const title = titleIn(block, AUDIT_SHAPE.requirementTitleClass);
  if (status === "none" && !title) return "note";
  if (!status || !title || !shown.includes(title) || !drawnMarksAgree(block)) return null;

  const missingParts: string[] = [];
  for (const part of [...elementsIn(block)].filter((inside) => hasClass(inside, AUDIT_SHAPE.partClass))) {
    const partStatus = statusOfPart(part);
    if (!partStatus) return null;
    if (status === "complete" && !AUDIT_SHAPE.completeCanHaveUnmetParts && partStatus !== "complete" && partStatus !== "none") return null;
    // A part can have no title of its own. Its state is what matters, and the requirement's says that.
    const partTitle = titleIn(part, AUDIT_SHAPE.partTitleClass);
    if (partStatus === "missing" && partTitle) missingParts.push(partTitle);
  }
  return { title, status, missingParts, courses: status === "missing" ? neededCoursesIn(block) : [] };
}

export function readAuditPage({ html, text }: PageToRead): Audit | null {
  const shown = clean(text);
  if (AUDIT_SHAPE.whatIfCatalog.test(shown)) return null;

  const everything = [...elementsIn(parse(html))];
  const blocks = everything.filter((element) => hasClass(element, AUDIT_SHAPE.requirementClass));
  const insideABlock = new Set(blocks.flatMap((block) => [...elementsIn(block)]));
  const insideAPart = new Set(everything.filter((element) => hasClass(element, AUDIT_SHAPE.partClass)).flatMap((part) => [...elementsIn(part)]));
  const isKnownPlaceForAMark = (element: Html.Element) =>
    hasClass(element, AUDIT_SHAPE.requirementClass) || (hasClass(element, AUDIT_SHAPE.partMarkClass) && insideAPart.has(element) && insideABlock.has(element));
  // A state marked anywhere else could be a requirement drawn some way the reader doesn't know, and leaving it out could leave out what's missing.
  if (everything.some((element) => hasAStatusMark(element) && !isKnownPlaceForAMark(element))) return null;
  if (everything.some((element) => hasClass(element, AUDIT_SHAPE.partClass) && !insideABlock.has(element))) return null;

  const requirements: RequirementOnAudit[] = [];
  for (const block of blocks) {
    const requirement = readRequirement(block, shown);
    if (!requirement) return null;
    if (requirement !== "note") requirements.push(requirement);
  }
  if (requirements.length === 0) return null;

  // Nothing on the page says how many there should be, so this is what shows none is left out, such as on a page only partly drawn.
  const isWhole = linesOf(text).some((line) => AUDIT_SHAPE.saysDetailsFollow.test(line)) && hasClass(blocks.at(-1)!, AUDIT_SHAPE.lastBlockClass);
  return isWhole ? { requirements } : null;
}
