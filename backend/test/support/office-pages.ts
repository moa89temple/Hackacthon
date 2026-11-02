import { readFileSync } from "node:fs";
import { savedCopyName, type Office } from "../../src/office-pages.ts";
import type { SavedWeb } from "./saved-web.ts";
import { textBlock, type ScriptedReply } from "./scripted-claude.ts";

export const WRITING_CENTER_PAGE = "https://studentsuccess.temple.edu/programs/writing";
export const TUTTLEMAN_CONTACT_PAGE = "https://counseling.temple.edu/about-us/contact-us";
export const HEADSHOTS_PAGE = "https://careercenter.temple.edu/students/grow/book-free-linkedin-headshot-career-center";

/** Three real pages, so that a test can script Haiku's answer to each. */
export const TEST_OFFICES: Office[] = [
  { name: "Student Success Center", pages: [WRITING_CENTER_PAGE] },
  { name: "Tuttleman Counseling Services", pages: [TUTTLEMAN_CONTACT_PAGE] },
  { name: "Career Center", pages: [HEADSHOTS_PAGE] },
];

export function savedOfficePage(url: string): string {
  return readFileSync(new URL(`../fixtures/office-pages/${savedCopyName(url)}`, import.meta.url), "utf8");
}

export function saveOfficePages(web: SavedWeb, offices: Office[]): void {
  for (const url of offices.flatMap((office) => office.pages)) web.save(url, savedOfficePage(url));
}

export type ItemFromHaiku = { name: string; kind?: "resource" | "contact" } & Record<string, unknown>;

/** Haiku's answer for one page. Whatever an item leaves out is empty, as the schema allows. */
export function haikuFinds(...items: ItemFromHaiku[]): ScriptedReply {
  const complete = items.map((item) => ({
    kind: "resource",
    summary: "Helps Students.",
    cost: "not_stated",
    cost_amount: null,
    cost_quote: null,
    phone: null,
    email: null,
    place: null,
    hours: null,
    search_terms: [],
    ...item,
  }));
  return { content: [textBlock(JSON.stringify({ items: complete }))] };
}
