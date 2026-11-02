import { maskSecrets } from "./masking.ts";
import { ADVISOR_EMAIL_DOMAIN, ADVISOR_ROLE, isLoginRoute, NAVIGATE360_HOST, NOT_ADVISOR_ROLE, type AppVersion } from "./navigate360-rules.ts";

/**
 * Reads what Navigate360's own scripts got from its server. There's no model here and no fetching. Each
 * function returns null when an answer isn't what it should be, because that's different from an answer
 * that really has nothing in it: a Student's advisor shouldn't disappear, and Buddy shouldn't say they
 * have none, over something it couldn't understand. Assume this is wrong about the real app until
 * `npm run check-navigate360` says otherwise.
 */

export interface AdvisorOnPage {
  name: string;
  /** Null when Navigate360 has none for them. An address that isn't usable never gets this far. */
  email: string | null;
  phone: string | null;
  role: string;
}

export interface TeamOnPage {
  advisors: AdvisorOnPage[];
  /** Instructors and so on, who are counted and never kept. */
  othersOnTeam: number;
  /** People with a title Buddy doesn't know. They're never kept, and they could be an advisor by another name. */
  unknownRoles: number;
  /** Advisors who couldn't be used, such as one whose address isn't an address. */
  unusable: number;
}

export interface AppointmentOnPage {
  id: string | null;
  startsAt: string;
  what: string | null;
  where: string | null;
  withWhom: string | null;
}

export interface AppointmentsOnPage {
  appointments: AppointmentOnPage[];
  /** Appointments with no time Buddy can read. */
  unusable: number;
}

const LONGEST_ADDRESS = 254;
const LONGEST_WORDS = 120;
/** The address part of an email, and nothing that could carry more: no name, no list, no query. */
const ADDRESS = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
/** What the app writes itself for a value that isn't there. */
const NOTHING = "--";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsed(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Plain words from an answer, or null. Each is someone's own, so anything long or strange isn't used. */
function words(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text === "" || text === NOTHING || text.length > LONGEST_WORDS) return null;
  return maskSecrets(text);
}

/**
 * The address a Draft to an advisor goes to, or null for anything that isn't one plain Temple address.
 * It comes from a page, and a page must never be able to choose where the Student's message goes.
 */
export function usableAdvisorEmail(raw: string): string | null {
  const address = raw.trim().toLowerCase();
  if (address.length > LONGEST_ADDRESS || address.includes("..") || !ADDRESS.test(address)) return null;
  const domain = address.slice(address.indexOf("@") + 1);
  return domain === ADVISOR_EMAIL_DOMAIN || domain.endsWith(`.${ADVISOR_EMAIL_DOMAIN}`) ? address : null;
}

/** Answers `/api/students/:id/support_team`, as `{ data: { team: [...] } }`. */
export function readTeamAnswer(body: string): TeamOnPage | null {
  const answer = parsed(body);
  const team = isRecord(answer) && isRecord(answer.data) ? answer.data.team : undefined;
  if (!Array.isArray(team) || !team.every(isRecord)) return null;

  const rolesOf = (person: Record<string, unknown>) => [person.relationship, person.relationship_type].map(words).filter((role) => role !== null);
  // A real team always says who's who, so a team that doesn't has changed shape.
  if (team.length > 0 && team.every((person) => rolesOf(person).length === 0)) return null;

  const found: TeamOnPage = { advisors: [], othersOnTeam: 0, unknownRoles: 0, unusable: 0 };
  const seen = new Set<string>();
  for (const person of team) {
    if (person.visible_to_student === false) continue;
    const roles = rolesOf(person);
    const role = roles.find((candidate) => ADVISOR_ROLE.test(candidate));
    if (!role) {
      // Someone who doesn't say what they are could be the advisor, so this isn't the whole answer.
      if (roles.length === 0) found.unusable++;
      else if (roles.some((candidate) => NOT_ADVISOR_ROLE.test(candidate))) found.othersOnTeam++;
      else found.unknownRoles++;
      continue;
    }

    const name = words([person.first_name, person.last_name].filter((part) => typeof part === "string").join(" "));
    const rawEmail = typeof person.email === "string" ? person.email.trim() : "";
    const email = rawEmail === "" ? null : usableAdvisorEmail(rawEmail);
    if (!name || (rawEmail !== "" && !email)) {
      found.unusable++;
      continue;
    }

    const key = email ?? name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.advisors.push({ name, email, phone: words(person.work_phone), role });
  }
  return found;
}

function placeOf(location: unknown): string | null {
  return words(isRecord(location) ? location.name : location);
}

function firstNameIn(people: unknown): string | null {
  return Array.isArray(people) && isRecord(people[0]) ? words(people[0].name) : null;
}

/**
 * Answers `/api/v2/scheduling/current_user`, as `{ data: { user: { upcoming_appointments: [...] } } }`.
 * Only what's still to come. A comment someone wrote about it and a meeting's link are left out.
 */
export function readAppointmentsAnswer(body: string, now: Date): AppointmentsOnPage | null {
  const answer = parsed(body);
  const user = isRecord(answer) && isRecord(answer.data) ? answer.data.user : undefined;
  const list = isRecord(user) ? user.upcoming_appointments : undefined;
  if (!Array.isArray(list) || !list.every(isRecord)) return null;

  const found: AppointmentsOnPage = { appointments: [], unusable: 0 };
  for (const appointment of list) {
    const moment = typeof appointment.start === "string" ? Date.parse(appointment.start) : Number.NaN;
    if (Number.isNaN(moment)) {
      found.unusable++;
      continue;
    }
    if (moment < now.getTime()) continue;
    const id = appointment.id;
    found.appointments.push({
      id: typeof id === "number" || (typeof id === "string" && /^[\w-]{1,64}$/.test(id)) ? String(id) : null,
      startsAt: new Date(moment).toISOString(),
      what: words(appointment.name),
      where: placeOf(appointment.location),
      withWhom: firstNameIn(appointment.attendees),
    });
  }
  return found;
}

/** Which version of the app a page is, by its address, or null when it isn't either. */
export function appVersionOf(address: string): AppVersion | null {
  const version = /^\/app\/(v1|v2)\/?$/.exec(URL.parse(address)?.pathname ?? "")?.[1];
  return version === "v1" || version === "v2" ? version : null;
}

/** Navigate360 sends a browser with no login to its own login page or to the sign-on's. */
export function isNavigate360LoginPage(address: string, host = NAVIGATE360_HOST): boolean {
  const url = URL.parse(address);
  return !url || url.hostname !== host || isLoginRoute(url.hash);
}
