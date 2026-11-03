import type { PagePattern, Site } from "./browser-access.ts";

/**
 * Everything Buddy assumes about DARS, in one place, so that it can be put right once in one file.
 * `npm run check-dars` shows where each of these lands against a real login, without showing the Student's records.
 *
 * What was seen with a real login, on one Student's one audit, on 2026-11-03:
 * - DARS_PAGES.list, DARS_PAGES.audit and AUDIT_QUERY are right, the list is read as AUDIT_LIST_SHAPE says, and
 *   the guard refuses nothing a read needs.
 * - The audit is in the page's HTML. AUDIT_SHAPE's classes are all real. A part's mark is on a status element
 *   inside it, not on the part, and a part with nothing to say has none. Each requirement also draws its mark,
 *   as statusOK beside Status_OK, and the two agree. The page's key to the marks uses those too, outside them all.
 * - A title's element goes on, past a line break, into words about the requirement. A block with no title is
 *   only a note, with no state.
 * - A needed course keeps its department and number in attributes, because what's shown can leave the
 *   department out or add a condition such as a lowest grade.
 * - The audit has no sentence about the whole of it, such as "all requirements complete".
 *
 * What was seen, logged out, on 2026-11-03:
 * - dars.temple.edu sends a browser to prd-dars.temple.edu/selfservice, and on to /selfservice/ and
 *   /selfservice/general/loginroute.html, which sends it to Temple's sign-on, at
 *   fim.temple.edu/idp/profile/SAML2/Unsolicited/SSO. No page of Banner's is on the way.
 *
 * What Temple's public pages say, as of November 2026 (sites.temple.edu/degreeaudit, and the Bulletin):
 * - A Student reaches it at dars.temple.edu, or from TUportal by Student Tools, then Records, then Degree
 *   Audit. Going through Self-Service Banner is the way for advisors, not Students.
 * - The Student Documentation: the page of past audits is "Completed Audit Requests", with a "View Audit"
 *   link on each, a "New Audit" button and a Delete box. A new one is made with "Run Audit", now called
 *   "Run Declared Programs". The columns are in AUDIT_LIST_SHAPE.
 * - The What-If guide: a What-If audit says WHAT-IF in the Audit Type column, its Catalog Year is all nines,
 *   and it's about a major the Student doesn't have.
 * - The Audit Interpretation guide: Unfulfilled, Complete, In Progress, Planned and None are what each
 *   requirement can be, and In Progress only means satisfied if the courses under way count.
 * - The FAQ: an audit is only "current as of the moment an audit is processed".
 *
 * What's still a guess:
 * - The wording in AUDIT_LIST_SHAPE.saysNone, as this Student has an audit.
 * - That Status_PL is what a planned requirement says. The page's key has statusPL, and this audit has none.
 * - That another Student's audit ends with the same last block: see AUDIT_SHAPE.lastBlockClass.
 * - That a complete requirement never has a part that isn't. It didn't on this audit: see
 *   AUDIT_SHAPE.completeCanHaveUnmetParts.
 * - That the Created column is on Philadelphia's clock.
 *
 * Whether a read has to run a new audit: it doesn't have to, and Buddy never does. It reads the newest one
 * already on the list, and says how old it is. Running one is a click that makes a record, so it would need
 * deciding by a person. Until then a Student with no audit on the list has nothing to read.
 */

/** The Connection's id. It's also the site's id, because the guard checks the Read Permission by it. */
export const DARS_ID = "dars";
export const DARS_ORIGIN = "https://prd-dars.temple.edu";
const DARS_HOST = new URL(DARS_ORIGIN).hostname;
/** The address Temple gives Students. It only ever redirects. */
const DARS_SHORT_HOST = "dars.temple.edu";
const SIGN_ON_HOST = "fim.temple.edu";
const DUO_HOST = "duosecurity.com";

/** The reader opens these and no others. */
export const DARS_PAGES = {
  list: "/selfservice/audit/list.html",
  audit: "/selfservice/audit/read.html",
};

export type DarsPage = keyof typeof DARS_PAGES;

/** All that may follow the ? on an audit's address, as the guard tests it: decoded and in lower case. */
const AUDIT_QUERY = String.raw`\?id=[^&]*$`;

/** Where the server sends someone to log in. Nothing is taken from it. */
const WAY_TO_SIGN_ON = "/selfservice/general/loginroute.html";

/** What a Roadmap card shows as its Source. The Student needs their own login to open it. */
export const DARS_SOURCE = { url: `https://${DARS_SHORT_HOST}/`, title: "Your DARS audit" };

/** How the page of past audits is read. Each is about a page nobody has seen: see above. */
export const AUDIT_LIST_SHAPE = {
  /** The headings of the columns the reader needs. A table without all of them isn't the list. */
  columns: {
    program: /^program$/i,
    catalogYear: /^catalog/i,
    created: /created/i,
    type: /^(?:audit )?type$/i,
    view: /^view$/i,
  },
  /** What the type column says on a What-If audit. From Temple's guide. */
  whatIfType: /what-?if/i,
  /** And its catalog year. From Temple's guide. */
  whatIfCatalogYear: /^9+$/,
  /**
   * What the type column says on the Student's real audit. In Temple's guides it's only a mark with no
   * words. Anything else stops the read, so that a new kind of audit isn't taken for the real one.
   */
  regularType: /^$/,
  /** As 10/30/2026 3:52 PM, in Temple's guides. */
  created: /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
  /** A whole line that says there are no audits. A sentence that only mentions them doesn't count. */
  saysNone: /^(?:there are )?no (?:completed )?(?:degree )?audit(?: request)?s?(?: requests?)?(?: (?:found|available|to display|have been run))?[.!]?$/i,
};

export type RequirementStatus = "complete" | "missing" | "in_progress" | "planned" | "none";
/** "None" is Temple's own word for no state at all, so it makes no fact. */
export type StatedStatus = Exclude<RequirementStatus, "none">;

/** How an audit is read. See above for what's been seen and what hasn't. */
export const AUDIT_SHAPE = {
  requirementClass: "requirement",
  requirementTitleClass: "reqTitle",
  partClass: "subrequirement",
  partTitleClass: "subreqTitle",
  /**
   * The class that says what state a requirement is in. It's the only thing that does. Any other class that
   * starts with statusPrefix stops the read, because a wrong "complete" could mislead a Student about graduating.
   */
  statusClasses: {
    Status_OK: "complete",
    Status_NO: "missing",
    Status_IP: "in_progress",
    Status_PL: "planned",
    Status_NONE: "none",
  } as Record<string, RequirementStatus>,
  statusPrefix: /^status_/i,
  /** The element in a part that holds its mark. A part whose element has no mark has no state of its own. */
  partMarkClass: "status",
  /** The same mark drawn for the eye. Inside a requirement it has to be that requirement's own. */
  drawnStatusPrefix: /^status[A-Z]/,
  /**
   * A requirement can be met without all of its parts, such as any two of three, and then this should be
   * true. The one audit seen so far doesn't show it that way, and until one does the two disagreeing stops the read.
   */
  completeCanHaveUnmetParts: false,
  /** What the page puts in front of a title, which isn't part of it. In Temple's guide's picture. */
  titleLeader: /^~\s*/,
  /** A needed course: its element, and where the page lists those already taken, which don't count. */
  courseClass: "course",
  takenCoursesClass: "completedCourses",
  /** A whole course number, such as ANTH 0814 or MATH L006. */
  course: /^[A-Z]{2,5} [A-Z]?\d{3,4}$/,
  /**
   * The audit has no word of its own on the whole of it, so these are what shows it's all there: the heading over
   * the requirements, and the block that comes after them all. Leaving one out could leave out what's missing.
   */
  saysDetailsFollow: /^audit result details$/i,
  lastBlockClass: "category_ACADEMIC_HISTOR",
  /** A What-If audit, from what's on the audit itself. From Temple's guide. */
  whatIfCatalog: /\bcatalog\s+(?:year|term)\W*9{4,}\b/i,
};

/** Whether this address is the page that was asked for. A page that ends up anywhere else isn't, however much it looks like it. */
export function isDarsPage(page: DarsPage, address: string, host = DARS_HOST): boolean {
  const url = URL.parse(address);
  return url !== null && url.hostname === host && url.pathname === DARS_PAGES[page];
}

/** DARS sends a browser with no login off to the sign-on. Anywhere off DARS, or on its way there, isn't logged in. */
export function isDarsLoginPage(address: string, host = DARS_HOST): boolean {
  const url = URL.parse(address);
  return url === null || url.hostname !== host || url.pathname === WAY_TO_SIGN_ON;
}

const exactly = (path: string) => new RegExp(`^${path.replaceAll(".", "\\.")}$`);

/**
 * The only pages Buddy opens on DARS, each tested by its path as it is. /selfservice/ and the way to the
 * sign-on are only so that a login check can see where it ends up. A page they lead to that isn't here is
 * refused, and `npm run check-dars` prints it.
 */
export function darsReadablePages(host = DARS_HOST): PagePattern[] {
  return [
    ...Object.values(DARS_PAGES).map((path) => ({ host, path: exactly(path) })),
    { host, path: /^\/selfservice\/?$/ },
    { host, path: exactly(WAY_TO_SIGN_ON) },
    { host: DARS_SHORT_HOST, path: /^\/(?:selfservice\/?)?$/ },
    { host: SIGN_ON_HOST, path: /^\// },
  ];
}

/** What a page may load for its own look. Nothing else on DARS loads, because any address could be one that acts. */
const ITS_OWN_LOOK = String.raw`[^?]*\.(?:css|js|png|gif|jpe?g|svg|ico|woff2?|ttf|eot|map)`;

/**
 * Pages Buddy never opens, reads or submits, even with an Action Permission. The guard refuses these first,
 * for pages, frames, redirects and everything a page loads. It's everything on DARS but the pages above and
 * what they load for their look, because nobody can say from outside which of its addresses run or delete an
 * audit. The list is opened as it is, and an audit with nothing added to the one value it needs.
 *
 * Anything that isn't a plain read is refused as well, as this site has no readOnlyRequests: running an audit
 * is a change, and so is coming back from the sign-on with a POST, which is why a login that's run out needs a
 * Takeover. Letting that one request through would be a decision for a person, with what `npm run check-dars`
 * shows of it in front of them.
 */
export function darsBlockedPages(host = DARS_HOST): PagePattern[] {
  const pages = [...Object.values(DARS_PAGES), WAY_TO_SIGN_ON].map((path) => path.replaceAll(".", "\\.")).join("|");
  return [
    { host, path: new RegExp(`^(?!/selfservice/?$|(?:${pages})$|${ITS_OWN_LOOK}$)`) },
    { host: DARS_SHORT_HOST, path: /^(?!\/(?:selfservice\/?)?$)/ },
    { host, path: exactly(DARS_PAGES.list), query: /./ },
    { host, path: exactly(DARS_PAGES.audit), query: new RegExp(`^(?!${AUDIT_QUERY})`) },
    { host: SIGN_ON_HOST, path: /(?:^|[/_.-])(?:logout|slo)(?:$|[/_.-])/ },
  ];
}

/** The addresses and hosts are only ever something else for made-up pages in the checks of the real browser. */
export function darsSiteAt(origin: string = DARS_ORIGIN, otherHosts: string[] = [SIGN_ON_HOST, DUO_HOST]): Site {
  const host = new URL(origin).hostname;
  return {
    name: "DARS",
    // Opens the list itself, so that nothing has to pass through whatever page DARS lands on after a login.
    homeUrl: new URL(DARS_PAGES.list, origin).href,
    // Temple's single sign-on and Duo are shared with other Connections: see forgetLogin in browser-access.ts.
    loginHosts: [host, DARS_SHORT_HOST, ...otherHosts],
    isConnection: true,
    signOnDomains: ["temple.edu"],
    readablePages: darsReadablePages(host),
    blockedPages: darsBlockedPages(host),
    isLoginPage: (address) => isDarsLoginPage(address, host),
  };
}

export const DARS_SITE = darsSiteAt();
