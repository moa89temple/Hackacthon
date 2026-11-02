import type { PagePattern } from "./browser-access.ts";

/**
 * Everything Buddy assumes about Navigate360, in one place, so that the real login can correct it. No
 * one working on this has seen the app logged in. What's here comes from three public places:
 *
 * - Temple's own pages (onestop.temple.edu/resources/navigate-360) give the address.
 * - The page at /app/ is a small script that sends the browser to /app/v1/ or /app/v2/, by a setting
 *   for each person, and goes to v1 when it can't tell, which is what a browser with no login gets.
 * - The app's public scripts name its pages and what it asks the server for. Those are what's marked
 *   "From v2's scripts" below. v1 loads most of its pages later, so what's here for v1 is a guess.
 *
 * `npm run check-navigate360` prints what the real app does, in shape only, to correct this against.
 */

/** The Connection's id. It's also the site's id, because the guard checks the Read Permission by it. */
export const NAVIGATE360_ID = "navigate360";
export const NAVIGATE360_HOST = "temple.navigate.eab.com";
/** Where the app keeps the Student's team. From v2's scripts, by way of a setting: it could be elsewhere. */
export const NAVIGATE360_CAMPUS_HOST = "temple.campus.eab.com";
const SIGN_ON_HOST = "fim.temple.edu";

/**
 * The page a Takeover opens and a login check reads. It chooses the app's version for itself, and sends
 * a browser with no login to where it can log in. Temple's own link adds #/authentication/remote/ to
 * this, which could go through the sign-on again for a Student who's already logged in.
 */
export const navigate360Home = (origin = `https://${NAVIGATE360_HOST}`) => `${origin}/app/`;
export const NAVIGATE360_HOME = navigate360Home();

/** What a Contact shows as its Source. The Student needs their own login to open it. */
export const NAVIGATE360_SOURCE = { url: NAVIGATE360_HOME, title: "Navigate360" };

export const NAVIGATE360_LOGIN_HOSTS = ["eab.com", NAVIGATE360_CAMPUS_HOST, SIGN_ON_HOST, "duosecurity.com"];

export type AppVersion = "v1" | "v2";

/**
 * The pages the reader opens, for each version of the app. The app keeps its pages after the # in an
 * address, and builds each one by script.
 */
export const NAVIGATE360_ROUTES: Record<AppVersion, { team: string; appointments: string }> = {
  // A guess: v1's address for its my.resources.people page, and the one its menu calls Appointments.
  v1: { team: "#/my/resources/people/", appointments: "#/my/schedule/" },
  // From v2's scripts.
  v2: { team: "#/native/my/features/resources/people/categories", appointments: "#/native/my/home/" },
};

/**
 * What the app's own scripts ask the server for on those pages, which is what the reader reads. v2 draws
 * its pages inside its own elements, where the page's HTML doesn't show them, and it shows an advisor's
 * address only behind a button, and Buddy never clicks. Neither of these needs anything clicked or any
 * extra request made. Each is tested against an address's path. From v2's scripts.
 */
export const TEAM_ANSWER = /^\/api\/students\/[^/]+\/support_team\/?$/;
export const APPOINTMENTS_ANSWER = /^\/api\/v2\/scheduling\/current_user\/?$/;

/** Who on the Student's team counts as an advisor, by what the app calls them. */
export const ADVISOR_ROLE = /advis[eo]r|advising/i;

/** An advisor's address is where a Draft goes, so it has to be Temple's own. Subdomains count, such as tuj.temple.edu. */
export const ADVISOR_EMAIL_DOMAIN = "temple.edu";

/** Asks whether the app is anywhere it logs in. A login is often just another page of the same app. */
const LOGIN_ROUTE = /^#\/(?:[^?]*\/)?(?:authentication|login)(?:[/?]|$)/i;

export function isLoginRoute(fragment: string): boolean {
  return LOGIN_ROUTE.test(fragment);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\/$/, "");
}

/** Where the app goes by itself, from the page that chooses its version. From v1's scripts, and v2's route above. */
const LANDING_ROUTES = ["#/my/feed/"];
const READABLE_ROUTES = [...LANDING_ROUTES, ...Object.values(NAVIGATE360_ROUTES).flatMap(({ team, appointments }) => [team, appointments])];
const READABLE_FRAGMENT = new RegExp(`^(?:${READABLE_ROUTES.map(escaped).join("|")})/?$`);

/**
 * The only pages Buddy opens on Navigate360. A browser never sends the part after the #, so only Buddy's
 * own request to open a page can be held to the list of routes: what the guard sees as the page goes
 * through the browser is its address without them. See `fragment` on PagePattern.
 */
export function navigate360ReadablePages(host: string): PagePattern[] {
  const app = /^\/app\/(?:v[12]\/)?$/;
  return [
    { host, path: app, fragment: READABLE_FRAGMENT },
    // Only so that a read can see a login has expired. Nothing is taken from these.
    { host, path: app, fragment: LOGIN_ROUTE },
    { host: SIGN_ON_HOST, path: /^\// },
  ];
}

export const NAVIGATE360_READABLE_PAGES = navigate360ReadablePages(NAVIGATE360_HOST);

const END = "(?:[/.;?]|$)";
const API = "^/+api/+v\\d+/+";

/**
 * Pages Buddy never opens, reads or submits, even with an approved card. They're off the list above
 * too. These are here so that nothing can ever add one by mistake, and so that what these pages load
 * stays out as well. From v2's scripts, and v1's names for the same pages.
 */
export const NAVIGATE360_BLOCKED_PAGES: PagePattern[] = [
  // Booking, cancelling, and everything else about an appointment that asks the Student for something.
  {
    path: /^\/+app\//,
    fragment: new RegExp(
      `^#/+(?:[^?]*/)?(?:apps|appointment-[a-z-]+|pre-appointment-[a-z-]+|standalonescheduler|schedule-appointment)${END}`,
    ),
  },
  // Messages, and raising a hand, which is a message to the Student's team.
  { path: /^\/+app\//, fragment: new RegExp(`^#/+(?:[^?]*/)?(?:conversations?|messages?|raise_hand(?:_form)?|hand_raise)${END}`) },
  // Other students: Study Buddies shows classmates who've opted in, and their contact details.
  { path: /^\/+app\//, fragment: new RegExp(`^#/+(?:[^?]*/)?(?:study|studygroups|study[-_]?buddy|study[-_]?buddies)${END}`) },
  // Links into any of those from an email. The app goes wherever one says.
  { path: /^\/+app\//, fragment: /^#\/+dl(?:[/?]|$)/ },

  // What those pages ask the server for.
  { path: new RegExp(`${API}study${END}`) },
  { path: new RegExp(`${API}(?:notification/+students/+[^/]+/+)?(?:messages?|conversations?)${END}`) },
  { path: new RegExp(`/(?:raise_hand|hand_raise|study_buddies|study_buddy)${END}`) },
];
