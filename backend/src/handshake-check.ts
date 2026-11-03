import { createBrowserAccess, type Site } from "./browser-access.ts";
import type { BuddysBrowser } from "./buddys-browser.ts";
import {
  EXIT_FAILED,
  EXIT_LOGIN_NEEDED,
  EXIT_NO_READ_PERMISSION,
  EXIT_OK,
  EXIT_OLD_LOGIN_REMAINS,
  EXIT_TAKEOVER_UNDER_WAY,
  kindOfError,
  normalized,
  structureOf,
  type StudentState,
} from "./canvas-check.ts";
import { systemClock } from "./clock.ts";
import { createConnections, type ConnectionType } from "./connections.ts";
import { linksOn, readListPage } from "./handshake-pages.ts";
import { HANDSHAKE_LISTS, LISTING_PAGE, type ListingKind } from "./handshake-rules.ts";
import { cleanAddress, cleanHost, countedLines, EXIT_READ_PROBLEM, shapeOfAccessibility, watchingBrowser, type RequestSeen, type Visit } from "./navigate360-check.ts";
import { createGuardPolicy } from "./network-guard.ts";
import { readOfficePage } from "./office-page.ts";
import type { OpportunityPagesFromConnection } from "./opportunities-from-connection.ts";
import { createProfile } from "./profile.ts";
import { openStore, THE_STUDENT } from "./store.ts";

/**
 * Checks the Handshake reader against a real login, for someone who must not see the Student's records. It
 * runs the real reader through the real gate and prints only counts, cleaned addresses and shapes. Everything
 * it prints goes through the few functions below, which build each line from fixed words and cleaned names
 * rather than cleaning up what a page said. Nothing is written anywhere, because the database is in memory,
 * and nothing goes to Claude, so it can't say whether Goals match or dates can be read from a listing's words.
 *
 * Nobody has seen real Handshake, so this is built to show what to correct in handshake-rules.ts and
 * handshake-pages.ts: where pages really land, what they ask for, what the guard refused, what links the
 * lists really have, and how each kind of page is really laid out.
 */

/** Listings to open of each kind. It's looking at their shape, so a few say as much as all of them. */
const SAMPLE_OF_EACH = 2;

/** Words in Handshake's addresses that are fine to print, even though a page may also show them. ASSUMED, as they're all from memory. */
const ADDRESS_WORDS = new Set(
  `stu jobs job-search postings events career_fairs career-fairs employers login sessions new auth saml hs graphql explore assets packs api applications
  messages inbox users profiles feed saved_jobs documents`
    .split(/\s+/)
    .filter(Boolean),
);

const kindOfListing = (url: string): ListingKind => (LISTING_PAGE.event.test(URL.parse(url)?.pathname ?? "") ? "event" : "job");
const isAList = (visit: Visit) => (Object.values(HANDSHAKE_LISTS) as string[]).includes(visit.asked);

export interface HandshakeCheckDeps {
  browser: BuddysBrowser;
  connection: ConnectionType;
  sites: Record<string, Site>;
  /** Asked before anything opens, and before each page, because the Student can revoke or start a Takeover at any time. */
  student: () => StudentState;
  print: (line: string) => void;
}

/** Returns the exit code. It never prints what an error says or what a page said. */
export async function runHandshakeCheck(deps: HandshakeCheckDeps): Promise<number> {
  try {
    return await runChecked(deps);
  } catch (error) {
    deps.print(`The check stopped unexpectedly (${kindOfError(error)}). Nothing was saved.`);
    return EXIT_FAILED;
  }
}

async function runChecked({ browser, connection, sites, student, print }: HandshakeCheckDeps): Promise<number> {
  const { hasReadPermission, takeoverUnderWay, oldLoginRemains } = student();
  if (oldLoginRemains) {
    print(`${connection.name}'s old login is still waiting to be deleted, so nothing was opened. Start the backend with Buddy's Browser running, wait a minute, then run this again.`);
    return EXIT_OLD_LOGIN_REMAINS;
  }
  if (!hasReadPermission) {
    print(`${connection.name} has no Read Permission, so nothing was opened. On the phone: You tab, Connect ${connection.name}, Give Read Permission. Then run this again.`);
    return EXIT_NO_READ_PERMISSION;
  }
  if (takeoverUnderWay) {
    print("The Student is in control of Buddy's Browser in a Takeover, so nothing was opened. Tap Done on the phone, then run this again.");
    return EXIT_TAKEOVER_UNDER_WAY;
  }

  const visits: Visit[] = [];
  const requests: RequestSeen[] = [];
  let revokedMeanwhile = false;
  const mayGoOn = () => {
    const now = student();
    revokedMeanwhile = !now.hasReadPermission || now.oldLoginRemains;
    return !revokedMeanwhile && !now.takeoverUnderWay;
  };
  const watched = watchingBrowser(browser, mayGoOn, visits, requests);

  const opened: Record<ListingKind, number> = { job: 0, event: 0 };
  let readAsListing = 0;
  /** Stands in for the Opportunities: it has every reason to open a page, keeps none, and asks no model. */
  const onlyCounting: OpportunityPagesFromConnection = {
    wanted: () => true,
    confirmIfRecent(url) {
      const kind = kindOfListing(url);
      if (opened[kind] >= SAMPLE_OF_EACH) return true;
      opened[kind]++;
      return false;
    },
    takeIn: async () => {
      readAsListing++;
    },
  };

  // In memory, so that there's no file for what's read to be left in. The Read Permission was the Student's tap, checked above.
  const store = openStore(":memory:");
  const clock = systemClock;
  let status: { needsLogin: boolean; lastReadProblem: string | null };
  try {
    const profile = createProfile({ store, clock, connectionName: () => connection.name });
    const guards = createGuardPolicy({
      sites,
      publicHosts: [],
      hasReadPermission: (site) => store.readPermission(THE_STUDENT, site) !== null,
    });
    const browserAccess = createBrowserAccess({ browser: watched, clock, store, sites, guards, onControlEnded: () => {}, logError: () => {} });
    const connections = createConnections({
      types: [connection],
      web: { get: () => Promise.reject(new Error("The check doesn't use the web")) },
      browserAccess,
      clock,
      store,
      profile,
      opportunityPagesFor: () => onlyCounting,
      logError: () => {},
    });
    status = await connections.give(connection.id, undefined);
  } finally {
    store.close();
  }

  if (revokedMeanwhile) {
    print(`The Read Permission for ${connection.name} was revoked during the check, so it stopped. Nothing was saved.`);
    return EXIT_NO_READ_PERMISSION;
  }

  const wordsSeen = normalized(
    visits.flatMap(({ page }) => (page ? [page.title, page.text, page.accessibilitySnapshot, readOfficePage(page.html || "<body></body>").text] : [])).join(" "),
  );
  const clean = (address: string) => cleanAddress(address, wordsSeen, ADDRESS_WORDS);
  const listedBy = (kind: ListingKind) => {
    const visit = visits.find(({ asked }) => asked === HANDSHAKE_LISTS[kind]);
    return visit?.page ? (readListPage(visit.page.html, visit.page.url, kind)?.length ?? "couldn't tell") : "couldn't tell";
  };

  print(`${connection.name} check. This shows counts and page shape only: nothing was saved, and nothing went to Claude.`);
  print("Read Permission: given by the Student");
  print(`Login: ${status.needsLogin ? `not logged in. The Student needs to log in through a Takeover: You tab, Log in to ${connection.name}.` : "works"}`);
  // Words from Buddy's own code, never from a page. See handshake.ts.
  if (status.lastReadProblem) print(`Problem: ${status.lastReadProblem}`);
  print("");
  print("Found:");
  print(`  jobs listed: ${listedBy("job")}`);
  print(`  events listed: ${listedBy("event")}`);
  print(`  listings opened as a sample: ${opened.job + opened.event}`);
  print(`  of those, read as a listing: ${readAsListing}`);
  print("");
  print("Pages opened:");
  const describeVisit = (visit: Visit) => {
    const asked = clean(visit.asked);
    if (!visit.page) return `${asked}  (${visit.failed})`;
    if (visit.page.url === visit.asked) return asked;
    return `${asked}  (ended up at ${cleanHost(visit.page.url, sites, wordsSeen)} ${clean(visit.page.url)})`;
  };
  for (const line of countedLines(visits.map(describeVisit))) print(line);
  print("");
  const describeRequest = (request: RequestSeen) => `${request.method} ${cleanHost(request.url, sites, wordsSeen)} ${clean(request.url)}`;
  print("What those pages asked for:");
  const allowed = countedLines(requests.filter(({ refused }) => !refused).map(describeRequest));
  if (allowed.length === 0) print("  nothing");
  for (const line of allowed) print(line);
  print("");
  print("Refused by the guard:");
  const refused = countedLines(requests.filter((request) => request.refused).map(describeRequest));
  if (refused.length === 0) print("  nothing");
  for (const line of refused) print(line);

  if (status.needsLogin) return EXIT_LOGIN_NEEDED;

  print("");
  print("Links on the lists, by shape. A listing's own page has to be among these:");
  const describeLink = (href: string, pageAddress: string) => {
    const url = URL.parse(href, pageAddress);
    return url && /^https?:$/.test(url.protocol) ? [`${cleanHost(url.href, sites, wordsSeen)} ${clean(url.href)}`] : [];
  };
  const links = countedLines(visits.filter(isAList).flatMap(({ page }) => (page ? linksOn(page.html).flatMap((href) => describeLink(href, page.url)) : [])));
  if (links.length === 0) print("  none");
  for (const line of links) print(line);

  // Both lists and one of each kind of listing, because nobody has seen any of them.
  const printShape = (label: string, visit: Visit) => {
    if (!visit.page) return;
    print("");
    print(`Shape of a ${label}: ${clean(visit.page.url)}`);
    print("Its accessibility tree, by role:");
    for (const line of shapeOfAccessibility(visit.page.accessibilitySnapshot)) print(`  ${line}`);
    print("Its HTML, by tag and class:");
    for (const line of structureOf(visit.page.html || "<body></body>")) print(`  ${line}`);
  };
  for (const visit of visits.filter(isAList)) printShape("list", visit);
  for (const kind of ["job", "event"] as const) {
    const first = visits.find((visit) => !isAList(visit) && kindOfListing(visit.asked) === kind);
    if (first) printShape("listing", first);
  }

  return status.lastReadProblem ? EXIT_READ_PROBLEM : EXIT_OK;
}
