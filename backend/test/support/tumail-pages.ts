import { readFileSync } from "node:fs";
import type { RecordingBrowser, SavedPage } from "./recording-browser.ts";

export const INBOX_PAGE = "https://outlook.office.com/mail/inbox";
export const messagePage = (id: string) => `${INBOX_PAGE}/id/${encodeURIComponent(id)}`;

export const ADVISOR = "AAQkMadeUpAdvisor=";
export const CLINIC = "AAQkMadeUpHospital=";
export const PARTNER = "AAQkMadeUpContact=";
export const STRANGER = "AAQkMadeUpStranger=";
export const LOOKALIKE = "AAQkMadeUpLookalike=";

export function savedTumailHtml(name: string): string {
  return readFileSync(new URL(`../fixtures/tumail-pages/${name}.html`, import.meta.url), "utf8");
}

export function outlookPage(html: string, more: Partial<SavedPage> = {}): SavedPage {
  return { title: "Mail - Outlook", text: "", accessibilitySnapshot: "", html, ...more };
}

/** A message as Outlook shows it beside the list. Everything in it is made up. */
export function messageHtml(message: { from: string; subject?: string; when?: string; body: string; alsoInTheList?: string }): string {
  return `<!doctype html><html><head><title>Mail - Outlook</title></head><body><div role="main">
    <div role="listbox" aria-label="Message list">${message.alsoInTheList ?? ""}</div>
    <div id="ReadingPaneContainerId" aria-label="Reading Pane">
      <div role="heading" aria-level="2"><span>${message.subject ?? "A made-up subject"}</span></div>
      <div aria-label="From: someone"><span>${message.from}</span></div>
      <div data-testid="SentReceivedSavedTime">${message.when ?? "Sun 11/1/2026 2:15 PM"}</div>
      <div aria-label="Message body" role="document">${message.body}</div>
    </div>
  </div></body></html>`;
}

/** One row of the list, for pages a test makes itself. Everything in it is made up. */
export function rowHtml(row: { id: string; address: string; words: string; unread?: boolean; when?: string }): string {
  const when = row.when ?? "Sun 11/1/2026 2:15 PM";
  return `<div role="option" data-convid="${row.id}" aria-label="${row.unread ? "Unread " : ""}Someone ${row.words}">
    <button title="Made-up expand"></button><div role="checkbox" title="Made-up select"><span role="img"></span></div><div title=""></div>
    <span title="${row.address}">Someone</span><span title="A subject">A subject</span><span title="${when}">soon</span><span>${row.words}</span>
  </div>`;
}

export function inboxHtml(...rows: string[]): string {
  return `<!doctype html><html><body><div role="main"><div role="listbox" aria-label="Message list">${rows.join("")}</div></div></body></html>`;
}

/**
 * The made-up pages, as Outlook would serve them to a Student with a working login. Three of the five
 * messages can be opened. The lookalike and the stranger have no pages, so opening one fails the test.
 */
export function saveTumailPages(browser: RecordingBrowser): void {
  browser.savedPages.set(INBOX_PAGE, outlookPage(savedTumailHtml("inbox")));
  browser.savedPages.set("https://outlook.office.com/mail/", outlookPage(savedTumailHtml("inbox")));
  browser.savedPages.set(messagePage(ADVISOR), outlookPage(savedTumailHtml("message-advisor")));
  browser.savedPages.set(
    messagePage(CLINIC),
    outlookPage(messageHtml({ from: "Made-Up Clinic &lt;clinic@tuhs.temple.edu&gt;", subject: "Your form", body: "<p>Please bring your form.</p>" })),
  );
  browser.savedPages.set(
    messagePage(PARTNER),
    outlookPage(messageHtml({ from: "Made-Up Partner &lt;partner@elsewhere.test&gt;", subject: "Program Visit", body: "<p>See you at the visit.</p>" })),
  );
}

/** Outlook sending a browser with no working login to Microsoft's sign-in. */
export function expireTumailLogin(browser: RecordingBrowser): void {
  for (const [url, page] of browser.savedPages) {
    if (url.startsWith("https://outlook.office.com")) {
      browser.savedPages.set(url, {
        ...page,
        finalUrl: "https://login.microsoftonline.com/common/oauth2/authorize?client_id=made-up",
        html: '<form><input name="loginfmt"></form>',
      });
    }
  }
}
