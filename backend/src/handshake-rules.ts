import type { PagePattern } from "./browser-access.ts";

/**
 * Everything Buddy assumes about Handshake's addresses, in one place. UNVERIFIED: nobody has logged in to
 * Handshake through Buddy's Browser yet, and no page of it has been seen. Every host and path here comes
 * from memory of how Handshake's addresses look, not from a real login. `npm run check-handshake` prints
 * what the real site does, in shape only, to correct this against once the Student has logged in.
 *
 * The strictness doesn't depend on that being right. A wrong address here means Buddy reads too little and
 * says so. It can't mean Buddy applies, RSVPs or messages: the guard refuses every request that isn't a read.
 */

/** The Connection's id. It's also the site's id, because the guard checks the Read Permission by it. */
export const HANDSHAKE_ID = "handshake";

/** ASSUMED: Temple's own way in. It's the usual pattern for a school, and nobody has opened this one. */
const SCHOOL_HOST = "temple.joinhandshake.com";
/** ASSUMED: where a login ends up. */
const APP_HOST = "app.joinhandshake.com";
const OWN_DOMAIN = "joinhandshake.com";
const HOSTS = [SCHOOL_HOST, APP_HOST];
/** ASSUMED: that Temple's Handshake logs in through Temple's single sign-on and Duo. */
const SIGN_ON_HOST = "fim.temple.edu";

/** The page a Takeover opens and a login check reads. ASSUMED: it shows a login to a browser with none. */
export const HANDSHAKE_HOME = `https://${SCHOOL_HOST}/stu`;

/** The school's host too, so that a forgotten login takes that host's storage with it. See forgetLogin. */
export const HANDSHAKE_LOGIN_HOSTS = [OWN_DOMAIN, SCHOOL_HOST, APP_HOST, SIGN_ON_HOST, "duosecurity.com"];
/** Where a logged-in home page can end up. */
export const HANDSHAKE_APP_HOSTS = [APP_HOST];

export const HANDSHAKE_NAME = "Handshake";

/** ASSUMED: one list of jobs, which has internships among them, and one of events. */
export const HANDSHAKE_LISTS = {
  job: `https://${SCHOOL_HOST}/stu/postings`,
  event: `https://${SCHOOL_HOST}/stu/events`,
};
export type ListingKind = keyof typeof HANDSHAKE_LISTS;

/** ASSUMED: the address of one listing's own page, always ending in its number. */
export const LISTING_PAGE: Record<ListingKind, RegExp> = {
  job: /^\/(?:stu\/jobs|jobs|job-search)\/(\d+)\/?$/,
  event: /^\/(?:stu\/events|events)\/(\d+)\/?$/,
};
const LIST_PAGE = /^\/(?:stu\/postings|job-search|stu\/events|events)\/?$/;
const HOME_PAGE = /^\/(?:stu\/?)?$/;
/** ASSUMED: where a browser with no login gets sent, on Handshake's own hosts. */
const LOGIN_PAGE = /^\/(?:login|sessions\/new)\/?$/;

/** The only pages Buddy opens on Handshake. Only so that a read can see a login has gone, nothing is taken from the login pages. */
export const HANDSHAKE_READABLE_PAGES: PagePattern[] = [
  ...HOSTS.flatMap((host) => [HOME_PAGE, LIST_PAGE, LISTING_PAGE.job, LISTING_PAGE.event, LOGIN_PAGE].map((path) => ({ host, path }))),
  { host: SIGN_ON_HOST, path: /^\// },
];

const segment = (words: string) => new RegExp(`(?:^|/)(?:${words})(?:[/.;]|$)`);

const NEVER = [
  // Doing something: applying, and everything about an application or an interview.
  segment("apply|applications?|job[_-]applications?|interviews?|interview[_-]schedules?"),
  // Going to something: an RSVP, registering and checking in.
  segment("rsvps?|register|registrations?|event[_-]registrations?|check[_-]?ins?|attendees?"),
  // Messages to and from employers and other students.
  segment("messages?|conversations?|message[_-]threads?|inbox|notifications?"),
  // Other people: profiles, classmates and what they've posted.
  segment("users?|profiles?|people|students?|peers?|community|feed|posts?|network|connections?"),
  // The Student's own papers, settings and what they've saved or followed, which reading doesn't need.
  segment("documents?|resumes?|transcripts?|settings|account|saved[_-]jobs|saved[_-]searches|favorites?|bookmarks?|follows?"),
  /*
   * ASSUMED to exist. One address that does everything by a field in its body, as Navigate360's ajax.jsp
   * did, so what a request does can't be told from where it goes. A POST is refused anyway. This stops a
   * GET too, and stands in the way of anyone adding it to a list by address.
   */
  segment("graphql"),
];

/**
 * Pages Buddy never opens, reads or submits, even with an approved card, and what pages may not load
 * either. They're off the list above too. These are here so that nothing can ever add one by mistake.
 *
 * Each names its host, because a pattern with none would also apply to the sign-on the site shares with
 * every other Connection, where /idp/profile/ is the way to log in to all of them.
 */
export const HANDSHAKE_BLOCKED_PAGES: PagePattern[] = [SCHOOL_HOST, APP_HOST, OWN_DOMAIN, `www.${OWN_DOMAIN}`].flatMap((host) => NEVER.map((path) => ({ host, path })));

function hostOf(address: string): string | null {
  return URL.parse(address)?.hostname ?? null;
}

/** A browser with no login gets sent to a login page, or off to the sign-on. */
export function isHandshakeLoginPage(address: string): boolean {
  const url = URL.parse(address);
  return !url || !HOSTS.includes(url.hostname) || LOGIN_PAGE.test(url.pathname);
}

/** Whether this page came from Handshake, by its host alone, so that nothing a page says can change it. */
export function isHandshakeListing(address: string): boolean {
  const host = hostOf(address);
  return host === OWN_DOMAIN || (host?.endsWith(`.${OWN_DOMAIN}`) ?? false);
}

/** One of Handshake's hosts. A link to anywhere else on a page is someone else's. */
export function isHandshakeHost(host: string): boolean {
  return HOSTS.includes(host);
}
