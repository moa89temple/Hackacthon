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

export interface AuditList {
  audits: AuditOnList[];
  /** How many What-If audits were left out. */
  whatIfs: number;
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

/** Null if any row can't be read, because the one that can't could be the newest. */
export function readAuditList({ html, text }: PageToRead): AuditList | null {
  const shown = clean(text);
  const list = findList(html);
  if (!list) return linesOf(text).some((line) => AUDIT_LIST_SHAPE.saysNone.test(line)) ? { audits: [], whatIfs: 0 } : null;

  const audits: AuditOnList[] = [];
  let whatIfs = 0;
  for (const row of list.rows) {
    const cells = elementsNamed(row, "td", "th");
    if (cells.every((cell) => wordsIn(cell) === "" && elementsNamed(cell, "a").length === 0)) continue;
    if (cells.length !== list.width) return null;

    const type = wordsIn(cells[list.columns.type]!);
    const catalogYear = wordsIn(cells[list.columns.catalogYear]!);
    if (AUDIT_LIST_SHAPE.whatIfType.test(type) || AUDIT_LIST_SHAPE.whatIfCatalogYear.test(catalogYear)) {
      whatIfs += 1;
      continue;
    }
    if (!AUDIT_LIST_SHAPE.regularType.test(type)) return null;

    const created = clean(wordsIn(cells[list.columns.created]!));
    const parts = createdParts(created);
    const program = clean(wordsIn(cells[list.columns.program]!));
    const address = elementsNamed(cells[list.columns.view]!, "a").flatMap((link) => attribute(link, "href") ?? [])[0];
    if (!parts || !program || !address || !shown.includes(created)) return null;
    audits.push({ program, created, ...parts, address });
  }
  return audits.length + whatIfs === 0 && !linesOf(text).some((line) => AUDIT_LIST_SHAPE.saysNone.test(line)) ? null : { audits, whatIfs };
}

const classesOf = (element: Html.Element) => attribute(element, "class")?.split(/\s+/).filter(Boolean) ?? [];
const hasClass = (element: Html.Element, name: string) => classesOf(element).includes(name);

/** Null unless exactly one state is marked, and it's one the reader knows. */
function statusOf(element: Html.Element): RequirementStatus | null {
  const marks = classesOf(element).filter((name) => AUDIT_SHAPE.statusPrefix.test(name));
  if (marks.length !== 1) return null;
  return Object.hasOwn(AUDIT_SHAPE.statusClasses, marks[0]!) ? AUDIT_SHAPE.statusClasses[marks[0]!]! : null;
}

function titleIn(element: Html.Element, titleClass: string): string | null {
  const title = elementsIn(element).find((inside) => hasClass(inside, titleClass));
  return title ? clean(wordsIn(title)).replace(AUDIT_SHAPE.titleLeader, "") || null : null;
}

function readRequirement(block: Html.Element, shown: string): RequirementOnAudit | null {
  const status = statusOf(block);
  const title = titleIn(block, AUDIT_SHAPE.requirementTitleClass);
  if (!status || !title || !shown.includes(title)) return null;

  const missingParts: string[] = [];
  for (const part of elementsIn(block).filter((inside) => hasClass(inside, AUDIT_SHAPE.partClass))) {
    const partStatus = statusOf(part);
    if (!partStatus) return null;
    // A part can have no title of its own. Its state is what matters, and the requirement's says that.
    const partTitle = titleIn(part, AUDIT_SHAPE.partTitleClass);
    if (partStatus === "missing" && partTitle) missingParts.push(partTitle);
  }
  const courses = status === "missing" ? [...new Set(wordsIn(block).match(AUDIT_SHAPE.course) ?? [])] : [];
  return { title, status, missingParts, courses };
}

export function readAuditPage({ html, text }: PageToRead): Audit | null {
  const shown = clean(text);
  if (AUDIT_SHAPE.whatIfCatalog.test(shown)) return null;

  const requirements: RequirementOnAudit[] = [];
  for (const block of elementsIn(parse(html)).filter((element) => hasClass(element, AUDIT_SHAPE.requirementClass))) {
    const requirement = readRequirement(block, shown);
    if (!requirement) return null;
    requirements.push(requirement);
  }
  if (requirements.length === 0) return null;

  const lines = linesOf(text);
  const anyMissing = requirements.some(({ status }) => status === "missing");
  const anyNotComplete = requirements.some(({ status }) => status === "missing" || status === "in_progress" || status === "planned");
  if (!anyNotComplete && lines.some((line) => AUDIT_SHAPE.saysUnmet.test(line))) return null;
  if (anyMissing && lines.some((line) => AUDIT_SHAPE.saysAllMet.test(line))) return null;
  return { requirements };
}
