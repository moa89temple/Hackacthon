import { parse } from "parse5";
import { createBrowserAccess, TakeoverInProgress, type Site } from "./browser-access.ts";
import type { BuddysBrowser, PageReading } from "./buddys-browser.ts";
import { EXIT_FAILED, EXIT_LOGIN_NEEDED, EXIT_NO_READ_PERMISSION, EXIT_OK, EXIT_OLD_LOGIN_REMAINS, EXIT_TAKEOVER_UNDER_WAY, structureOf, type StudentState } from "./canvas-check.ts";
import { systemClock } from "./clock.ts";
import { createConnections, type ConnectionType } from "./connections.ts";
import { dars } from "./dars.ts";
import { readAuditList, readAuditPage } from "./dars-pages.ts";
import { createGuardPolicy, type RequestGuard } from "./network-guard.ts";
import { createProfile } from "./profile.ts";
import { openStore, THE_STUDENT } from "./store.ts";
import { attribute, elementsNamed, wordsIn } from "./tuportal-pages.ts";

/**
 * Checks the DARS reader against a real login, for someone who must not see the Student's records. It runs the
 * real reader through the real gate and prints page shape only. It never says what a page said or how much of
 * anything there was: on this site, which requirements are met is the record. So a page is "understood" or
 * "NOT understood", whatever was on it. What it prints is built from fixed words, addresses cleaned here, and
 * the words of WORDS_IT_MAY_SHOW. Nothing from a page is written anywhere: the database is in memory, and it
 * goes when this ends.
 */

/** The login works and the reader couldn't understand a page, which is what this check is for finding. */
const EXIT_PAGES_NOT_UNDERSTOOD = 6;

const MOST_LINKS = 80;
const MOST_HEADINGS = 40;

/** Words that say nothing about the Student, so a heading made of these can be printed. "Complete" and "missing" aren't, so that nothing can come out saying which. */
const WORDS_IT_MAY_SHOW = new Set(
  `academic audit audits catalog completed course courses created date degree delete format general home id idp in instcd list login loginroute manage new of
  profile program programs read request requests results run saml saml2 self selfservice service sso student type unsolicited view year your who`
    .split(/\s+/)
    .filter(Boolean),
);
/** Could be the name of a page, and the rules need those exactly: no digits, and nothing that looks like a code. */
const COULD_BE_A_PAGE_NAME = /^[a-z][a-z-]{0,30}(?:\.[a-z]{2,5})?$/;
const isOrdinary = (lower: string) => WORDS_IT_MAY_SHOW.has(lower.replace(/\.[a-z]{2,5}$/, ""));

/** Takes a raw address to its path. What follows a ? never comes out, because an audit's id is there, only what each value is called. */
function cleanPath(address: string, base: string | undefined, mayBeAPage: (lower: string) => boolean): string {
  const url = URL.parse(address, base);
  if (!url) return ":text";
  const part = (segment: string) => {
    const lower = segment.toLowerCase();
    return isOrdinary(lower) || mayBeAPage(lower) ? lower : ":text";
  };
  const names = [...new Set(url.searchParams.keys())].map((name) => `${part(name)}=:value`);
  return `/${url.pathname.split("/").filter(Boolean).map(part).join("/")}${names.length > 0 ? `?${names.join("&")}` : ""}`;
}

/** A host of Temple's says something, and any other could be named after anything. */
function hostToShow(address: string, base?: string): string {
  const host = URL.parse(address, base)?.hostname ?? "";
  return host === "temple.edu" || host.endsWith(".temple.edu") || host.endsWith(".duosecurity.com") ? host : "(a host off Temple's)";
}

/** Headings and labels, each word shown only if it's one of the ordinary ones. */
function headingsOf(html: string): string[] {
  const headings = elementsNamed(parse(html), "th", "dt", "label", "caption", "legend", "h1", "h2", "h3", "h4", "h5", "h6")
    .map((element) => wordsIn(element).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
    .filter((words) => words.length > 0)
    .map((words) => words.map((word) => (WORDS_IT_MAY_SHOW.has(word) ? word : ":word")).join(" "));
  return [...new Set(headings)].slice(0, MOST_HEADINGS);
}

function kindOfError(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : "";
  return /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
}

const wordsOn = (reading: PageReading | null) =>
  `${reading?.title ?? ""} ${reading?.text ?? ""}`
    .toLowerCase()
    .split(/[^\p{L}\p{N}._-]+/u)
    .filter(Boolean);

interface PageVisit {
  asked: string;
  reading: PageReading | null;
  failed: string | null;
}

interface Refusal {
  method: string;
  address: string;
  body: string | undefined;
}

/** What a refused request's fields are called, because that's what says whether it only reads. Never their values. */
function fieldNames(body: string | undefined): string {
  if (!body) return "";
  const names = [...new URLSearchParams(body).keys()].map((name) => (/^(?!(?:.*\d){3})[A-Za-z0-9._-]{1,64}$/.test(name) ? name : `:text(${name.length})`));
  return names.length > 0 ? ` fields: ${[...new Set(names)].join(", ")}` : " (a body)";
}

/**
 * What the check sees of the browser. It lets through reading and nothing else: the login in a real
 * container must survive this, so anything but a read fails here rather than reach it.
 */
function watchingBrowser(inner: BuddysBrowser, mayGoOn: () => boolean, visits: PageVisit[], refusals: Refusal[]): BuddysBrowser {
  const notInACheck = (): never => {
    throw new Error("The check only ever reads");
  };
  return {
    liveView: inner.liveView,
    show: async () => notInACheck(),
    submitForm: async () => notInACheck(),
    sendEmail: async () => notInACheck(),
    clearScreen: async () => notInACheck(),
    forgetLogin: async () => notInACheck(),

    async read(url, guard) {
      // The same answer to the reader for either, which stops it. The check says which it was afterwards.
      if (!mayGoOn()) throw new TakeoverInProgress();
      const watching: RequestGuard = {
        check(request) {
          const decision = guard.check(request);
          if (!decision.allowed) refusals.push({ method: /^[A-Z]{1,10}$/.test(request.method) ? request.method : "OTHER", address: request.url, body: request.body });
          return decision;
        },
      };
      const visit: PageVisit = { asked: url, reading: null, failed: null };
      visits.push(visit);
      try {
        visit.reading = await inner.read(url, watching);
        return visit.reading;
      } catch (error) {
        visit.failed = kindOfError(error);
        throw error;
      }
    },
  };
}

export interface DarsCheckDeps {
  browser: BuddysBrowser;
  /** The reader to check. It's only ever something else for made-up pages in the checks of the real browser. */
  connection?: ConnectionType;
  sites: Record<string, Site>;
  /** Asked before anything opens, and before each page, because the Student can revoke or start a Takeover at any time. */
  student: () => StudentState;
  print: (line: string) => void;
}

/** Returns the exit code. It never prints what an error says or what a page said. */
export async function runDarsCheck(deps: DarsCheckDeps): Promise<number> {
  try {
    return await runChecked(deps);
  } catch (error) {
    deps.print(`The check stopped unexpectedly (${kindOfError(error)}). Nothing was saved.`);
    return EXIT_FAILED;
  }
}

async function runChecked({ browser, connection = dars, sites, student, print }: DarsCheckDeps): Promise<number> {
  const { hasReadPermission, takeoverUnderWay, oldLoginRemains } = student();
  if (oldLoginRemains) {
    print("DARS's old login is still waiting to be deleted, so nothing was opened. Start the backend with Buddy's Browser running, wait a minute, then run this again.");
    return EXIT_OLD_LOGIN_REMAINS;
  }
  if (!hasReadPermission) {
    print("DARS has no Read Permission, so nothing was opened. On the phone: You tab, Connect DARS, Give Read Permission. Then run this again.");
    return EXIT_NO_READ_PERMISSION;
  }
  if (takeoverUnderWay) {
    print("The Student is in control of Buddy's Browser in a Takeover, so nothing was opened. Tap Done on the phone, then run this again.");
    return EXIT_TAKEOVER_UNDER_WAY;
  }

  const visits: PageVisit[] = [];
  const refusals: Refusal[] = [];
  let revokedMeanwhile = false;
  let takeoverMeanwhile = false;
  const mayGoOn = () => {
    const now = student();
    revokedMeanwhile ||= !now.hasReadPermission || now.oldLoginRemains;
    takeoverMeanwhile ||= now.takeoverUnderWay;
    return !revokedMeanwhile && !takeoverMeanwhile;
  };

  // In memory, so that there's no file for what's read to be left in. The Read Permission was the Student's tap, checked above.
  const store = openStore(":memory:");
  const clock = systemClock;
  let status: { needsLogin: boolean; lastReadProblem: string | null };
  try {
    const profile = createProfile({ store, clock, connectionName: () => connection.name });
    const guards = createGuardPolicy({ sites, publicHosts: [], hasReadPermission: (site) => store.readPermission(THE_STUDENT, site) !== null });
    const browserAccess = createBrowserAccess({ browser: watchingBrowser(browser, mayGoOn, visits, refusals), clock, store, sites, guards, onControlEnded: () => {}, logError: () => {} });
    const connections = createConnections({
      types: [connection],
      web: { get: () => Promise.reject(new Error("The check doesn't use the web")) },
      browserAccess,
      clock,
      store,
      profile,
      logError: () => {},
    });
    status = await connections.give(connection.id, undefined);
  } finally {
    store.close();
  }

  if (revokedMeanwhile) {
    print("The Read Permission for DARS was revoked during the check, so it stopped. Nothing was saved.");
    return EXIT_NO_READ_PERMISSION;
  }
  if (takeoverMeanwhile) {
    print("A Takeover started during the check, so it stopped. Nothing was saved.");
    return EXIT_TAKEOVER_UNDER_WAY;
  }

  const wordsOnPages = new Set(visits.flatMap((visit) => wordsOn(visit.reading)));
  /** For where Buddy really went or was refused, to correct the rules: not a word the Student's pages show, where their name would be. */
  const clean = (address: string, base?: string) => cleanPath(address, base, (lower) => COULD_BE_A_PAGE_NAME.test(lower) && !wordsOnPages.has(lower));
  /** A page's own links could say anything, so these show ordinary words alone. */
  const cleanLink = (address: string, base: string) => cleanPath(address, base, () => false);

  print("DARS check. This shows page shape only, never a requirement, a course, a date or a name, and nothing was saved.");
  print("Read Permission: given by the Student");
  print(`Login: ${status.needsLogin ? "not logged in. The Student needs to log in through a Takeover: You tab, Log in to DARS." : "works"}`);
  // Words from Buddy's own code, never from a page. See dars.ts.
  if (status.lastReadProblem) print(`Problem: ${status.lastReadProblem}`);

  print("");
  print("Pages:");
  const [listVisit, auditVisit] = visits;
  const describe = (name: string, visit: PageVisit | undefined, understand: (reading: PageReading) => unknown) => {
    if (!visit) {
      print(`  ${name}: not reached`);
      return false;
    }
    const landed = visit.reading ? clean(visit.reading.url) : null;
    const moved = landed && landed !== clean(visit.asked) ? ` (ended up at ${hostToShow(visit.reading!.url)} ${landed})` : "";
    const understood = visit.reading !== null && understand(visit.reading) !== null;
    print(`  ${name} ${clean(visit.asked)}: ${understood ? "understood" : "NOT understood"}${visit.failed ? ` (${visit.failed})` : moved}`);
    return understood;
  };
  const listUnderstood = describe("list of audits", listVisit, readAuditList);
  const auditUnderstood = auditVisit ? describe("audit", auditVisit, readAuditPage) : true;
  if (!auditVisit && listUnderstood) print("  audit: not opened. Either there's no audit of the Student's own on the list, or its link isn't one the rules know.");

  print("");
  print("Refused by the guard:");
  const refused = [...new Set(refusals.map(({ method, address, body }) => `  ${method} ${hostToShow(address)} ${clean(address)}${fieldNames(body)}`))];
  print(refused.length === 0 ? "  nothing" : refused.join("\n"));

  if (status.needsLogin) return EXIT_LOGIN_NEEDED;

  for (const [name, visit, understood] of [["list of audits", listVisit, listUnderstood], ["audit", auditVisit, auditUnderstood]] as const) {
    if (understood || !visit?.reading) continue;
    const { html, url, frames } = visit.reading;
    print("");
    print(`The ${name} page, which the reader couldn't understand:`);
    for (const frame of elementsNamed(parse(html), "iframe").flatMap((element) => attribute(element, "src") ?? [])) print(`  frame: ${hostToShow(frame, url)} ${clean(frame, url)}`);
    for (const heading of headingsOf(html)) print(`  heading: ${heading}`);
    const links = elementsNamed(parse(html), "a").flatMap((link) => attribute(link, "href") ?? []);
    for (const link of [...new Set(links.map((address) => `link: ${hostToShow(address, url)} ${cleanLink(address, url)}`))].slice(0, MOST_LINKS)) print(`  ${link}`);
    // How many rows there are could be how many requirements there are.
    for (const line of structureOf(html)) print(line.replace(/ ×\d+$/, " (repeated)"));
    for (const frame of frames ?? []) {
      print("");
      print(`Inside it, the frame ${hostToShow(frame.url)} ${clean(frame.url)}:`);
      for (const heading of headingsOf(frame.html)) print(`  heading: ${heading}`);
      for (const line of structureOf(frame.html)) print(line.replace(/ ×\d+$/, " (repeated)"));
    }
  }
  return listUnderstood && auditUnderstood && listVisit ? EXIT_OK : EXIT_PAGES_NOT_UNDERSTOOD;
}
