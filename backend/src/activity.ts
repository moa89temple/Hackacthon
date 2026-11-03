import type { CardDescription, StepResult } from "./action-cards.ts";
import type { EmailStep } from "./buddys-browser.ts";
import type { ProfileFact } from "./profile.ts";
import type { SendingMode } from "./sending-store.ts";
import {
  THE_STUDENT,
  type DecisionFact,
  type DecisionSource,
  type DraftWords,
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

export function loginDeleted(connectionName: string, at: Date): NewActivityEntry {
  return { kind: "login_deleted", title: `Buddy deleted your ${connectionName} login`, detail: "Buddy's Browser no longer holds it.", at };
}

export function loginNotDeletedYet(connectionName: string, at: Date): NewActivityEntry {
  return {
    kind: "login_not_deleted_yet",
    title: `Buddy couldn't delete your ${connectionName} login yet`,
    detail: "Buddy's Browser couldn't be reached. Buddy can't use the login, and keeps trying to delete it.",
    at,
  };
}

export function loginChecked(siteName: string, at: Date): NewActivityEntry {
  return { kind: "login_check", title: `Buddy opened ${siteName} to check your login`, at };
}

/** Each line of the card as the Student saw it, so that the record says exactly what was asked. */
function cardLines(card: CardDescription): string {
  return card.shows.map(({ label, value }) => `${label}: ${value}`).join("\n");
}

export function actionCardRequested(card: CardDescription, at: Date): NewActivityEntry {
  return { kind: "action_card_requested", title: `Buddy asked for an Action Permission: ${card.title}`, detail: cardLines(card), at };
}

export function actionApproved(card: CardDescription, at: Date): NewActivityEntry {
  return { kind: "action_approved", title: `You gave an Action Permission: ${card.title}`, detail: cardLines(card), at };
}

export function actionCardDeclined(card: CardDescription, at: Date): NewActivityEntry {
  return { kind: "action_card_declined", title: `You declined: ${card.title}`, detail: "Buddy dropped this step.", at };
}

export function actionCardExpired(card: CardDescription, at: Date): NewActivityEntry {
  return {
    kind: "action_card_expired",
    title: `An Action card expired: ${card.title}`,
    detail: "There was no Approve tap in time, so Buddy didn't do this.",
    at,
  };
}

export function actionCardReplaced(card: CardDescription, at: Date): NewActivityEntry {
  return {
    kind: "action_card_replaced",
    title: `Buddy changed an Action card: ${card.title}`,
    detail: "The old card no longer works, and the new one needs its own Approve tap.",
    at,
  };
}

/** Says nothing about what the card holds now, because that can't be trusted. Any reason is in words from Buddy's code. */
export function actionCardInvalid(at: Date, why?: string): NewActivityEntry {
  return {
    kind: "action_card_invalid",
    title: "An Action card stopped working",
    detail: why ?? "What Buddy had stored no longer matched what you were shown, so it didn't do this.",
    at,
  };
}

const FINISHED_TITLES: Record<StepResult["status"], string> = {
  done: "Buddy did this",
  not_run: "Buddy didn't do this",
  unknown: "Buddy can't tell whether this happened",
};

export function actionFinished({ status, outcome, detail }: StepResult, card: CardDescription, at: Date): NewActivityEntry {
  return {
    kind: `action_${status}`,
    title: `${FINISHED_TITLES[status]}: ${card.title}`,
    detail: detail ? `${outcome} ${detail}` : outcome,
    at,
  };
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

/** Keeps all the words as they were at the time, because the Student can change the Draft afterwards. */
function draftDetail(words: DraftWords): string {
  return `Subject: ${words.subject}\n\n${words.body}`;
}

export function draftWritten(contactName: string, words: DraftWords, at: Date): NewActivityEntry {
  return { kind: "draft_written", title: `Buddy wrote a Draft to ${contactName}`, detail: draftDetail(words), at };
}

export function draftEdited(contactName: string, words: DraftWords, at: Date): NewActivityEntry {
  return { kind: "draft_edited", title: `You edited the Draft to ${contactName}`, detail: draftDetail(words), at };
}

/** A Draft's words are masked when they're written and edited, and the card only ever held those. */
const emailDetail = ({ to, mode, contactName, subject, body }: EmailStep): string =>
  `To: ${to}${mode === "practice" ? ` (Practice mode, in place of ${contactName})` : ""}\nSubject: ${subject}\n\n${body}`;

/** Saved before Send is pressed, so that the record says so whatever happens next. */
export function emailSendStarted(email: EmailStep, at: Date): NewActivityEntry {
  return { kind: "email_send_started", title: `Buddy is about to press Send on an email to ${email.to}`, detail: emailDetail(email), at };
}

export function emailSent(email: EmailStep, at: Date): NewActivityEntry {
  return { kind: "email_sent", title: `Buddy sent an email from your TUmail to ${email.to}`, detail: emailDetail(email), at };
}

export function emailMaybeSent(email: EmailStep, at: Date): NewActivityEntry {
  return { kind: "email_maybe_sent", title: `Buddy may have sent an email from your TUmail to ${email.to}`, detail: emailDetail(email), at };
}

export function sendingModeChanged(mode: SendingMode, at: Date): NewActivityEntry {
  return mode === "live"
    ? { kind: "sending_mode_changed", title: "You switched to Live", detail: "What you approve Buddy to send now goes to the Contact it's written to.", at }
    : { kind: "sending_mode_changed", title: "You switched back to Practice mode", detail: "What you approve Buddy to send now goes to your own TUmail address.", at };
}

export function ownAddressSaved(address: string, at: Date): NewActivityEntry {
  return { kind: "own_address_saved", title: "You told Buddy your TUmail address", detail: `Practice emails go to ${address}.`, at };
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
export type ReadReason = "given" | "asked" | "schedule" | "conversation" | "logged_in";

const READ_REASONS: Record<ReadReason, string> = {
  given: "You had just given its Read Permission.",
  asked: "You tapped Read now.",
  schedule: "It was one of Buddy's regular read times.",
  conversation: "Buddy looked again during your conversation.",
  logged_in: "You had just logged in.",
};

/**
 * What's new says how many of what, never what they are, so that what's read doesn't outlive a revoke here.
 * A part it couldn't read is in words from Buddy's own code, so the record doesn't claim the whole read worked.
 */
export function connectionRead(connectionName: string, reason: ReadReason, at: Date, whatsNew?: string, missed?: string | null): NewActivityEntry {
  const detail = [READ_REASONS[reason], whatsNew && `What's new: ${whatsNew}.`, missed].filter(Boolean).join(" ");
  return { kind: "connection_read", title: `Buddy read ${connectionName}`, detail, at };
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
