import { readFileSync } from "node:fs";
import type { RecordingBrowser, SavedPage } from "./recording-browser.ts";

export const CANVAS_HOME = "https://templeu.instructure.com";
export const COURSES_PAGE = `${CANVAS_HOME}/courses`;
export const coursePage = (course: string, page: string) => `${CANVAS_HOME}/courses/${course}/${page}`;

export function savedCanvasHtml(name: string): string {
  return readFileSync(new URL(`../fixtures/canvas-pages/${name}.html`, import.meta.url), "utf8");
}

export function canvasPage(html: string, more: Partial<SavedPage> = {}): SavedPage {
  return { title: "Canvas", text: "", accessibilitySnapshot: "", html, ...more };
}

/**
 * The made-up pages in test/fixtures/canvas-pages, as Canvas would serve them to a Student with a
 * working login. Course 101 has everything, and course 102 has nothing in it yet.
 */
export function saveCanvasPages(browser: RecordingBrowser): void {
  const pages: [string, string][] = [
    [`${CANVAS_HOME}/`, "<h1>Made-up dashboard</h1>"],
    [COURSES_PAGE, savedCanvasHtml("courses")],
    [coursePage("101", "assignments"), savedCanvasHtml("assignments")],
    [coursePage("101", "grades"), savedCanvasHtml("grades")],
    [coursePage("101", "announcements"), savedCanvasHtml("announcements")],
    [coursePage("102", "assignments"), '<div class="ig-row ig-row-empty"><div class="ig-empty-msg">No assignments</div></div>'],
    [coursePage("102", "grades"), '<table id="grades_summary"></table>'],
    [coursePage("102", "announcements"), '<div class="announcements-v2__wrapper"><h2>No Announcements</h2></div>'],
  ];
  for (const [url, html] of pages) browser.savedPages.set(url, canvasPage(html));
}

/** Canvas sending a browser with no working login to Temple's sign-on page. */
export function expireCanvasLogin(browser: RecordingBrowser): void {
  for (const [url, page] of browser.savedPages) {
    if (url.startsWith(CANVAS_HOME)) {
      browser.savedPages.set(url, { ...page, finalUrl: "https://fim.temple.edu/idp/profile/SAML2/Redirect/SSO?execution=e1s1", html: "<form>Made-up sign-on page</form>" });
    }
  }
}

/** Changes one saved page, as if Canvas's content had changed since the last read. */
export function changeSavedPage(browser: RecordingBrowser, url: string, change: (html: string) => string): void {
  const page = browser.savedPages.get(url)!;
  browser.savedPages.set(url, { ...page, html: change(page.html ?? "") });
}
