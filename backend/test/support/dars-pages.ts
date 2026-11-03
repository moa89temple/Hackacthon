import { readFileSync } from "node:fs";
import type { RecordingBrowser, SavedPage } from "./recording-browser.ts";
import { pageFrom, SIGN_ON_PAGE } from "./tuportal-pages.ts";

/** Everything here is made up, in the layout of a real audit: see dars-rules.ts. */

export const DARS = "https://prd-dars.temple.edu";
export const LIST_PAGE = `${DARS}/selfservice/audit/list.html`;
export const NEWEST_AUDIT = `${DARS}/selfservice/audit/read.html?id=made-up-newest`;
export const OLDER_AUDIT = `${DARS}/selfservice/audit/read.html?id=made-up-older`;
export const WHAT_IF_AUDIT = `${DARS}/selfservice/audit/read.html?id=made-up-what-if`;

export function savedDarsHtml(name: string): string {
  return readFileSync(new URL(`../fixtures/dars-pages/${name}.html`, import.meta.url), "utf8");
}

export function darsPage(html: string, more: Partial<SavedPage> = {}): SavedPage {
  return { title: "DARS", accessibilitySnapshot: "", ...pageFrom(html), ...more };
}

/** An audit with these requirements, by title and state, and what a whole audit has around them. */
export function auditWith(requirements: Record<string, string>, more = ""): string {
  const blocks = Object.entries(requirements).map(([title, status]) => `<div class="requirement ${status}"><div class="reqTitle">${title}</div>${more}</div>`);
  return `<!doctype html><html><head><title>Audit Results</title></head><body><h2>Audit Result Details</h2>${blocks.join("")}<div class="requirement Status_NONE category_ACADEMIC_HISTOR"><div class="reqTitle"></div></div></body></html>`;
}

/** The made-up pages, as DARS would serve them to a Student with a working login. */
export function saveDarsPages(browser: RecordingBrowser, { list = savedDarsHtml("audit-list"), audit = savedDarsHtml("audit") }: { list?: string; audit?: string } = {}): void {
  browser.savedPages.set(LIST_PAGE, darsPage(list));
  browser.savedPages.set(NEWEST_AUDIT, darsPage(audit));
}

/** DARS sending a browser with no working login to Temple's sign-on page. */
export function expireDarsLogin(browser: RecordingBrowser): void {
  for (const [url, page] of browser.savedPages) {
    if (url.startsWith(DARS)) browser.savedPages.set(url, { ...page, finalUrl: SIGN_ON_PAGE, html: "<form>Made-up sign-on page</form>", text: "Made-up sign-on page" });
  }
}
