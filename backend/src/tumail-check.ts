import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { createBrowserAccess, TakeoverInProgress } from "./browser-access.ts";
import type { BuddysBrowser } from "./buddys-browser.ts";
import { EXIT_FAILED, EXIT_LOGIN_NEEDED, EXIT_NO_READ_PERMISSION, EXIT_OK, EXIT_OLD_LOGIN_REMAINS, EXIT_TAKEOVER_UNDER_WAY, type CanvasCheckDeps } from "./canvas-check.ts";
import { systemClock } from "./clock.ts";
import { createConnections } from "./connections.ts";
import { createGuardPolicy, type RequestGuard, type RequestToCheck } from "./network-guard.ts";
import { createProfile } from "./profile.ts";
import { openStore, THE_STUDENT } from "./store.ts";
import { readInboxPage, readMessagePage, type MessageOnPage, type RowOnPage } from "./tumail-pages.ts";
import { INBOX_IS_READY, isTempleAddress, senderAddressIn, TUMAIL_APP_HOSTS } from "./tumail-rules.ts";

/**
 * Checks the TUmail reader against a real login, for someone who must not see the Student's mail. It
 * runs the real reader through the real gate and prints only counts, cleaned addresses and the shape
 * of a page. Every line is built from fixed words and from names checked against fixed lists, rather
 * than by cleaning up what a page said, because an email can say anything. Nothing from a page is
 * written anywhere: the database is in memory, and it goes when this ends.
 *
 * Its database is empty, so there are no Contacts here and only temple.edu addresses get opened.
 */

export const EXIT_MARKED_READ = 6;

const MOST_SHAPE_LINES = 400;
const SHORTEST_NAME_TO_COMPARE = 5;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The words in Outlook's addresses. Anything else could be someone's words, such as a name in a path. */
const ADDRESS_WORDS = new Set(
  `api auth authorize calendar common compose deeplink drafts graphql id inbox junkemail mail notificationhub oauth2 options owa people
  saml saml2 sentitems service.svc startupdata.ashx sso sw.js v1.0 v2.0`
    .split(/\s+/)
    .filter(Boolean),
);
const SAFE_EXTENSIONS = /\.(js|css|map|png|svg|gif|jpg|woff2?|ttf|json)$/;

/** Companies Outlook is known to use, by the end of their host names. An email's own pictures can come from anywhere else. */
const KNOWN_HOSTS = [
  "office.com",
  "office.net",
  "office365.com",
  "cloud.microsoft",
  "microsoft.com",
  "microsoftonline.com",
  "msauth.net",
  "msftauth.net",
  "live.com",
  "skype.com",
  "sharepoint.com",
  "fim.temple.edu",
  "duosecurity.com",
];

const ARIA_ROLES = new Set(
  `alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog
  directory document feed figure form grid gridcell group heading img link list listbox listitem log main marquee math menu menubar
  menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup
  rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar
  tooltip tree treegrid treeitem`
    .split(/\s+/)
    .filter(Boolean),
);
/** Words of the app's own, shown as they are. Any other label is someone's words, or could be. */
const KNOWN_LABELS = new Set(["message list", "reading pane", "message body", "navigation pane", "folder pane", "inbox"]);
const KNOWN_IDS = new Set(["ReadingPaneContainerId", "MainModule", "app", "appRoot"]);
const KNOWN_TEST_IDS = new Set(["SentReceivedSavedTime"]);
const NOT_SHAPE = new Set(["script", "style", "template", "noscript", "head"]);
const NOT_LOOKED_INSIDE_TAGS = new Set(["svg", "iframe", "object", "embed", "video", "audio", "select", "textarea"]);

function cleanSegment(segment: string): string {
  const lower = segment.toLowerCase();
  if (ADDRESS_WORDS.has(lower)) return lower;
  if (/^\d+$/.test(segment)) return ":id";
  const extension = SAFE_EXTENSIONS.exec(lower)?.[0] ?? "";
  return `${/\d|%|=/.test(segment) ? ":id" : ":text"}${extension}`;
}

/** Where a request went, as far as it's safe to say: Outlook's own, and Microsoft's by host alone. */
export function cleanTumailRequest(address: string, appHosts: string[]): string {
  const url = URL.parse(address);
  if (!url) return "(another host)";
  const host = url.hostname;
  if (appHosts.includes(host)) {
    const segments = url.pathname.split("/").filter(Boolean).map(cleanSegment);
    const action = url.searchParams.get("action");
    const named = action && /^[A-Za-z]{1,40}$/.test(action) ? `?action=${action}` : "";
    return `${host} /${segments.join("/")}${named}`;
  }
  return KNOWN_HOSTS.some((known) => host === known || host.endsWith(`.${known}`)) ? host : "(another host)";
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Everything on a page that's words rather than structure. */
function wordsOfPage(page: Html.Document): string {
  const words: string[] = [];
  const visit = (node: Html.ChildNode | Html.Document): void => {
    if (node.nodeName === "#text") words.push((node as Html.TextNode).value);
    if ("attrs" in node) for (const { name, value } of node.attrs) if (name !== "class" && name !== "style") words.push(value);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(page);
  return normalized(words.join(" "));
}

const attributeOf = (element: Html.Element, name: string) => element.attrs.find((attr) => attr.name === name)?.value;

function labelKind(label: string): string {
  const lower = label.trim().toLowerCase();
  if (KNOWN_LABELS.has(lower)) return lower;
  if (/^unread\b/.test(lower)) return ":starts-with-unread";
  if (/^from\b/.test(lower)) return ":starts-with-from";
  return ":text";
}

function titleKind(title: string): string {
  if (senderAddressIn(title)) return ":address";
  if (/\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(title)) return ":date";
  return ":text";
}

/** The app's own names for its data attributes, leaving out any with a number or that repeat a word on the page. */
function dataNamesOf(element: Html.Element, pageWords: string): string[] {
  return element.attrs
    .map((attr) => attr.name)
    .filter((name) => name !== "data-testid" && /^data-[a-z-]{1,40}$/.test(name))
    .filter((name) => {
      const word = normalized(name.slice("data-".length));
      return word.length < SHORTEST_NAME_TO_COMPARE || !pageWords.includes(word);
    });
}

function describeElement(element: Html.Element, pageWords: string, withDataNames: boolean): string {
  const tag = /^[a-z][a-z0-9-]*$/.test(element.tagName) ? element.tagName : "element";
  const id = attributeOf(element, "id");
  const role = attributeOf(element, "role");
  const label = attributeOf(element, "aria-label");
  const title = attributeOf(element, "title");
  const testId = attributeOf(element, "data-testid");
  const dataNames = withDataNames ? dataNamesOf(element, pageWords) : [];
  return [
    `${tag}${id && KNOWN_IDS.has(id) ? `#${id}` : ""}`,
    role === undefined ? "" : `role=${ARIA_ROLES.has(role) ? role : ":other"}`,
    label === undefined ? "" : `aria-label=${labelKind(label)}`,
    title === undefined ? "" : `title=${titleKind(title)}`,
    testId === undefined ? "" : `data-testid=${KNOWN_TEST_IDS.has(testId) ? testId : ":other"}`,
    dataNames.length > 0 ? `[${dataNames.join(" ")}]` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** What's in these is someone's writing, or another document, so nothing inside them is looked at. */
function isNotLookedInside(element: Html.Element): boolean {
  const label = attributeOf(element, "aria-label")?.trim().toLowerCase();
  const classes = (attributeOf(element, "class") ?? "").split(/\s+/);
  return (
    NOT_LOOKED_INSIDE_TAGS.has(element.tagName) ||
    label === "message body" ||
    attributeOf(element, "role") === "document" ||
    classes.some((name) => /^(?:x_|rps_)/.test(name))
  );
}

/** A plain box says only how deep the app nests things, and would bury what matters in hundreds of lines. */
function isPlain(element: Html.Element, description: string): boolean {
  return (element.tagName === "div" || element.tagName === "span") && description === element.tagName;
}

function shapeLines(element: Html.Element, pageWords: string, depth: number, isTop = false): string[] {
  const indent = "  ".repeat(depth);
  if (isNotLookedInside(element)) return [`${indent}${describeElement(element, pageWords, false)} (not looked inside)`];
  const description = describeElement(element, pageWords, true);
  const line = `${indent}${description}`;

  const plain = !isTop && isPlain(element, description);
  const children = element.childNodes
    .filter((child): child is Html.Element => "tagName" in child && !NOT_SHAPE.has(child.tagName))
    .map((child) => shapeLines(child, pageWords, plain ? depth : depth + 1))
    .filter((lines) => lines.length > 0);
  const lines = plain ? [] : [line];
  let index = 0;
  while (index < children.length) {
    const child = children[index]!;
    let repeats = 1;
    while (children[index + repeats]?.join("\n") === child.join("\n")) repeats++;
    lines.push(repeats > 1 ? `${child[0]} ×${repeats}` : child[0]!, ...child.slice(1));
    index += repeats;
  }
  return lines;
}

/** A page's roles, kinds of label and data attribute names, with nothing a page's words could be in. No classes: Outlook's mean nothing, and an email's could. */
export function shapeOf(html: string): string[] {
  const page = parse(html);
  const pageWords = wordsOfPage(page);
  const find = (node: Html.Document | Html.ChildNode): Html.Element | null => {
    if (!("childNodes" in node)) return null;
    for (const child of node.childNodes) {
      if ("tagName" in child && child.tagName === "body") return child;
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const body = find(page);
  if (!body) return ["(no body)"];
  const lines = shapeLines(body, pageWords, 0, true);
  return lines.length > MOST_SHAPE_LINES ? [...lines.slice(0, MOST_SHAPE_LINES), `(and ${lines.length - MOST_SHAPE_LINES} more lines)`] : lines;
}

interface PageVisit {
  /** Neither of these is ever printed as it is. */
  rawAsked: string;
  rawLanded: string | null;
  html: string | null;
  /** The kind of error, never its words, which often quote the address. */
  failed: string | null;
}

/** A class's name is from the code, where its message could say anything. */
function kindOfError(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : "";
  return /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
}

function methodName(method: string): string {
  return /^[A-Z]{1,10}$/.test(method) ? method : "OTHER";
}

/**
 * What the check sees of the browser. It lets through reading and nothing else: the login in a real
 * container must survive this, so anything but a read fails here rather than reach it.
 */
function watchingBrowser(inner: BuddysBrowser, mayGoOn: () => boolean, visits: PageVisit[], decided: (request: RequestToCheck, allowed: boolean) => void): BuddysBrowser {
  const notInACheck = (): never => {
    throw new Error("The check only ever reads");
  };
  return {
    liveView: inner.liveView,
    show: async () => notInACheck(),
    submitForm: async () => notInACheck(),
    clearScreen: async () => notInACheck(),
    forgetLogin: async () => notInACheck(),

    async read(url, guard, wait) {
      // The same answer to the reader for either, which stops it. The check says which it was afterwards.
      if (!mayGoOn()) throw new TakeoverInProgress();
      const watching: RequestGuard = {
        check(request) {
          const decision = guard.check(request);
          decided(request, decision.allowed);
          return decision;
        },
      };
      try {
        const page = await inner.read(url, watching, wait);
        visits.push({ rawAsked: url, rawLanded: page.url, html: page.html, failed: null });
        return page;
      } catch (error) {
        visits.push({ rawAsked: url, rawLanded: null, html: null, failed: kindOfError(error) });
        throw error;
      }
    },
  };
}

function countedLines(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts].map(([text, count]) => (count > 1 ? `  ${text}  ×${count}` : `  ${text}`));
}

const isMessagePage = (address: string) => /\/inbox\/id\/[^/]+\/?$/.test(URL.parse(address)?.pathname ?? "");
const idInAddress = (address: string) => decodeURIComponent(/\/inbox\/id\/([^/]+)\/?$/.exec(URL.parse(address)?.pathname ?? "")?.[1] ?? "");

function unreadAmong(rows: RowOnPage[], ids: Set<string>): number {
  return rows.filter((row) => ids.has(row.id) && row.unread === true).length;
}

const WHY_NOT_RECOGNIZED = "the reader couldn't recognize this page";
const WHY_NO_SENDERS = "the reader couldn't see who these are from";

/** Returns the exit code. It never prints what an error says or what a page said. */
export async function runTumailCheck(deps: CanvasCheckDeps): Promise<number> {
  try {
    return await runChecked(deps);
  } catch (error) {
    deps.print(`The check stopped unexpectedly (${kindOfError(error)}). Nothing was saved.`);
    return EXIT_FAILED;
  }
}

async function runChecked({ browser, connection, sites, student, print }: CanvasCheckDeps): Promise<number> {
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

  const visits: PageVisit[] = [];
  const appHosts = [...TUMAIL_APP_HOSTS, ...Object.values(sites).map((site) => new URL(site.homeUrl).hostname)];
  const refused: string[] = [];
  const letThrough: string[] = [];
  const decided = (request: RequestToCheck, allowed: boolean) => {
    const line = `${methodName(request.method)} ${cleanTumailRequest(request.url, appHosts)}`;
    if (!allowed) refused.push(line);
    else if (!READ_METHODS.has(request.method)) letThrough.push(line);
  };
  let revokedMeanwhile = false;
  const mayGoOn = () => {
    const now = student();
    revokedMeanwhile = !now.hasReadPermission || now.oldLoginRemains;
    return !revokedMeanwhile && !now.takeoverUnderWay;
  };
  const watched = watchingBrowser(browser, mayGoOn, visits, decided);

  // In memory, so that there's no file for what's read to be left in. The Read Permission was the Student's tap, checked above.
  const store = openStore(":memory:");
  const clock = systemClock;
  let wordsKept: { read: number; withSubject: number };
  let status: { needsLogin: boolean; lastReadProblem: string | null };
  let inboxAfter: RowOnPage[] | null = null;
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
      logError: () => {},
    });
    status = await connections.give(connection.id, undefined);
    const messages = profile.factsFromConnection(connection.id).filter((fact) => (fact.data as { kind?: string } | null)?.kind === "message");
    const read = messages.filter((fact) => (fact.data as { read?: boolean }).read === true);
    // A fact's text is "Email from someone", with ": subject" after it only when the page gave one.
    wordsKept = { read: read.length, withSubject: read.filter((fact) => /^Email from [^:]*: ./.test(fact.text)).length };

    // The list again, as Outlook's own servers now have it, to see what opening those did.
    const firstInbox = visits.find((visit) => !isMessagePage(visit.rawAsked) && visit.html !== null);
    const openedAny = visits.some((visit) => isMessagePage(visit.rawAsked));
    if (firstInbox && openedAny && !status.needsLogin && !revokedMeanwhile) {
      inboxAfter = await browserAccess
        .read(firstInbox.rawAsked, { until: INBOX_IS_READY })
        .then((page) => readInboxPage(page.html))
        .catch(() => null);
    }
  } finally {
    store.close();
  }

  if (revokedMeanwhile) {
    print(`The Read Permission for ${connection.name} was revoked during the check, so it stopped. Nothing was saved.`);
    return EXIT_NO_READ_PERMISSION;
  }

  const inboxVisits = visits.filter((visit) => !isMessagePage(visit.rawAsked));
  const firstInboxHtml = inboxVisits[0]?.html ?? null;
  const rows = firstInboxHtml === null ? null : readInboxPage(firstInboxHtml);
  const messageVisits = visits.filter((visit) => isMessagePage(visit.rawAsked));
  const outcomes = messageVisits.map((visit): MessageOnPage["outcome"] | "failed" => (visit.html === null ? "failed" : readMessagePage(visit.html).outcome));
  const countOutcome = (outcome: string) => outcomes.filter((candidate) => candidate === outcome).length;

  print(`${connection.name} check. This shows counts and page shapes only, and nothing was saved.`);
  print("Read Permission: given by the Student");
  print(`Login: ${status.needsLogin ? "not logged in. The Student needs to log in through a Takeover: You tab, Log in to TUmail." : "works"}`);
  // Words from Buddy's own code, never from a page. See tumail.ts.
  if (status.lastReadProblem) print(`Problem: ${status.lastReadProblem}`);
  print("");
  print("Found:");
  print(rows === null ? "  messages in the list: the list wasn't recognized" : `  messages in the list: ${rows.length}`);
  if (rows) {
    print(`  with a sender's address: ${rows.filter((row) => row.address !== null).length}`);
    print(`  from temple.edu addresses: ${rows.filter((row) => row.address !== null && isTempleAddress(row.address)).length}`);
    print(`  with a date: ${rows.filter((row) => row.shownAt !== null).length}`);
    print(`  saying whether they're unread: ${rows.filter((row) => row.unread !== null).length}`);
  }
  print("  from Contacts: the check has no Contacts, so it opens only temple.edu addresses");
  print(`  opened: ${messageVisits.length}`);
  print(`  words read: ${countOutcome("read")}, kept: ${wordsKept.read}`);
  print(`  subject found: ${wordsKept.withSubject}`);
  print(`  no sender shown: ${countOutcome("no_sender")}`);
  print(`  several open at once: ${countOutcome("several_open")}`);
  print(`  not recognized: ${countOutcome("not_recognized")}`);
  print(`  couldn't be opened: ${countOutcome("failed")}`);

  print("");
  print("Opening a message and its unread mark:");
  const opened = new Set(messageVisits.map((visit) => idInAddress(visit.rawAsked)));
  let markedRead = false;
  const before = rows ? unreadAmong(rows, opened) : 0;
  if (!rows || opened.size === 0) {
    print("  can't tell: nothing was opened");
  } else if (rows.every((row) => row.unread === null)) {
    print("  can't tell: the list doesn't say which are unread");
  } else if (before === 0) {
    print("  can't tell: none of what it opened was unread. Have someone at temple.edu send a new email, then run this again.");
  } else if (!inboxAfter) {
    print(`  opened while unread: ${before}`);
    print("  can't tell: the list couldn't be read again afterwards");
  } else {
    const after = unreadAmong(inboxAfter, opened);
    print(`  opened while unread: ${before}`);
    print(`  still unread afterwards: ${after}`);
    markedRead = after < before;
    if (markedRead) print("  WARNING: opening a message marked it read, which the Student would see. Look at what the guard let through below.");
  }

  print("");
  print("Pages opened:");
  for (const line of countedLines(visits.map((visit) => describeVisit(visit, appHosts)))) print(line);
  print("");
  print("Refused by the guard:");
  if (refused.length === 0) print("  nothing");
  for (const line of countedLines(refused)) print(line);
  print("");
  print("Let through though it isn't a plain read (on the read-only list in tumail-rules.ts):");
  if (letThrough.length === 0) print("  nothing");
  for (const line of countedLines(letThrough)) print(line);

  const shapes: { path: string; why: string; html: string }[] = [];
  if (!status.needsLogin && firstInboxHtml !== null) {
    if (rows === null) shapes.push({ path: "/mail/inbox", why: WHY_NOT_RECOGNIZED, html: firstInboxHtml });
    else if (rows.length > 0 && rows.every((row) => row.address === null)) shapes.push({ path: "/mail/inbox", why: WHY_NO_SENDERS, html: firstInboxHtml });
  }
  const firstUnclear = messageVisits.find((visit) => visit.html !== null && readMessagePage(visit.html).outcome !== "read");
  if (firstUnclear && !status.needsLogin) shapes.push({ path: "/mail/inbox/id/:id", why: WHY_NOT_RECOGNIZED, html: firstUnclear.html! });
  if (shapes.length > 0) {
    print("");
    print("Structure of the pages the reader had trouble with (the first of each kind):");
    for (const { path, why, html } of shapes) {
      print("");
      print(`Structure of ${path}  (${why})`);
      for (const line of shapeOf(html)) print(line);
    }
  }

  if (status.needsLogin) return EXIT_LOGIN_NEEDED;
  return markedRead ? EXIT_MARKED_READ : EXIT_OK;
}

function describeVisit(visit: PageVisit, appHosts: string[]): string {
  const asked = cleanTumailRequest(visit.rawAsked, appHosts).replace(/^\S+ /, "");
  if (visit.failed) return `${asked}  (${visit.failed})`;
  const landed = cleanTumailRequest(visit.rawLanded!, appHosts);
  const landedPath = landed.replace(/^\S+ /, "");
  if (landedPath === asked && URL.parse(visit.rawLanded!)?.hostname === URL.parse(visit.rawAsked)?.hostname) return asked;
  return `${asked}  (ended up at ${landed})`;
}
