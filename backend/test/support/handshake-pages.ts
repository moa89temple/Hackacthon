import type { RecordingBrowser, SavedPage } from "./recording-browser.ts";

/**
 * MADE UP. None of these pages was saved from real Handshake: nobody has logged in to it yet. They only
 * follow what handshake-rules.ts and handshake-pages.ts assume, so a test passing here says nothing about
 * the real site. `npm run check-handshake` compares those assumptions with it, after the Student's Takeover.
 * Replace these with the shapes it shows, as was done for DARS.
 */

export const ORIGIN = "https://app.joinhandshake.com";
export const SCHOOL_ORIGIN = "https://temple.joinhandshake.com";
/** What the reader asks for. */
export const JOBS_LIST = `${SCHOOL_ORIGIN}/stu/postings`;
export const EVENTS_LIST = `${SCHOOL_ORIGIN}/stu/events`;
/** Where a working login ends up. */
export const JOBS_LANDED = `${ORIGIN}/stu/postings`;
export const EVENTS_LANDED = `${ORIGIN}/stu/events`;
export const LOGGED_OUT = `${SCHOOL_ORIGIN}/login`;

export const jobPage = (id: number) => `${ORIGIN}/stu/jobs/${id}`;
export const eventPage = (id: number) => `${ORIGIN}/stu/events/${id}`;

const FILLER = "About this listing and who it suits, in enough words to count as a whole page. ".repeat(3);

export interface MadeUpListing {
  id: number;
  title: string;
  /** What the listing's own page says. */
  words: string;
}

export const INTERNSHIP: MadeUpListing = {
  id: 101,
  title: "Madeup Hospital Nursing Internship",
  words: "A paid internship on a hospital ward. Apply by December 1, 2026.",
};
export const FAIR: MadeUpListing = {
  id: 202,
  title: "Madeup Health Careers Fair",
  words: "Meet employers on campus on December 3, 2026. This event is free.",
};

/** A list as a working login sees it, with what a real page would also link to. */
export function listHtml(kind: "jobs" | "events", ...listings: MadeUpListing[]): string {
  const links = listings.map(({ id, title }) => `<li><a href="/stu/${kind}/${id}?ref=list">${title}</a></li>`);
  return `<html><head><title>Handshake</title></head><body>
    <nav><a href="/stu/messages">Messages</a><a href="/stu/users/9">Madeup Student</a></nav>
    <main><h1>Listings</h1><ul>${links.join("")}</ul><a href="https://elsewhere.example/stu/${kind}/999">An outside link</a></main>
  </body></html>`;
}

export function listingHtml({ title, words }: MadeUpListing): string {
  return `<html><head><title>${title} | Handshake</title></head><body>
    <header>Madeup Student, Temple University</header>
    <nav><a href="/stu/messages">Messages</a></nav>
    <main><h1>${title}</h1><p>${words}</p><p>${FILLER}</p><button>Apply</button></main>
  </body></html>`;
}

const page = (more: Partial<SavedPage>): SavedPage => ({ title: "Handshake", text: "", accessibilitySnapshot: "", ...more });

/** Handshake for a Student with a working login. Everything in it is made up. */
export function saveHandshakePages(browser: RecordingBrowser, { jobs = [INTERNSHIP], events = [FAIR] }: { jobs?: MadeUpListing[]; events?: MadeUpListing[] } = {}): void {
  browser.savedPages.set(JOBS_LIST, page({ finalUrl: JOBS_LANDED, html: listHtml("jobs", ...jobs) }));
  browser.savedPages.set(EVENTS_LIST, page({ finalUrl: EVENTS_LANDED, html: listHtml("events", ...events) }));
  for (const listing of jobs) browser.savedPages.set(jobPage(listing.id), page({ title: `${listing.title} | Handshake`, html: listingHtml(listing) }));
  for (const listing of events) browser.savedPages.set(eventPage(listing.id), page({ title: `${listing.title} | Handshake`, html: listingHtml(listing) }));
}

/** Handshake for a browser with no login: everything ends up at its login page. */
export function expireHandshakeLogin(browser: RecordingBrowser): void {
  for (const url of [JOBS_LIST, EVENTS_LIST]) browser.savedPages.set(url, page({ finalUrl: LOGGED_OUT, html: "<main>Log in</main>" }));
}
