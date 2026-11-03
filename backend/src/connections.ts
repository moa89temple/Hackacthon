import {
  connectionRead,
  connectionReadFailed,
  loginDeleted,
  loginNotDeletedYet,
  readPermissionGiven,
  readPermissionRevoked,
  type ReadReason,
} from "./activity.ts";
import { BrowserUnreachable, TakeoverInProgress, type BrowserAccess } from "./browser-access.ts";
import { describeInPhiladelphia, philadelphiaClock, type Clock } from "./clock.ts";
import type { ContactAddress } from "./guidebook.ts";
import { NO_OPPORTUNITY_PAGES, type OpportunityPagesFromConnection } from "./opportunities-from-connection.ts";
import type { FactFromConnection, Profile } from "./profile.ts";
import {
  THE_STUDENT,
  type ConnectionEventToStore,
  type ConnectionFactToStore,
  type ContactFromConnection,
  type Store,
  type StoredConnectionEvent,
  type StoredReadPermission,
} from "./store.ts";
import type { Web } from "./web.ts";

/** The Read Permission card. All of it comes from Buddy's code, never from the model. */
export interface ReadPermissionCard {
  /** Exactly what Buddy will read. */
  reads: string[];
  /** What else the Student should know before they tap. */
  notes: string[];
  /** Says so when the service's own rules forbid automated tools, as LinkedIn's do. */
  warning: string | null;
  /** The address the Student must paste, for a Connection that's read through one. */
  address: { label: string; steps: string[] } | null;
}

export interface ReadContext {
  address: string | null;
  web: Web;
  /** The only way a Connection reads a page in Buddy's Browser, which is what the guard watches. */
  browser: Pick<BrowserAccess, "read">;
  now: Date;
  /** Every Contact there is right now, the same ones a Handoff can go to. */
  contacts(): ContactAddress[];
  /** What this Connection's facts were before this read. */
  previous: FactFromConnection[];
  /** Part of this read didn't work. What it returns is still saved, and the Student is told this. */
  reportMissed(problem: string): void;
  /** The Student's asking about something older, so look further back than a usual read does. */
  lookFurther: boolean;
  /** Where a Connection puts a page that may hold Opportunities, to be checked as any other page is. */
  opportunityPages: OpportunityPagesFromConnection;
}

export interface ReadingForClaude {
  facts: FactFromConnection[];
  events: StoredConnectionEvent[];
  now: Date;
  lastReadAt: Date | null;
  lastReadProblem: string | null;
  needsLogin: boolean;
}

/** One kind of Connection. Everything the gate and the schedule need to know about it. */
export interface ConnectionType {
  id: string;
  name: string;
  /**
   * Set when Buddy can't read this at all for now, in words for the Student. Nothing about it gets opened, and it
   * can't be connected. A Read Permission it already has stays until the Student revokes it, which deletes the login.
   */
  notReadableYet?: string;
  /** A Briefing says only how many of this Connection's events there are, in these words, and shows none of them. */
  briefingCount?: { one: string; many: string };
  card: ReadPermissionCard;
  /** What Claude is told to do with this Connection, while it's on. */
  whileOnTellClaude: string;
  /** Returns the address to keep, or throws BadAddress. Only Connections with card.address have one. */
  checkAddress?(pasted: unknown): string;
  /**
   * The Student logs in to this through a Takeover, and its login is held in Buddy's Browser under the
   * site with this same id. The guard goes by that id, so they have to match.
   */
  logsIn?: boolean;
  /** Which Opportunities' pages came from this Connection, for one that finds any. They go with the Read Permission. */
  isItsOpportunityPage?(url: string): boolean;
  /** Throws ReadProblem to tell the Student what went wrong. */
  read(context: ReadContext): Promise<ConnectionFactToStore[]>;
  /**
   * The Contacts this read's facts make, all of them each time: any from before that aren't here go.
   * They're saved with the facts and go with the Read Permission. Contacts from anywhere else aren't touched.
   */
  contactsFrom?(facts: ConnectionFactToStore[]): ContactFromConnection[];
  /** What changed between one read's facts and the next's. Never called for the first read. */
  eventsBetween?(before: FactFromConnection[], after: ConnectionFactToStore[]): ConnectionEventToStore[];
  /** How many of what, for Activity. It mustn't repeat what they are. */
  countEvents?(events: ConnectionEventToStore[]): string;
  /** `asked` is what Claude passed to the tool, for a Connection that gives less unless Claude asks for more. */
  describeForClaude(reading: ReadingForClaude, asked?: unknown): string;
}

export interface ConnectionStatus {
  id: string;
  name: string;
  on: boolean;
  lastReadAt: string | null;
  lastReadProblem: string | null;
  /** The Student logs in to this through a Takeover. */
  logsIn: boolean;
  /** Buddy's Browser isn't logged in, so Buddy is asking the Student for a Takeover. */
  needsLogin: boolean;
  /** Revoked, but its login could only be deleted once Buddy's Browser could be reached. */
  loginNotDeletedYet: boolean;
  /** Why Buddy can't read this for now, if it can't. See ConnectionType. */
  notReadableYet: string | null;
  card: ReadPermissionCard;
}

export class UnknownConnection extends Error {
  constructor() {
    super("Buddy doesn't know that Connection");
  }
}

export class NoReadPermission extends Error {
  constructor(name: string) {
    super(`The Student hasn't given a Read Permission for ${name}`);
  }
}

export class ConnectionNotReadableYet extends Error {}

export class ReadPermissionAlreadyGiven extends Error {
  constructor(name: string) {
    super(`${name} is already connected. Revoke it first to use a different address.`);
  }
}

/** The address can't be used. The message is for the Student, and never repeats what they pasted. */
export class BadAddress extends Error {}

/** A read that didn't work. The message is for the Student, and never says the address. */
export class ReadProblem extends Error {}

/** Buddy's Browser isn't logged in, so the read needs a Takeover first. */
export class LoginNeeded extends ReadProblem {}

/**
 * The Read Permission gate: every read of every Connection goes through here, and nothing else
 * gets to the secret address or the web on a Connection's behalf.
 */
export interface Connections {
  list(): ConnectionStatus[];
  /** The Student's tap on the card. It's reached only from the app, never from the model. */
  give(id: string, pastedAddress: unknown): Promise<ConnectionStatus>;
  /**
   * Deletes the Read Permission, its address, every Profile fact and event from this Connection, and
   * its login. If the login can't go yet, it keeps being tried and the status says so.
   */
  revoke(id: string): Promise<ConnectionStatus>;
  /** Reads now. Throws NoReadPermission without one. A read that fails shows in the status. */
  read(id: string, reason: ReadReason, options?: { lookFurther?: boolean }): Promise<ConnectionStatus>;
  /**
   * Deletes a revoked Connection's login if that's still to do, so that it can't carry on under a new
   * Read Permission. Throws BrowserUnreachable if it can't. Call it before a Takeover starts.
   */
  beforeLogin(site: string): Promise<void>;
  /** Call it after the Student taps Done. A login that worked gets read straight away, in the background. */
  afterLogin(site: string, signedIn: boolean): Promise<void>;
  /** Everything that's changed in this Connection, oldest first. */
  events(id: string): StoredConnectionEvent[];
  /** Waits for any read of this Connection that's under way. */
  readsFinished(id: string): Promise<void>;
  /** Reads each Connection that has come due, going by the times below. */
  readDue(): Promise<void>;
  /** Calls readDue from now on. The timer stops when the backend closes. */
  startSchedule(everyMs?: number): void;
  stopSchedule(): void;
  /** What Claude is shown when it checks this Connection. Throws NoReadPermission without one. */
  describeForClaude(id: string, asked?: unknown): string;
  /** Which Connections are on, for each turn's system message. */
  describeForTurn(): string;
}

/** The hours Buddy reads each Connection, on Philadelphia's clock. */
const READ_HOURS = [7, 13, 19];
const SCHEDULE_CHECK_EVERY_MS = 60_000;

export interface ConnectionsDeps {
  types: ConnectionType[];
  web: Web;
  browserAccess: Pick<BrowserAccess, "read" | "forgetLogin" | "currentTakeover">;
  clock: Clock;
  store: Store;
  profile: Profile;
  /** Where a Connection gets the Contacts. Left out, there are none. */
  contacts?: () => ContactAddress[];
  /** Where a Connection's pages that may hold Opportunities go. Left out, they go nowhere. */
  opportunityPagesFor?: (connection: string) => OpportunityPagesFromConnection;
  /** After a read that worked has saved its facts, and after a revoke has deleted them. If this throws, it's logged and nothing else happens. */
  afterFactsChanged?: (connection: string) => void;
  logError: (error: unknown) => void;
}

export function createConnections(deps: ConnectionsDeps): Connections {
  const { types, web, browserAccess, clock, store, profile, contacts = () => [], opportunityPagesFor = () => NO_OPPORTUNITY_PAGES, afterFactsChanged, logError } = deps;
  const readsUnderWay = new Map<number, Promise<void>>();
  /** One at a time, so that nothing is deleted twice or said twice in Activity. */
  let loginDeletions: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  function typeWithId(id: string): ConnectionType {
    const type = types.find((candidate) => candidate.id === id);
    if (!type) throw new UnknownConnection();
    return type;
  }

  /** The read or revoke has happened, whatever becomes of this. */
  function tellFactsChanged(id: string): void {
    try {
      afterFactsChanged?.(id);
    } catch (error) {
      logError(error);
    }
  }

  function statusOf(type: ConnectionType): ConnectionStatus {
    const permission = store.readPermission(THE_STUDENT, type.id);
    return {
      id: type.id,
      name: type.name,
      on: permission !== null,
      lastReadAt: permission?.lastReadAt?.toISOString() ?? null,
      // What went wrong before it was put aside, and any login it asked for, aren't what's wrong now.
      lastReadProblem: type.notReadableYet ? null : (permission?.lastReadProblem ?? null),
      logsIn: type.logsIn === true,
      needsLogin: type.notReadableYet ? false : (permission?.needsLogin ?? false),
      loginNotDeletedYet: store.loginsToDelete(THE_STUDENT).includes(type.id),
      notReadableYet: type.notReadableYet ?? null,
      card: type.card,
    };
  }

  function deleteWaitingLogins(): Promise<void> {
    const work = async () => {
      for (const site of store.loginsToDelete(THE_STUDENT)) {
        const name = types.find((type) => type.id === site)?.name ?? site;
        try {
          await browserAccess.forgetLogin(site);
          store.loginDeleted(THE_STUDENT, site, loginDeleted(name, clock.now()));
        } catch (error) {
          // The Student is using the browser, so this waits for Done and isn't a problem to report.
          if (error instanceof TakeoverInProgress) continue;
          logError(error);
          if (!store.toldLoginNotDeleted(THE_STUDENT, site)) {
            store.noteLoginNotDeleted(THE_STUDENT, site, loginNotDeletedYet(name, clock.now()));
          }
        }
      }
    };
    loginDeletions = loginDeletions.then(work, work);
    return loginDeletions;
  }

  /** A login from before a revoke mustn't be what a new Read Permission reads with. */
  async function failIfOldLoginRemains(type: ConnectionType): Promise<void> {
    if (!type.logsIn || !store.loginsToDelete(THE_STUDENT).includes(type.id)) return;
    await deleteWaitingLogins();
    if (store.loginsToDelete(THE_STUDENT).includes(type.id)) {
      throw new ReadProblem(`Buddy couldn't delete your old ${type.name} login yet, so it can't read ${type.name}. Check that Buddy's Browser is running.`);
    }
  }

  async function runRead(type: ConnectionType, permission: StoredReadPermission, reason: ReadReason, lookFurther: boolean): Promise<void> {
    const now = clock.now();
    try {
      await failIfOldLoginRemains(type);
      const previous = profile.factsFromConnection(type.id);
      let missed: string | null = null;
      const facts = await type.read({
        address: permission.address,
        web,
        browser: browserAccess,
        now,
        contacts,
        previous,
        reportMissed: (problem) => {
          missed = problem;
        },
        lookFurther,
        opportunityPages: opportunityPagesFor(type.id),
      });
      // On the first read everything looks new, and none of it is news.
      const deleted = new Set(store.deletedFactKeys(THE_STUDENT, type.id));
      // Nor is a fact the Student deleted, which isn't among the previous ones and so would look new every time.
      const events = permission.lastReadAt ? (type.eventsBetween?.(previous, facts) ?? []).filter((event) => !deleted.has(event.factKey)) : [];
      const whatsNew = events.length > 0 ? type.countEvents?.(events) : undefined;
      // Saves only if this Read Permission still stands, so a revoke made meanwhile stays revoked.
      profile.saveReading(permission.id, facts, now, connectionRead(type.name, reason, clock.now(), whatsNew, missed), {
        events,
        problem: missed,
        ...(type.contactsFrom ? { contacts: type.contactsFrom(facts) } : {}),
      });
      tellFactsChanged(type.id);
    } catch (error) {
      // Only words from Buddy's own code reach the log, so that the address can't get there in an error.
      const problem = problemFor(type, error);
      logError(new Error(`Reading ${type.name} failed: ${problem}`));
      store.recordReadProblem(
        THE_STUDENT,
        permission.id,
        problem,
        now,
        connectionReadFailed(type.name, reason, problem, clock.now()),
        error instanceof LoginNeeded,
      );
    }
  }

  /** Two reads of one Read Permission at once share the first one's trip to the web. */
  async function readThroughGate(type: ConnectionType, reason: ReadReason, lookFurther = false): Promise<void> {
    if (type.notReadableYet) throw new ConnectionNotReadableYet(type.notReadableYet);
    const permission = store.readPermission(THE_STUDENT, type.id);
    if (!permission) throw new NoReadPermission(type.name);

    let read = readsUnderWay.get(permission.id);
    // Someone else's usual read wouldn't go far enough for this one, so it goes after that.
    if (read && lookFurther) {
      await read;
      read = readsUnderWay.get(permission.id);
    }
    if (!read) {
      read = runRead(type, permission, reason, lookFurther).finally(() => readsUnderWay.delete(permission.id));
      readsUnderWay.set(permission.id, read);
    }
    await read;
  }

  async function read(id: string, reason: ReadReason, options: { lookFurther?: boolean } = {}): Promise<ConnectionStatus> {
    const type = typeWithId(id);
    await readThroughGate(type, reason, options.lookFurther ?? false);
    return statusOf(type);
  }

  async function readDue(): Promise<void> {
    await deleteWaitingLogins();
    const currentRound = readRound(clock.now());
    await Promise.all(
      types
        .filter((type) => {
          if (type.notReadableYet) return false;
          const permission = store.readPermission(THE_STUDENT, type.id);
          return permission && (!permission.lastTriedAt || readRound(permission.lastTriedAt) !== currentRound);
        })
        .map((type) => readThroughGate(type, "schedule").catch(logError)),
    );
  }

  return {
    list: () => types.map(statusOf),

    async give(id, pastedAddress) {
      const type = typeWithId(id);
      if (type.notReadableYet) throw new ConnectionNotReadableYet(type.notReadableYet);
      if (store.readPermission(THE_STUDENT, id)) throw new ReadPermissionAlreadyGiven(type.name);
      const address = type.card.address ? type.checkAddress!(pastedAddress) : null;
      const givenAt = clock.now();
      store.giveReadPermission(THE_STUDENT, id, { address, givenAt }, readPermissionGiven(type.name, givenAt));
      return read(id, "given");
    },

    async revoke(id) {
      const type = typeWithId(id);
      if (store.readPermission(THE_STUDENT, id)) {
        const entry = readPermissionRevoked(type.name, type.card.address !== null, clock.now(), type.isItsOpportunityPage !== undefined);
        store.revokeReadPermission(THE_STUDENT, id, entry, type.logsIn ? id : undefined, type.isItsOpportunityPage);
        tellFactsChanged(id);
      }
      await deleteWaitingLogins();
      return statusOf(type);
    },

    async beforeLogin(site) {
      if (browserAccess.currentTakeover() || !store.loginsToDelete(THE_STUDENT).includes(site)) return;
      await deleteWaitingLogins();
      if (store.loginsToDelete(THE_STUDENT).includes(site)) throw new BrowserUnreachable(null);
    },

    async afterLogin(site, signedIn) {
      await deleteWaitingLogins();
      const type = types.find((candidate) => candidate.id === site && candidate.logsIn);
      if (!signedIn || !type || type.notReadableYet || !store.readPermission(THE_STUDENT, site)) return;
      void readThroughGate(type, "logged_in").catch(logError);
    },

    events(id) {
      typeWithId(id);
      return store.listConnectionEvents(THE_STUDENT, id);
    },

    async readsFinished(id) {
      const permission = store.readPermission(THE_STUDENT, id);
      if (permission) await readsUnderWay.get(permission.id);
    },

    read,
    readDue,

    startSchedule(everyMs = SCHEDULE_CHECK_EVERY_MS) {
      const check = () => void readDue().catch(logError);
      timer = setInterval(check, everyMs);
      timer.unref();
      check();
    },

    stopSchedule() {
      clearInterval(timer);
    },

    describeForClaude(id, asked) {
      const type = typeWithId(id);
      const permission = store.readPermission(THE_STUDENT, id);
      if (!permission) throw new NoReadPermission(type.name);
      return type.describeForClaude({
        facts: profile.factsFromConnection(id),
        events: store.listConnectionEvents(THE_STUDENT, id),
        now: clock.now(),
        lastReadAt: permission.lastReadAt,
        lastReadProblem: permission.lastReadProblem,
        needsLogin: permission.needsLogin,
      }, asked);
    },

    describeForTurn() {
      return types
        .map((type) => {
          if (type.notReadableYet) return `${type.name} can't be read yet, so you can't see it and shouldn't offer it.`;
          const permission = store.readPermission(THE_STUDENT, type.id);
          if (permission) {
            const lastRead = permission.lastReadAt
              ? `last read ${describeInPhiladelphia(permission.lastReadAt)}`
              : "but Buddy hasn't managed to read it yet";
            const login = permission.needsLogin
              ? ` Buddy's Browser isn't logged in to it, so tell the Student to tap Log in to ${type.name} on the You tab. They log in themselves, and you never ask for a password.`
              : "";
            return `${type.name} is connected, ${lastRead}.${login} ${type.whileOnTellClaude}`;
          }
          return `${type.name} isn't connected, so don't use or mention anything you saw from it earlier in this conversation. Offer it only when reading it is actually needed to answer what they've just asked, or they ask for it. Having offered it before doesn't change that.`;
        })
        .join(" ");
    },
  };
}

function problemFor(type: ConnectionType, error: unknown): string {
  if (error instanceof ReadProblem) return error.message;
  return `Buddy couldn't reach ${type.name}. It will try again at its next read, or you can tap Read now.`;
}

/**
 * Which of the day's read times this moment comes after, such as "2026-11-02 13". Two moments in
 * the same round need only one read. Going by the wall clock keeps this right when the clocks change.
 */
function readRound(moment: Date): string {
  const { hour, ...today } = philadelphiaClock(moment);
  const latest = READ_HOURS.findLast((readHour) => readHour <= hour);
  if (latest !== undefined) return `${dateKey(today)} ${latest}`;
  // Before the first read of the day, this still counts as yesterday's last. It's before 7 a.m.,
  // so 12 hours back is always yesterday, even on a day the clocks change.
  const yesterday = philadelphiaClock(new Date(moment.getTime() - 12 * 3_600_000));
  return `${dateKey(yesterday)} ${READ_HOURS.at(-1)}`;
}

function dateKey({ year, month, day }: { year: number; month: number; day: number }): string {
  return `${year}-${month}-${day}`;
}
