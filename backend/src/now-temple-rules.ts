/**
 * Everything Buddy assumes about now.temple.edu, in one place.
 *
 * What the public site showed, on 2026-11-03:
 * - It's a Drupal site, and its events are in the HTML, so a plain fetch reads them. There's no RSS, ICS or
 *   JSON feed linked anywhere, and robots.txt allows everything.
 * - /events lists twelve events to a page, soonest first, each as a teaser with a <time class="date"> and a
 *   link to /events/YYYY-MM-DD/slug. Its pager only shows nine pages, but ?page=20 still answers.
 * - Nine pages reach about ten days ahead. Fifteen reach a little over two weeks.
 * - A date reads "Mon., Nov. 2, 2026 7:30 pm", or "Tue., Nov. 3, 2026 12:00 pm to 1:00 pm", or
 *   "Tue., Nov. 10, 2026 6:00 pm to Thu., Dec. 3, 2026 6:00 pm". An all-day one runs 12:00 am to 11:59 pm.
 * - A cancelled event stays on the list, with "Cancelled" in its title.
 * - An event's own page keeps what it says in <article class="page page__calendar-event">.
 *
 * test/fixtures/now-temple-pages holds real copies of these pages.
 */

/** Already on settings.publicHosts, so this ticket adds nothing to the guard for it. */
export const NOW_TEMPLE_HOST = "now.temple.edu";
const EVENTS_LIST = `https://${NOW_TEMPLE_HOST}/events`;

/** How far ahead Buddy looks. Each page means one more fetch a day, and one Haiku call per new event on it. */
export const MOST_EVENT_LIST_PAGES = 15;

/** The first page has no ?page= of its own, as the site's own links to it don't need one. */
export function eventListPage(index: number): string {
  return index === 0 ? EVENTS_LIST : `${EVENTS_LIST}?page=${index}`;
}

/** An event's address, which gives its first day. */
export const EVENT_PATH = /^\/events\/(\d{4}-\d{2}-\d{2})\/[a-z0-9-]+$/;

export function isNowTempleEvent(address: string): boolean {
  const url = URL.parse(address);
  return url?.hostname === NOW_TEMPLE_HOST && EVENT_PATH.test(url.pathname);
}

export const EVENT_TEASER_CLASS = "teaser__calendar-event";
export const EVENT_DATE_CLASS = "date";
export const EVENT_TITLE_CLASS = "title";
export const EVENT_PAGE_CLASS = "page__calendar-event";

export const CANCELLED_EVENT = /\bcancel+ed\b/i;
/** A day as the list writes it, such as "Tue., Nov. 3, 2026". */
export const LISTED_DAY = /[A-Z][a-z]{2}\., ([A-Z][a-z]{2})\.? (\d{1,2}), (\d{4})/g;
/** The times on the list, such as "12:00 pm to 1:00 pm". */
export const LISTED_TIMES = /\d{1,2}:\d{2} [ap]m(?: to \d{1,2}:\d{2} [ap]m)?/;
export const ALL_DAY_TIMES = "12:00 am to 11:59 pm";
