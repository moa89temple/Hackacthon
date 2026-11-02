import { readFileSync } from "node:fs";
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import type { RecordingBrowser, SavedPage } from "./recording-browser.ts";

export const TUPORTAL = "https://tuportal6.temple.edu";
export const HOME_PAGE = `${TUPORTAL}/group/home`;
export const HOLDS_PAGE = `${TUPORTAL}/group/home/student-record-services?holds?pweb`;
export const BALANCE_PAGE = `${TUPORTAL}/group/home/costs-and-aid`;
export const REGISTRATION_PAGE = `${TUPORTAL}/group/home/student`;
/** Where a browser with no working login ends up. */
export const SIGN_ON_PAGE = "https://fim.temple.edu/idp/profile/SAML2/Redirect/SSO?execution=e1s1";

const BLOCKS = new Set(["address", "article", "caption", "dd", "div", "dl", "dt", "h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "section", "table", "tr", "ul"]);
const NOT_SHOWN = new Set(["head", "script", "style", "template", "noscript"]);

/** Near enough what a browser's innerText gives: one line per block, a tab between a row's cells, and nothing hidden. */
export function visibleText(html: string): string {
  const out: string[] = [];
  const visit = (node: Html.ChildNode | Html.Document): void => {
    if (node.nodeName === "#text") {
      out.push((node as Html.TextNode).value.replace(/\s+/g, " "));
      return;
    }
    if (!("childNodes" in node)) return;
    if ("tagName" in node) {
      if (NOT_SHOWN.has(node.tagName)) return;
      if (node.attrs.some((attr) => attr.name === "hidden" || (attr.name === "style" && /display\s*:\s*none/i.test(attr.value)))) return;
    }
    const block = "tagName" in node && BLOCKS.has(node.tagName);
    if (block) out.push("\n");
    node.childNodes.forEach(visit);
    if ("tagName" in node && (node.tagName === "td" || node.tagName === "th")) out.push("\t");
    if (block) out.push("\n");
  };
  visit(parse(html));
  return out
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function savedTuportalHtml(name: string): string {
  return readFileSync(new URL(`../fixtures/tuportal-pages/${name}.html`, import.meta.url), "utf8");
}

/** A made-up page, with what a Student would see on it. */
export const pageFrom = (html: string) => ({ html, text: visibleText(html) });
export const savedPage = (name: string) => pageFrom(savedTuportalHtml(name));

export function tuportalPage(html: string, more: Partial<SavedPage> = {}): SavedPage {
  return { title: "TUportal", accessibilitySnapshot: "", ...pageFrom(html), ...more };
}

/** The made-up pages, as TUportal would serve them to a Student with a working login. */
export function saveTuportalPages(browser: RecordingBrowser, { holds = "holds" }: { holds?: string } = {}): void {
  const pages: [string, string][] = [
    [`${TUPORTAL}/`, "<h1>Made-up TUportal front page</h1>"],
    [HOME_PAGE, '<h1>Made-up TUportal home</h1><a href="/group/home/costs-and-aid">Cost &amp; Aid</a>'],
    [HOLDS_PAGE, savedTuportalHtml(holds)],
    [BALANCE_PAGE, savedTuportalHtml("balance")],
    [REGISTRATION_PAGE, savedTuportalHtml("registration")],
  ];
  for (const [url, html] of pages) browser.savedPages.set(url, tuportalPage(html));
}

/** Changes one saved page, as if something had changed on TUportal since the last read. */
export function changeTuportalPage(browser: RecordingBrowser, url: string, html: string, more: Partial<SavedPage> = {}): void {
  browser.savedPages.set(url, tuportalPage(html, more));
}

/** TUportal sending a browser with no working login to Temple's sign-on page. */
export function expireTuportalLogin(browser: RecordingBrowser): void {
  for (const [url, page] of browser.savedPages) {
    if (url.startsWith(TUPORTAL)) {
      browser.savedPages.set(url, { ...page, finalUrl: SIGN_ON_PAGE, html: "<form>Made-up sign-on page</form>", text: "Made-up sign-on page" });
    }
  }
}
