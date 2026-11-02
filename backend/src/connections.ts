import { describeInPhiladelphia, philadelphiaClock, type Clock } from "./clock.ts";
import type { Profile } from "./profile.ts";
import { THE_STUDENT, type ConnectionFactToStore, type Store, type StoredReadPermission } from "./store.ts";
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
  now: Date;
}

export interface ReadingForClaude {
  facts: { text: string; data: unknown }[];
  now: Date;
  lastReadAt: Date | null;
  lastReadProblem: string | null;
}

/** One kind of Connection. Everything the gate and the schedule need to know about it. */
export interface ConnectionType {
  id: string;
  name: string;
  card: ReadPermissionCard;
  /** What Claude is told to do with this Connection, while it's on. */
  whileOnTellClaude: string;
  /** Returns the address to keep, or throws BadAddress. Only Connections with card.address have one. */
  checkAddress?(pasted: unknown): string;
  /** Throws ReadProblem to tell the Student what went wrong. */
  read(context: ReadContext): Promise<ConnectionFactToStore[]>;
  describeForClaude(reading: ReadingForClaude): string;
}

export interface ConnectionStatus {
  id: string;
  name: string;
  on: boolean;
  lastReadAt: string | null;
  lastReadProblem: string | null;
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

export class ReadPermissionAlreadyGiven extends Error {
  constructor(name: string) {
    super(`${name} is already connected. Revoke it first to use a different address.`);
  }
}

/** The address can't be used. The message is for the Student, and never repeats what they pasted. */
export class BadAddress extends Error {}

/** A read that didn't work. The message is for the Student, and never says the address. */
export class ReadProblem extends Error {}

/**
 * The Read Permission gate: every read of every Connection goes through here, and nothing else
 * gets to the secret address or the web on a Connection's behalf.
 */
export interface Connections {
  list(): ConnectionStatus[];
  /** The Student's tap on the card. It's reached only from the app, never from the model. */
  give(id: string, pastedAddress: unknown): Promise<ConnectionStatus>;
  /** Deletes the Read Permission, its address and every Profile fact from this Connection. */
  revoke(id: string): ConnectionStatus;
  /** Reads now. Throws NoReadPermission without one. A read that fails shows in the status. */
  read(id: string): Promise<ConnectionStatus>;
  /** Reads each Connection that has come due, going by the times below. */
  readDue(): Promise<void>;
  /** Calls readDue from now on. The timer stops when the backend closes. */
  startSchedule(everyMs?: number): void;
  stopSchedule(): void;
  /** What Claude is shown when it checks this Connection. Throws NoReadPermission without one. */
  describeForClaude(id: string): string;
  /** Which Connections are on, for each turn's system message. */
  describeForTurn(): string;
}

/** The hours Buddy reads each Connection, on Philadelphia's clock. */
const READ_HOURS = [7, 13, 19];
const SCHEDULE_CHECK_EVERY_MS = 60_000;

export interface ConnectionsDeps {
  types: ConnectionType[];
  web: Web;
  clock: Clock;
  store: Store;
  profile: Profile;
  logError: (error: unknown) => void;
}

export function createConnections(deps: ConnectionsDeps): Connections {
  const { types, web, clock, store, profile, logError } = deps;
  const readsUnderWay = new Map<number, Promise<void>>();
  let timer: NodeJS.Timeout | undefined;

  function typeWithId(id: string): ConnectionType {
    const type = types.find((candidate) => candidate.id === id);
    if (!type) throw new UnknownConnection();
    return type;
  }

  function statusOf(type: ConnectionType): ConnectionStatus {
    const permission = store.readPermission(THE_STUDENT, type.id);
    return {
      id: type.id,
      name: type.name,
      on: permission !== null,
      lastReadAt: permission?.lastReadAt?.toISOString() ?? null,
      lastReadProblem: permission?.lastReadProblem ?? null,
      card: type.card,
    };
  }

  async function runRead(type: ConnectionType, permission: StoredReadPermission): Promise<void> {
    const now = clock.now();
    try {
      const facts = await type.read({ address: permission.address, web, now });
      // Saves only if this Read Permission still stands, so a revoke made meanwhile stays revoked.
      profile.saveReading(permission.id, facts, now);
    } catch (error) {
      // Only words from Buddy's own code reach the log, so that the address can't get there in an error.
      const problem = problemFor(type, error);
      logError(new Error(`Reading ${type.name} failed: ${problem}`));
      store.recordReadProblem(permission.id, problem, now);
    }
  }

  /** Two reads of one Read Permission at once share the first one's trip to the web. */
  async function readThroughGate(type: ConnectionType): Promise<void> {
    const permission = store.readPermission(THE_STUDENT, type.id);
    if (!permission) throw new NoReadPermission(type.name);

    let read = readsUnderWay.get(permission.id);
    if (!read) {
      read = runRead(type, permission).finally(() => readsUnderWay.delete(permission.id));
      readsUnderWay.set(permission.id, read);
    }
    await read;
  }

  async function read(id: string): Promise<ConnectionStatus> {
    const type = typeWithId(id);
    await readThroughGate(type);
    return statusOf(type);
  }

  async function readDue(): Promise<void> {
    const currentRound = readRound(clock.now());
    await Promise.all(
      types
        .filter((type) => {
          const permission = store.readPermission(THE_STUDENT, type.id);
          return permission && (!permission.lastTriedAt || readRound(permission.lastTriedAt) !== currentRound);
        })
        .map((type) => readThroughGate(type).catch(logError)),
    );
  }

  return {
    list: () => types.map(statusOf),

    async give(id, pastedAddress) {
      const type = typeWithId(id);
      if (store.readPermission(THE_STUDENT, id)) throw new ReadPermissionAlreadyGiven(type.name);
      const address = type.card.address ? type.checkAddress!(pastedAddress) : null;
      store.giveReadPermission(THE_STUDENT, id, { address, givenAt: clock.now() });
      return read(id);
    },

    revoke(id) {
      const type = typeWithId(id);
      store.revokeReadPermission(THE_STUDENT, id);
      return statusOf(type);
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

    describeForClaude(id) {
      const type = typeWithId(id);
      const permission = store.readPermission(THE_STUDENT, id);
      if (!permission) throw new NoReadPermission(type.name);
      return type.describeForClaude({
        facts: profile.factsFromConnection(id),
        now: clock.now(),
        lastReadAt: permission.lastReadAt,
        lastReadProblem: permission.lastReadProblem,
      });
    },

    describeForTurn() {
      const offers = store.listReadPermissionCards(THE_STUDENT);
      return types
        .map((type) => {
          const permission = store.readPermission(THE_STUDENT, type.id);
          if (permission) {
            const lastRead = permission.lastReadAt
              ? `last read ${describeInPhiladelphia(permission.lastReadAt)}`
              : "but Buddy hasn't managed to read it yet";
            return `${type.name} is connected, ${lastRead}. ${type.whileOnTellClaude}`;
          }
          const offered = offers.some((card) => card.connection === type.id);
          return `${type.name} isn't connected, so don't use or mention anything you saw from it earlier in this conversation. ${
            offered
              ? "You've already offered it, so don't offer it again unless the Student asks."
              : "Offer it only if reading it would help answer what they've just asked."
          }`;
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
