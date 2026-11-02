import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { stem, wordsIn } from "./guidebook.ts";

/**
 * Reads the Bulletin's own tables with code rather than with a model. Every program page has its plan in
 * the same kind of table, so what's on the card can't be a misreading, and it costs nothing to read.
 */

export const BULLETIN_PROGRAMS_PAGE = "https://bulletin.temple.edu/academic-programs/";

export type Season = "Fall" | "Spring" | "Summer";

/** One degree the Bulletin lists, such as Computer Science BS. */
export interface BulletinProgram {
  name: string;
  url: string;
}

export interface PlanTerm {
  year: number;
  season: Season;
  /** As the page gives them, such as "16" or "15-16". */
  credits: string | null;
  courses: string[];
}

export interface SuggestedPlan {
  heading: string;
  terms: PlanTerm[];
}

type Node = Html.ChildNode | Html.Document;

const isElement = (node: Node): node is Html.Element => "tagName" in node;

function attribute(element: Html.Element, name: string): string {
  return element.attrs.find((attr) => attr.name === name)?.value ?? "";
}

const hasClass = (element: Html.Element, name: string) => attribute(element, "class").split(/\s+/).includes(name);

function elementsIn(node: Node, matches: (element: Html.Element) => boolean): Html.Element[] {
  if (!("childNodes" in node)) return [];
  return node.childNodes.flatMap((child) => [...(isElement(child) && matches(child) ? [child] : []), ...elementsIn(child, matches)]);
}

const SKIPPED_IN_TEXT = new Set(["sup", "script", "style"]);

/** Footnote marks are left out, because "Elective 1" would read as a different course. A line break counts as a space. */
function textIn(node: Node): string {
  if (node.nodeName === "#text") return (node as Html.TextNode).value;
  if (!("childNodes" in node) || (isElement(node) && SKIPPED_IN_TEXT.has(node.tagName))) return "";
  const words = node.childNodes.map(textIn).join("");
  return isElement(node) && (node.tagName === "div" || node.tagName === "br") ? ` ${words} ` : words;
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

const NOT_DEGREES = /minor|cert|conc\.|japan/i;

/** The undergraduate degrees in the Bulletin's list of programs, each with its page. */
export function readBulletinPrograms(html: string, pageUrl = BULLETIN_PROGRAMS_PAGE): BulletinProgram[] {
  const rows = elementsIn(parse(html), (element) => element.tagName === "tr");
  return rows.flatMap((row) => {
    const name = elementsIn(row, (element) => hasClass(element, "column0"))[0];
    const undergraduate = elementsIn(row, (element) => hasClass(element, "column1"))[0];
    if (!name || !undergraduate) return [];
    return elementsIn(undergraduate, (element) => element.tagName === "a")
      .filter((link) => !NOT_DEGREES.test(textIn(link)))
      // Some say more after the degree, such as that it isn't taking new applications.
      .map((link) => ({ name: tidy(`${textIn(name)} ${textIn(link).replace(/\(.*\)/, "")}`), url: new URL(attribute(link, "href"), pageUrl).href }));
  });
}

/** They say nothing about which program it is. */
const NOT_THE_NAME = new Set(["and", "of", "in", "the", "a", "major", "majors", "majoring", "degree", "program", "concentration", "with"]);

const DEGREE_NAMES: [RegExp, string][] = [
  [/bachelor(?:'?s)? of science/gi, "bs"],
  [/bachelor(?:'?s)? of arts/gi, "ba"],
  [/bachelor(?:'?s)? of business administration/gi, "bba"],
  [/bachelor(?:'?s)? of fine arts/gi, "bfa"],
  [/bachelor(?:'?s)? of music/gi, "bm"],
];

const nameStems = (words: string[]) => new Set(words.filter((word) => !NOT_THE_NAME.has(word)).map(stem));

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((word) => b.has(word));
}

/**
 * The degrees this major could mean, and whether one of them is plainly it. First a degree's whole name, then
 * its name with or without its concentration, so that "Biology" finds both of Biology's degrees, then any with
 * all these words, so that "Engineering" finds each kind of engineering.
 */
export function programsMatching(programs: BulletinProgram[], major: string): { programs: BulletinProgram[]; sure: boolean } {
  const whole = programs.filter((program) => wordsIn(program.name).join(" ") === wordsIn(major).join(" "));
  if (whole.length === 1) return { programs: whole, sure: true };

  const spelledOut = DEGREE_NAMES.reduce((text, [words, short]) => text.replace(words, short), major);
  const parts = programs.map((program) => {
    const words = wordsIn(program.name);
    return {
      program,
      degree: words.at(-1)!,
      stems: nameStems(words.slice(0, -1)),
      withoutConcentration: nameStems(wordsIn(program.name.replace(/\(.*\)/, "")).slice(0, -1)),
    };
  });
  const degrees = new Set(parts.map((part) => part.degree));
  const asked = wordsIn(spelledOut);
  const degreeAsked = asked.find((word) => degrees.has(word));
  const askedStems = nameStems(asked.filter((word) => !degrees.has(word)));
  if (askedStems.size === 0) return { programs: [], sure: false };

  const ofDegree = parts.filter((part) => !degreeAsked || part.degree === degreeAsked);
  for (const named of [
    ofDegree.filter((part) => sameSet(part.stems, askedStems)),
    ofDegree.filter((part) => sameSet(part.withoutConcentration, askedStems)),
    ofDegree.filter((part) => [...askedStems].every((word) => part.stems.has(word))),
  ]) {
    if (named.length > 0) return { programs: named.map((part) => part.program), sure: named.length === 1 };
  }
  return { programs: [], sure: false };
}

function seasonOf(text: string): Season | null {
  return (/^(Fall|Spring|Summer)\b/i.exec(text)?.[1]?.replace(/^./, (first) => first.toUpperCase()) as Season | undefined) ?? null;
}

/** What one row of a plan says, such as "CIS 1166 or CIS 1966 Mathematical Concepts in Computing I". */
function courseOnRow(row: Html.Element): string | null {
  const code = elementsIn(row, (element) => hasClass(element, "codecol"))[0];
  const title = elementsIn(row, (element) => hasClass(element, "titlecol"))[0];
  // After the first line of a title come the same course's alternatives, such as its Honors version.
  const firstTitle = title?.childNodes.find((child) => tidy(textIn(child)) !== "");
  const words = tidy(`${code ? textIn(code) : ""} ${firstTitle ? textIn(firstTitle) : ""}`);
  return words === "" ? null : words;
}

function termsInGrid(grid: Html.Element): PlanTerm[] {
  const terms: PlanTerm[] = [];
  let year: number | null = null;
  for (const row of elementsIn(grid, (element) => element.tagName === "tr")) {
    const hours = tidy(elementsIn(row, (element) => hasClass(element, "hourscol")).map(textIn).join(" "));
    if (hasClass(row, "plangridyear")) {
      year = Number(/\d+/.exec(textIn(row))?.[0] ?? Number.NaN);
    } else if (hasClass(row, "plangridterm")) {
      const season = seasonOf(tidy(textIn(elementsIn(row, (element) => element.tagName === "th")[0] ?? row)));
      if (season && year !== null && !Number.isNaN(year)) terms.push({ year, season, credits: null, courses: [] });
    } else if (hasClass(row, "plangridsum")) {
      if (terms.at(-1)) terms.at(-1)!.credits = hours || null;
    } else if (!hasClass(row, "plangridtotal")) {
      const course = courseOnRow(row);
      if (course && terms.at(-1)) terms.at(-1)!.courses.push(course);
    }
  }
  return terms;
}

/**
 * Each Suggested Academic Plan on a program's page. A page can hold several, such as one with a semester
 * abroad, or one plan cut into two tables: tables whose years don't overlap are parts of the same plan.
 */
export function readSuggestedPlans(html: string): SuggestedPlan[] {
  const plans: SuggestedPlan[] = [];
  let headings: string[] = [];

  function take(node: Node): void {
    if (!("childNodes" in node)) return;
    if (isElement(node)) {
      if (node.tagName === "a" && attribute(node, "name") === "academicplantext") headings = [];
      if (["h2", "h3", "h4"].includes(node.tagName)) {
        const words = tidy(textIn(node));
        if (words !== "" && words !== "Suggested Academic Plan") headings.push(words);
        return;
      }
      if (node.tagName === "table" && hasClass(node, "sc_plangrid")) {
        const terms = termsInGrid(node);
        const latest = plans.at(-1);
        const continues = latest && !terms.some((term) => latest.terms.some((earlier) => earlier.year === term.year));
        if (terms.length > 0 && continues) latest.terms.push(...terms);
        else if (terms.length > 0) plans.push({ heading: headings.slice(-2).join(" - ") || "Suggested Academic Plan", terms });
        headings = [];
        return;
      }
    }
    node.childNodes.forEach(take);
  }

  take(parse(html));
  return plans;
}
