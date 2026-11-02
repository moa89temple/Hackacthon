import { createBrowserAccess, TakeoverInProgress, type Site } from "./browser-access.ts";
import type { BuddysBrowser, PageReading } from "./buddys-browser.ts";
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
import { createGuardPolicy, isOnSite, type RequestGuard } from "./network-guard.ts";
import { appVersionOf, readAppointmentsAnswer, readTeamAnswer } from "./navigate360-pages.ts";
import { APPOINTMENTS_ANSWER_PATH, TEAM_ANSWER_PATH } from "./navigate360-rules.ts";
import { hasPath } from "./page-answers.ts";
import { createProfile } from "./profile.ts";
import { openStore, THE_STUDENT } from "./store.ts";

/**
 * Checks the Navigate360 reader against a real login, for someone who must not see the Student's
 * records. It runs the real reader through the real gate and prints only counts, cleaned addresses and
 * shapes: an answer's field names and kinds, and a page's tags and roles. Everything it prints goes
 * through the few functions below, which build each line from fixed words and cleaned names rather
 * than cleaning up what a page said. Nothing is written anywhere: the database is in memory.
 *
 * The real app is unseen, so this is built to show what to correct in navigate360-rules.ts: what
 * pages it really lands on, what those pages really ask for, and what comes back.
 */

const LONGEST_NAME = 40;
const MOST_SHAPE_LINES = 200;
const DEEPEST_SHAPE = 8;
/** Shorter than this, a word such as "id" or "name" is in most answers and says nothing. */
const SHORTEST_WORD_TO_COMPARE = 4;
const SHORTEST_HOST_PART_TO_COMPARE = 8;

/** The next part of an address after one of these names someone or something of theirs, whatever it looks like. */
const NAMES_SOMEONE_NEXT = new Set(["students", "users", "people", "person", "members", "staff"]);
/** The app's own pages under those, from its public scripts, which name no one. */
const PAGES_UNDER_PEOPLE = new Set(["categories", "person"]);
/** Words in this app's addresses that are fine to compare with nothing. "people" is a page, not a person. */
const ADDRESS_WORDS = new Set(
  `api app apps as3 appconfig authentication categories core current_user feed features home login my native notification people person remote resources
  scheduling schedule students support_team v1 v2 v3`
    .split(/\s+/)
    .filter(Boolean),
);
/** The fields the reader expects. Anything else is shown only if it's made of nothing the answer says. */
const FIELD_NAMES = new Set(
  `data team user id first_name last_name email work_phone relationship relationship_type visible_to_student upcoming_appointments student_data
  appointment_invitations start end name location attendees staff_comment meeting_url_or_phone`
    .split(/\s+/)
    .filter(Boolean),
);
const ROLES = new Set(
  `alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo dialog document form grid gridcell
  group heading img link list listbox listitem main menu menubar menuitem navigation option paragraph radio region row rowgroup rowheader search searchbox
  separator status switch tab table tablist tabpanel text textbox toolbar tooltip tree treeitem`
    .split(/\s+/)
    .filter(Boolean),
);

function cleanSegment(segment: string, wordsSeen: string, afterName: boolean): string {
  const lower = segment.toLowerCase();
  if (afterName) return ":id";
  if (ADDRESS_WORDS.has(lower)) return lower;
  if (/\d/.test(segment)) return ":id";
  // A lower-case word the page doesn't show is an address's own, which is how a real address gets found.
  if (!/^[a-z][a-z_-]*$/.test(segment) || segment.length > LONGEST_NAME) return ":text";
  const word = normalized(segment);
  return word.length >= SHORTEST_WORD_TO_COMPARE && wordsSeen.includes(word) ? ":text" : segment;
}

function cleanSegments(raw: string, wordsSeen: string): string {
  const parts = raw.split("/");
  return parts
    .map((segment, index) => {
      if (segment === "") return "";
      const afterName = NAMES_SOMEONE_NEXT.has(parts[index - 1]?.toLowerCase() ?? "") && !PAGES_UNDER_PEOPLE.has(segment);
      return cleanSegment(segment, wordsSeen, afterName);
    })
    .join("/");
}

/** Takes a raw address to its path and route, with no query and nothing that could be someone's words or an id. */
export function cleanAddress(address: string, wordsSeen: string): string {
  const url = URL.parse(address);
  if (!url) return ":text";
  const route = url.hash.startsWith("#/") ? `#${cleanSegments(url.hash.slice(1).split("?")[0]!, wordsSeen)}` : "";
  return `${cleanSegments(url.pathname, wordsSeen)}${route}`;
}

function collectValues(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectValues(item, into));
  else if (typeof value === "object" && value !== null) Object.values(value).forEach((item) => collectValues(item, into));
}

function valuesIn(body: string): string {
  try {
    const values: string[] = [];
    collectValues(JSON.parse(body), values);
    return values.join(" ");
  } catch {
    return body;
  }
}

function cleanField(name: string, wordsSeen: string): string {
  if (FIELD_NAMES.has(name)) return name;
  if (name.length > LONGEST_NAME || !/^[A-Za-z_][A-Za-z_-]*$/.test(name)) return ":field";
  const word = normalized(name);
  return word.length >= SHORTEST_WORD_TO_COMPARE && wordsSeen.includes(word) ? ":field" : name;
}

function shapeLines(value: unknown, indent: string, label: string, wordsSeen: string, depth: number): string[] {
  const prefix = `${indent}${label}`;
  if (value === null || value === undefined) return [`${prefix}nothing`];
  if (typeof value === "string") return [`${prefix}text`];
  if (typeof value === "number") return [`${prefix}number`];
  if (typeof value === "boolean") return [`${prefix}yes or no`];
  if (depth >= DEEPEST_SHAPE) return [`${prefix}(deeper)`];
  if (Array.isArray(value)) {
    // The first item stands for the rest, as a long table's rows do.
    const first = value.length > 0 && typeof value[0] === "object" && value[0] !== null ? shapeLines(value[0], `${indent}  `, "", wordsSeen, depth + 1).slice(1) : [];
    return [`${prefix}list of ${value.length}`, ...first];
  }
  return [
    `${prefix}object`,
    ...Object.entries(value).flatMap(([name, item]) => shapeLines(item, `${indent}  `, `${cleanField(name, wordsSeen)}: `, wordsSeen, depth + 1)),
  ];
}

/** An answer's field names and the kinds of their values, and never a value. */
export function shapeOfAnswer(body: string, wordsSeen: string): string[] {
  let answer: unknown;
  try {
    answer = JSON.parse(body);
  } catch {
    return [`not JSON, ${body.length} characters`];
  }
  return shapeLines(answer, "", "", `${wordsSeen} ${normalized(valuesIn(body))}`, 0).slice(0, MOST_SHAPE_LINES);
}

/**
 * A page's accessibility tree as its roles and nothing else. It's what shows an app that draws inside
 * its own elements, where the page's HTML doesn't. Anything but a known role is left out.
 */
export function shapeOfAccessibility(snapshot: string): string[] {
  const lines = snapshot.split(/\r?\n/).flatMap((line) => {
    const match = /^(\s*)- ([a-z]+)(?=[\s:]|$)/.exec(line);
    return match && ROLES.has(match[2]!) ? [`${match[1]}${match[2]}`] : [];
  });
  const shape: string[] = [];
  for (let index = 0; index < lines.length && shape.length < MOST_SHAPE_LINES; index++) {
    let repeats = 1;
    while (lines[index + repeats] === lines[index]) repeats++;
    shape.push(repeats > 1 ? `${lines[index]} ×${repeats}` : lines[index]!);
    index += repeats - 1;
  }
  return shape;
}

interface Visit {
  asked: string;
  /** Null if it didn't get there. */
  page: PageReading | null;
  /** The paths of the answers the reader came for. */
  expected: RegExp[];
  /** The kind of error, never its words, which often quote the address. */
  failed: string | null;
}

interface RequestSeen {
  method: string;
  url: string;
  refused: boolean;
}

/**
 * What the check sees of the browser. It lets through reading and nothing else: the login in a real
 * container must survive this. Copied from canvas-check.ts and extended with what the page asks for.
 */
function watchingBrowser(inner: BuddysBrowser, mayGoOn: () => boolean, visits: Visit[], requests: RequestSeen[]): BuddysBrowser {
  const notInACheck = (): never => {
    throw new Error("The check only ever reads");
  };
  return {
    liveView: inner.liveView,
    show: async () => notInACheck(),
    submitForm: async () => notInACheck(),
    clearScreen: async () => notInACheck(),
    forgetLogin: async () => notInACheck(),

    async read(url, guard, options) {
      if (!mayGoOn()) throw new TakeoverInProgress();
      const watching: RequestGuard = {
        check(request) {
          const decision = guard.check(request);
          if (!request.opensPage || !decision.allowed) {
            requests.push({ method: /^[A-Z]{1,10}$/.test(request.method) ? request.method : "OTHER", url: request.url, refused: !decision.allowed });
          }
          return decision;
        },
      };
      const expected = options?.answersFrom?.paths ?? [];
      try {
        const page = await inner.read(url, watching, options);
        visits.push({ asked: url, page, expected, failed: null });
        return page;
      } catch (error) {
        visits.push({ asked: url, page: null, expected, failed: kindOfError(error) });
        throw error;
      }
    },
  };
}

function countedLines(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts].map(([line, count]) => (count > 1 ? `  ${line}  ×${count}` : `  ${line}`));
}

/** A host a page chose to load from could be named after something on the page. The site's own never is. */
function cleanHost(address: string, sites: Record<string, Site>, wordsSeen: string): string {
  const host = URL.parse(address)?.hostname ?? ":text";
  if (Object.values(sites).some((site) => isOnSite(host, site))) return host;
  const parts = host.toLowerCase().split(".").map(normalized);
  return parts.some((part) => part.length >= SHORTEST_HOST_PART_TO_COMPARE && wordsSeen.includes(part)) ? "(a host named after words on the page)" : host;
}

const answersAt = (visits: Visit[], path: RegExp) =>
  visits.flatMap((visit) => visit.page?.answers ?? []).filter((answer) => hasPath(answer.url, path));

export interface Navigate360CheckDeps {
  browser: BuddysBrowser;
  connection: ConnectionType;
  sites: Record<string, Site>;
  /** Asked before anything opens, and before each page, because the Student can revoke or start a Takeover at any time. */
  student: () => StudentState;
  print: (line: string) => void;
}

/** Returns the exit code. It never prints what an error says or what a page said. */
export async function runNavigate360Check(deps: Navigate360CheckDeps): Promise<number> {
  try {
    return await runChecked(deps);
  } catch (error) {
    deps.print(`The check stopped unexpectedly (${kindOfError(error)}). Nothing was saved.`);
    return EXIT_FAILED;
  }
}

async function runChecked({ browser, connection, sites, student, print }: Navigate360CheckDeps): Promise<number> {
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

  // In memory, so that there's no file for what's read to be left in. The Read Permission was the Student's tap, checked above.
  const store = openStore(":memory:");
  const clock = systemClock;
  let status: { needsLogin: boolean; lastReadProblem: string | null };
  let factData: { kind?: string; email?: string | null }[];
  let contactsAdded: number;
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
    factData = profile.factsFromConnection(connection.id).map((fact) => (fact.data ?? {}) as { kind?: string; email?: string | null });
    contactsAdded = store.listGuidebookItems().length;
  } finally {
    store.close();
  }

  if (revokedMeanwhile) {
    print(`The Read Permission for ${connection.name} was revoked during the check, so it stopped. Nothing was saved.`);
    return EXIT_NO_READ_PERMISSION;
  }

  const now = clock.now();
  const wordsSeen = normalized(
    visits.flatMap(({ page }) => (page ? [page.text, page.accessibilitySnapshot, ...(page.answers ?? []).map((answer) => valuesIn(answer.body))] : [])).join(" "),
  );
  const teams = answersAt(visits, TEAM_ANSWER_PATH).map((answer) => readTeamAnswer(answer.body));
  const appointmentLists = answersAt(visits, APPOINTMENTS_ANSWER_PATH).map((answer) => readAppointmentsAnswer(answer.body, now));
  const lastTeam = teams.at(-1);
  const lastAppointments = appointmentLists.at(-1);
  const version = visits.map(({ page }) => (page ? appVersionOf(page.url) : null)).find(Boolean);
  const advisors = factData.filter(({ kind }) => kind === "advisor");

  print(`${connection.name} check. This shows counts and page shape only, and nothing was saved.`);
  print("Read Permission: given by the Student");
  print(`Login: ${status.needsLogin ? `not logged in. The Student needs to log in through a Takeover: You tab, Log in to ${connection.name}.` : "works"}`);
  // Words from Buddy's own code, never from a page. See navigate360.ts.
  if (status.lastReadProblem) print(`Problem: ${status.lastReadProblem}`);
  print(`App version: ${version ?? "couldn't tell"}`);
  print("");
  print("Found:");
  print(`  advisors: ${advisors.length}`);
  print(`  advisors with an address: ${advisors.filter(({ email }) => email).length}`);
  print(`  Contacts added: ${contactsAdded}`);
  print(`  advisors left out, with a name or address Buddy can't use: ${lastTeam?.unusable ?? 0}`);
  print(`  others on the team, not kept: ${lastTeam?.othersOnTeam ?? 0}`);
  print(`  others on the team with a title the reader doesn't know: ${lastTeam?.unknownRoles ?? 0}`);
  print(`  upcoming appointments: ${factData.filter(({ kind }) => kind === "appointment").length}`);
  print(`  appointments left out, with no time Buddy can read: ${lastAppointments?.unusable ?? 0}`);
  print("");
  print("Pages opened:");
  const describeVisit = (visit: Visit) => {
    const asked = cleanAddress(visit.asked, wordsSeen);
    if (!visit.page) return `${asked}  (${visit.failed})`;
    if (visit.page.url === visit.asked) return asked;
    return `${asked}  (ended up at ${cleanHost(visit.page.url, sites, wordsSeen)} ${cleanAddress(visit.page.url, wordsSeen)})`;
  };
  for (const line of countedLines(visits.map(describeVisit))) print(line);
  print("");
  const describeRequest = (request: RequestSeen) => `${request.method} ${cleanHost(request.url, sites, wordsSeen)} ${cleanAddress(request.url, wordsSeen)}`;
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

  const printAnswers = (name: string, path: RegExp, understood: boolean) => {
    const answer = answersAt(visits, path).at(-1);
    if (!answer) return;
    print("");
    print(`The app's answer about ${name}, status ${answer.status}${understood ? "" : ". It isn't what the reader expects"}:`);
    for (const line of shapeOfAnswer(answer.body, wordsSeen)) print(`  ${line}`);
  };
  printAnswers("the team", TEAM_ANSWER_PATH, Boolean(lastTeam));
  printAnswers("appointments", APPOINTMENTS_ANSWER_PATH, Boolean(lastAppointments));

  // One of each page, where an answer the reader came for never came.
  const shown = new Set<string>();
  for (const { page, expected } of visits) {
    if (!page || !expected.some((path) => answersAt(visits, path).length === 0)) continue;
    const where = cleanAddress(page.url, wordsSeen);
    if (shown.has(where)) continue;
    shown.add(where);
    print("");
    print(`Shape of the page, where the reader didn't get what it came for: ${where}`);
    print("Its accessibility tree, by role:");
    for (const line of shapeOfAccessibility(page.accessibilitySnapshot)) print(`  ${line}`);
    print("Its HTML, by tag and class. An app that draws inside its own elements shows little here:");
    for (const line of structureOf(page.html || "<body></body>")) print(`  ${line}`);
  }
  return EXIT_OK;
}
