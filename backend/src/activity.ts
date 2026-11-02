import type { ProfileFact } from "./profile.ts";
import {
  THE_STUDENT,
  type DecisionFact,
  type DecisionSource,
  type NewActivityEntry,
  type Store,
  type StoredActivityEntry,
} from "./store.ts";

/** One entry as the app gets it. The app shows the words as they are, so later kinds need no change there. */
export interface ActivityEntry extends Omit<StoredActivityEntry, "at"> {
  at: string;
}

/** The record of everything Buddy read and did. It only ever grows, so this can only list it. */
export function listActivity(store: Store): ActivityEntry[] {
  return store.listActivity(THE_STUDENT).map((entry) => ({ ...entry, at: entry.at.toISOString() }));
}

export function readPermissionGiven(connectionName: string, at: Date): NewActivityEntry {
  return { kind: "read_permission_given", title: `You gave Buddy a Read Permission for ${connectionName}`, at };
}

export function readPermissionRevoked(connectionName: string, hadAddress: boolean, at: Date): NewActivityEntry {
  return {
    kind: "read_permission_revoked",
    title: `You revoked the Read Permission for ${connectionName}`,
    detail: hadAddress ? "Buddy deleted the address and every fact from it." : "Buddy deleted every fact from it.",
    at,
  };
}

export function loginChecked(siteName: string, at: Date): NewActivityEntry {
  return { kind: "login_check", title: `Buddy opened ${siteName} to check your login`, at };
}

/** What goes into the record of how Buddy decided a reply, as the turn goes on. */
export interface TurnRecord {
  tools: string[];
  /** The pages behind whatever Buddy found in the Guidebook this turn. */
  sources: DecisionSource[];
  facts: Map<number, DecisionFact>;
}

export function newTurnRecord(): TurnRecord {
  return { tools: [], sources: [], facts: new Map() };
}

/**
 * Keeps each fact as it was at the time. The backend records this rather than asking Claude, so it
 * says what Buddy had in front of it, which may be more than Buddy used.
 */
export function noteFactsGiven(turn: TurnRecord, facts: ProfileFact[]): void {
  for (const fact of facts) {
    turn.facts.set(fact.id, {
      text: fact.text,
      ...(fact.detail ? { detail: fact.detail } : {}),
      from: fact.origin.type === "connection" ? `From ${fact.origin.name}` : "From your chat",
    });
  }
}

/** Each page once, however many items came from it. */
export function noteSourcesLookedAt(turn: TurnRecord, sources: DecisionSource[]): void {
  for (const { title, url } of sources) {
    if (!turn.sources.some((source) => source.url === url)) turn.sources.push({ title, url });
  }
}

export function replyDecided(reply: string, turn: TurnRecord, at: Date): NewActivityEntry {
  return {
    kind: "reply",
    title: "Buddy replied",
    decision: { reply, tools: turn.tools, sources: turn.sources, facts: [...turn.facts.values()] },
    at,
  };
}

/** A turn that ended without a saved reply still did things, and the Student saw this message. */
export function replyFailed(shown: string, turn: TurnRecord, at: Date): NewActivityEntry {
  return { ...replyDecided(shown, turn, at), kind: "reply_failed", title: "Buddy couldn't finish a reply" };
}

export function guidebookItemReported(name: string, at: Date): NewActivityEntry {
  return { kind: "guidebook_report", title: `You reported ${name}`, detail: "Buddy no longer shows it to any Student.", at };
}

export function discoveryRead(pagesRead: number, pagesInAll: number, couldNotRead: string[], at: Date): NewActivityEntry {
  const problems = couldNotRead.length > 0 ? ` Couldn't read: ${couldNotRead.join(", ")}` : "";
  return {
    kind: "discovery_read",
    title: "Buddy read Temple's office pages",
    detail: `Read ${pagesRead} of ${pagesInAll} pages.${problems}`,
    at,
  };
}

export function discoveryFailed(at: Date): NewActivityEntry {
  return {
    kind: "discovery_read_failed",
    title: "Buddy couldn't read Temple's office pages",
    detail: "None of them answered, so the Guidebook stays as it was. Buddy tries again each hour.",
    at,
  };
}

/** Why Buddy read a Connection. */
export type ReadReason = "given" | "asked" | "schedule" | "conversation";

const READ_REASONS: Record<ReadReason, string> = {
  given: "You had just given its Read Permission.",
  asked: "You tapped Read now.",
  schedule: "It was one of Buddy's regular read times.",
  conversation: "Buddy looked again during your conversation.",
};

export function connectionRead(connectionName: string, reason: ReadReason, at: Date): NewActivityEntry {
  return { kind: "connection_read", title: `Buddy read ${connectionName}`, detail: READ_REASONS[reason], at };
}

/** The problem is in words from Buddy's own code, so it can't carry a secret address. */
export function connectionReadFailed(
  connectionName: string,
  reason: ReadReason,
  problem: string,
  at: Date,
): NewActivityEntry {
  return {
    kind: "connection_read_failed",
    title: `Buddy couldn't read ${connectionName}`,
    detail: `${READ_REASONS[reason]} ${problem}`,
    at,
  };
}
