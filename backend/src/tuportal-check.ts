import { parse } from "parse5";
import { createBrowserAccess, TakeoverInProgress, type Site } from "./browser-access.ts";
import type { BuddysBrowser, PageReading } from "./buddys-browser.ts";
import { EXIT_FAILED, EXIT_LOGIN_NEEDED, EXIT_NO_READ_PERMISSION, EXIT_OK, EXIT_OLD_LOGIN_REMAINS, EXIT_TAKEOVER_UNDER_WAY, structureOf, type StudentState } from "./canvas-check.ts";
import { systemClock } from "./clock.ts";
import { createConnections, type ConnectionType } from "./connections.ts";
import { createGuardPolicy, isOnSite, type RequestGuard } from "./network-guard.ts";
import { createProfile } from "./profile.ts";
import { openStore, THE_STUDENT } from "./store.ts";
import { attribute, elementsNamed, wordsIn } from "./tuportal-pages.ts";
import { TUPORTAL_PAGES, type TuportalPage } from "./tuportal-rules.ts";
import { tuportal, TUPORTAL_SECTIONS } from "./tuportal.ts";

/**
 * Checks the TUportal reader against a real login, for someone who must not see the Student's records.
 * It runs the real reader through the real gate and prints page shape only. It never says what a page
 * said, and it never says how much of anything there was: on this site, whether there's a hold is the
 * record. So a page is "understood" or "NOT understood", whatever was on it. What it prints is built from
 * fixed words, addresses cleaned here, and the words of WORDS_IT_MAY_SHOW. Nothing from a page is written
 * anywhere: the database is in memory, and it goes when this ends.
 */

/** The login works and the reader couldn't understand a page, which is what this check is for finding. */
const EXIT_PAGES_NOT_UNDERSTOOD = 6;

/** More than a portal page has. Each link can only say so much, and this keeps a broken page short. */
const MOST_LINKS = 80;
const MOST_HEADINGS = 40;

/**
 * Words that say nothing about the Student, so an address or heading made only of these can be printed.
 * "No" isn't one, so that a heading can never come out saying there are no holds.
 */
const WORDS_IT_MAY_SHOW = new Set(
  `account accounts academic academics add advising affected affects aid amount and apps auth authorize balance banner billing bursar
  c center channel charge charges community cost costs credit current date dates due enrollment financial for from group guest holds hold
  home id idp in information login my of oauth on originator payment payments pending portal process processes profile reason record records
  prod prod8 redirect registration request saml saml2 self service services sso ssb ssb9 statement status student students summary term terms ticket
  time to tools total tuition tupay type view web your`
    .split(/\s+/)
    .filter(Boolean),
);
/** Fine in an address, where they name a page. On a holds page, as a heading, they could name the Student's hold. */
const NOT_IN_HEADINGS = new Set(["hold", "bursar", "financial", "advising"]);
/** A page of Banner's own is named for what it does, the same for everyone, such as bwskoacc.P_ViewAcct. */
const BANNER_PAGE = /^(?:bw[a-z]{2,8}|twb[a-z]{2,8})\.p_[a-z_]{1,40}$/;

const ordinaryWords = (phrase: string, separator: RegExp) => phrase.split(separator).every((word) => word === "" || WORDS_IT_MAY_SHOW.has(word));

/** Takes a raw address to its path, with anything that could be someone's words replaced. What follows a ? never comes out. */
function cleanPath(address: string, base?: string): string {
  const url = URL.parse(address, base);
  if (!url) return ":text";
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const lower = segment.toLowerCase();
      return ordinaryWords(lower, /[-_]/) || BANNER_PAGE.test(lower) ? lower : ":text";
    });
  return `/${segments.join("/")}`;
}

/** A host of Temple's or the site's says something, and any other could be named after anything. */
function hostToShow(address: string, base: string | undefined, sites: Record<string, Site>): string {
  const host = URL.parse(address, base)?.hostname ?? "";
  return host.endsWith(".temple.edu") || Object.values(sites).some((site) => isOnSite(host, site)) ? host : "(a host off the portal)";
}

/** Headings and labels, each word shown only if it's one of the ordinary ones. They're what the reader goes by, and the values never are headings. */
function headingsOf(html: string): string[] {
  const headings = elementsNamed(parse(html), "th", "dt", "label", "caption", "legend", "h1", "h2", "h3", "h4", "h5", "h6")
    .map((element) => wordsIn(element).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
    .filter((words) => words.length > 0)
    .map((words) => words.map((word) => (WORDS_IT_MAY_SHOW.has(word) && !NOT_IN_HEADINGS.has(word) ? word : ":word")).join(" "));
  return [...new Set(headings)].slice(0, MOST_HEADINGS);
}

function addressesIn(html: string, tag: string, name: string): string[] {
  return elementsNamed(parse(html), tag).flatMap((element) => attribute(element, name) ?? []);
}

/** Where the page's frames come from, because the portal may keep what matters in one. */
function frameLines(html: string, pageAddress: string, sites: Record<string, Site>): string[] {
  const lines = addressesIn(html, "iframe", "src").map((source) => `frame: ${hostToShow(source, pageAddress, sites)} ${cleanPath(source, pageAddress)}`);
  return [...new Set(lines)];
}

/** The links on the portal's own pages, so that addresses guessed in tuportal-rules.ts can be put right. */
function linkLines(html: string, pageAddress: string, sites: Record<string, Site>): string[] {
  const onPortal = (address: string) => {
    const url = URL.parse(address, pageAddress);
    return url !== null && Object.values(sites).some((site) => isOnSite(url.hostname, site));
  };
  const lines = addressesIn(html, "a", "href")
    .filter(onPortal)
    .map((address) => `link: ${cleanPath(address, pageAddress)}`);
  return [...new Set(lines)].slice(0, MOST_LINKS);
}

interface PageVisit {
  /** Which page the reader asked for. */
  page: TuportalPage | null;
  asked: string;
  /** Null if it didn't get there. */
  reading: PageReading | null;
  /** The kind of error, never its words, which often quote the address. */
  failed: string | null;
}

interface Refusal {
  method: string;
  host: string;
  path: string;
}

/** A class's name is from the code, where its message could say anything. */
function kindOfError(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : "";
  return /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
}

function pageAsked(url: string): TuportalPage | null {
  const asked = URL.parse(url);
  if (!asked) return null;
  const found = (Object.keys(TUPORTAL_PAGES) as TuportalPage[]).find((page) => new URL(TUPORTAL_PAGES[page], asked.origin).href === asked.href);
  return found ?? null;
}

/**
 * What the check sees of the browser. It lets through reading and nothing else: the login in a real
 * container must survive this, so anything but a read fails here rather than reach it.
 */
function watchingBrowser(inner: BuddysBrowser, mayGoOn: () => boolean, visits: PageVisit[], refusals: Refusal[], sites: Record<string, Site>): BuddysBrowser {
  const notInACheck = (): never => {
    throw new Error("The check only ever reads");
  };
  return {
    liveView: inner.liveView,
    show: async () => notInACheck(),
    submitForm: async () => notInACheck(),
    clearScreen: async () => notInACheck(),
    forgetLogin: async () => notInACheck(),

    async read(url, guard) {
      // The same answer to the reader for either, which stops it. The check says which it was afterwards.
      if (!mayGoOn()) throw new TakeoverInProgress();
      const watching: RequestGuard = {
        check(request) {
          const decision = guard.check(request);
          if (!decision.allowed) {
            refusals.push({
              method: /^[A-Z]{1,10}$/.test(request.method) ? request.method : "OTHER",
              host: hostToShow(request.url, undefined, sites),
              path: cleanPath(request.url),
            });
          }
          return decision;
        },
      };
      const visit: PageVisit = { page: pageAsked(url), asked: cleanPath(url), reading: null, failed: null };
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

/** How a visit went, if it didn't simply land where it was sent, in words that aren't the Student's. */
function visitNote(visit: PageVisit, sites: Record<string, Site>): string {
  if (visit.failed) return ` (${visit.failed})`;
  const landed = visit.reading && cleanPath(visit.reading.url);
  return !landed || landed === visit.asked ? "" : ` (ended up at ${hostToShow(visit.reading!.url, undefined, sites)} ${landed})`;
}

export interface TuportalCheckDeps {
  browser: BuddysBrowser;
  /** The reader to check. It's only ever something else for made-up pages in the checks of the real browser. */
  connection?: ConnectionType;
  sites: Record<string, Site>;
  /** Asked before anything opens, and before each page, because the Student can revoke or start a Takeover at any time. */
  student: () => StudentState;
  print: (line: string) => void;
}

/** Returns the exit code. It never prints what an error says or what a page said. */
export async function runTuportalCheck(deps: TuportalCheckDeps): Promise<number> {
  try {
    return await runChecked(deps);
  } catch (error) {
    deps.print(`The check stopped unexpectedly (${kindOfError(error)}). Nothing was saved.`);
    return EXIT_FAILED;
  }
}

async function runChecked({ browser, connection = tuportal, sites, student, print }: TuportalCheckDeps): Promise<number> {
  const { hasReadPermission, takeoverUnderWay, oldLoginRemains } = student();
  if (oldLoginRemains) {
    print("TUportal's old login is still waiting to be deleted, so nothing was opened. Start the backend with Buddy's Browser running, wait a minute, then run this again.");
    return EXIT_OLD_LOGIN_REMAINS;
  }
  if (!hasReadPermission) {
    print("TUportal has no Read Permission, so nothing was opened. On the phone: You tab, Connect TUportal, Give Read Permission. Then run this again.");
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
    const browserAccess = createBrowserAccess({
      browser: watchingBrowser(browser, mayGoOn, visits, refusals, sites),
      clock,
      store,
      sites,
      guards,
      onControlEnded: () => {},
      logError: () => {},
    });
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
    print("The Read Permission for TUportal was revoked during the check, so it stopped. Nothing was saved.");
    return EXIT_NO_READ_PERMISSION;
  }
  if (takeoverMeanwhile) {
    print("A Takeover started during the check, so it stopped. Nothing was saved.");
    return EXIT_TAKEOVER_UNDER_WAY;
  }

  print("TUportal check. This shows page shape only, never a hold, a balance or a name, and nothing was saved.");
  print("Read Permission: given by the Student");
  print(`Login: ${status.needsLogin ? "not logged in. The Student needs to log in through a Takeover: You tab, Log in to TUportal." : "works"}`);
  // Words from Buddy's own code, never from a page. See tuportal.ts.
  if (status.lastReadProblem) print(`Problem: ${status.lastReadProblem}`);

  print("");
  print("Pages:");
  const home = visits.find((visit) => visit.page === "home");
  if (home) print(`  home ${home.asked}${visitNote(home, sites)}`);
  const notUnderstood: { visit: PageVisit; name: string }[] = [];
  for (const { page: name, understand } of TUPORTAL_SECTIONS) {
    const visit = visits.find((candidate) => candidate.page === name);
    if (!visit) {
      print(`  ${name}: not reached`);
      continue;
    }
    const note = visitNote(visit, sites);
    const understood = note === "" && visit.reading !== null && understand(visit.reading) !== null;
    print(`  ${name} ${visit.asked}: ${understood ? "understood" : "NOT understood"}${note}`);
    if (!understood) notUnderstood.push({ visit, name });
  }

  print("");
  print("Refused by the guard:");
  const refused = [...new Set(refusals.map((refusal) => `  ${refusal.method} ${refusal.host} ${refusal.path}`))];
  print(refused.length === 0 ? "  nothing" : refused.join("\n"));

  if (status.needsLogin) return EXIT_LOGIN_NEEDED;

  if (home?.reading) {
    const links = linkLines(home.reading.html, home.reading.url, sites);
    if (links.length > 0) {
      print("");
      print("Links on the portal's home page, to correct the addresses in tuportal-rules.ts:");
      for (const line of links) print(`  ${line}`);
    }
  }

  for (const { visit, name } of notUnderstood) {
    if (!visit.reading) continue;
    print("");
    print(`The ${name} page, which the reader couldn't understand:`);
    for (const line of [...frameLines(visit.reading.html, visit.reading.url, sites), ...headingsOf(visit.reading.html).map((heading) => `heading: ${heading}`)]) print(`  ${line}`);
    // How many rows there are could be how many holds there are.
    for (const line of structureOf(visit.reading.html)) print(line.replace(/ ×\d+$/, " (repeated)"));
  }
  return notUnderstood.length > 0 ? EXIT_PAGES_NOT_UNDERSTOOD : EXIT_OK;
}
