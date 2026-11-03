import { createHash } from "node:crypto";
import {
  actionApproved,
  actionCardDeclined,
  actionCardExpired,
  actionCardInvalid,
  actionCardReplaced,
  actionCardRequested,
  actionFinished,
} from "./activity.ts";
import { describeInPhiladelphia, type Clock } from "./clock.ts";
import { THE_STUDENT, type ActionCardStatus, type NewActivityEntry, type Store, type StoredActionCard } from "./store.ts";

/** How long a card can wait for a tap. After this, it never runs. */
const CARD_LIFETIME_MS = 24 * 60 * 60_000;
/** How many of the latest cards Claude is told about with each turn. */
const CARDS_IN_TURN_NOTE = 5;

const STATUS_WORDS: Record<ActionCardStatus, string> = {
  waiting: "Waiting for your tap.",
  running: "Buddy is doing this now.",
  done: "Done.",
  not_run: "Buddy didn't do this.",
  unknown: "Buddy can't tell whether this happened. It won't try again, so please check.",
  declined: "You declined this.",
  expired: "This card has expired, so Buddy didn't do this.",
  replaced: "Buddy changed this, so this card no longer works.",
  invalid: "This card no longer matches what you were shown, so it no longer works.",
};

/** What Claude is told. These words are Buddy's own, so nothing on a page or a card can reach it this way. */
const STATUS_FOR_CLAUDE: Record<ActionCardStatus, string> = {
  waiting: "waiting for the Student's Approve tap, so nothing has happened",
  running: "approved by the Student's tap, and being done now",
  done: "approved by the Student's tap, and done",
  not_run: "approved by the Student's tap, but Buddy couldn't do it, so nothing happened",
  unknown: "approved by the Student's tap, but Buddy can't tell whether it happened, and it won't try again",
  declined: "declined by the Student, so drop that step",
  expired: "expired with no tap, so nothing happened",
  replaced: "replaced by a newer card",
  invalid: "stopped because its content changed, so nothing happened",
};

/** Why the Student's tap makes no new card, when one with the same content has got this far. */
const ALREADY_HAPPENED: Partial<Record<ActionCardStatus, string>> = {
  running: "Buddy is doing exactly this now, so it won't start it again.",
  done: "Buddy has already done exactly this, so it won't do it again. If you have more to say, change the words first.",
  unknown: "Buddy can't tell whether this happened, so it won't risk doing it twice. Please check first. If it didn't happen, you can do it yourself or change the words for a new card.",
};

export interface CardLine {
  label: string;
  value: string;
}

export interface CardDescription {
  title: string;
  /** Exactly what will happen, line by line. */
  shows: CardLine[];
  /** Only on an email from the Crisis card. It says whether the card should offer to switch to Live. */
  crisisEmail?: { offersLive: boolean };
}

/** One card as the app gets it. The app shows the words as they are. */
export interface ActionCard extends CardDescription {
  id: number;
  kind: string;
  status: ActionCardStatus;
  statusText: string;
  /** What the Student should know before they tap. */
  note: string | null;
  /** What happened in the end, in Buddy's words. */
  outcome: string | null;
  /** The Approve operation sends this back, to say which content the Student saw. */
  fingerprint: string;
  expiresAt: string;
  /** Whether Approve and Decline still mean anything. */
  canDecide: boolean;
}

/** How an approved step ended. */
export interface StepResult {
  /** "not_run" promises that nothing left the browser. If that can't be promised, it's "unknown". */
  status: "done" | "not_run" | "unknown";
  /** For the Student, on the card. */
  outcome: string;
  /** For the Student, in Activity, when there's more to say. */
  detail?: string;
  /** Saved to Activity along with what became of the card, so that one can't happen without the other. */
  alsoRecord?: NewActivityEntry[];
}

/**
 * One kind of step Buddy can take. This is the fixed routine the Approve tap runs, so everything it
 * does has to come from the content it's given, which is exactly what the card showed. Adding a kind
 * of action means adding one of these, and adding what Claude can ask for to its tool in system-prompt.ts.
 */
export interface ActionRoutine {
  kind: string;
  /**
   * Only the Student's own tap can make this kind of card. Claude's tool is refused it, and it doesn't
   * count towards Claude being offered that tool.
   */
  onlyTheStudentAsks?: boolean;
  /** Whether Buddy can ask for this at all right now. With no routine that can, Claude isn't offered the tool. */
  isAvailable(): boolean;
  /** Turns what Claude asked for into the exact content of a card. Throws ActionRefused. */
  prepare(input: unknown): unknown;
  /**
   * In words from Buddy's code. A value on a line may be what Claude asked for. A label or the title
   * must make plain which of Buddy's own lines it is, so that nothing Claude asks for can pass for one.
   */
  describe(content: unknown): CardDescription;
  /**
   * Says why a waiting card can't ever count now, because something it was made from has changed. The
   * card stops working and needs a new one. In words from Buddy's code, for the Student.
   */
  noLongerValid?(content: unknown): string | null;
  /** Says why an Approve can't start now, leaving the card waiting. Nothing is used up. */
  whyNotNow(): string | null;
  /** Carries the step out. Reads the card itself, so nothing can be slipped in on the way. */
  run(cardId: number): Promise<StepResult>;
}

/** Buddy won't make a card for this. The message is for Claude, in words from Buddy's code. */
export class ActionRefused extends Error {}

/** A tap that can't count, along with what the card looks like now. */
export class CardRefused extends Error {
  readonly card: ActionCard;

  constructor(message: string, card: ActionCard) {
    super(message);
    this.card = card;
  }
}

export interface ActionCards {
  /** Whether Buddy can ask for anything at all. */
  canAsk(): boolean;
  /**
   * The one way to make a card, and all that Claude's tool can do. It never runs the step.
   * With `replaces`, the old card stops working and the new one needs its own tap: that's what
   * editing a card means.
   */
  request(input: unknown, where: { afterMessageId: number; replaces?: number }): ActionCard;
  /**
   * Makes a card for a kind only the Student's tap can ask for. It never runs the step. The same
   * content gives back a card that's still waiting, and is refused once it's running, done or unknown.
   */
  requestFromStudent(input: unknown, where: { afterMessageId: number }): ActionCard;
  get(id: number): ActionCard | null;
  list(): { card: ActionCard; afterMessageId: number; createdAt: Date }[];
  /**
   * The Student's Approve tap, the only thing that gives an Action Permission. Only the paired
   * phone's route calls this, and nothing that passes through Claude ever does. Tapping again changes
   * nothing, and just answers with the card as it is. Throws CardRefused when the tap can't count.
   */
  approve(id: number, seenFingerprint: string): Promise<ActionCard | null>;
  /** The Student's Decline tap. Tapping again changes nothing. Throws CardRefused when it's too late. */
  decline(id: number): ActionCard | null;
  /** Ends any card whose time is up, or that can no longer count. Cards are only ever looked at through things that call this. */
  expireDue(): void;
  /**
   * For when the backend starts. A step left running was cut off, and nobody can say how far it got,
   * so it's never run again. A command run on the laptop mustn't call this, because the main backend
   * may be running that step at that moment.
   */
  endInterrupted(): void;
  /** What became of the latest cards, for Claude's note with each turn. */
  noteForTurn(): string;
}

export interface ActionCardsDeps {
  store: Store;
  clock: Clock;
  routines: ActionRoutine[];
  logError: (error: unknown) => void;
}

export function createActionCards({ store, clock, routines, logError }: ActionCardsDeps): ActionCards {
  function routineFor(kind: unknown): ActionRoutine {
    const routine = routines.find((candidate) => candidate.kind === kind);
    if (!routine) throw new ActionRefused("Buddy has no such action.");
    return routine;
  }

  /** A stored card that can't be described can't run either, but it mustn't stop the conversation loading. */
  function describe(stored: StoredActionCard): CardDescription {
    try {
      return routineFor(stored.kind).describe(JSON.parse(stored.content));
    } catch (error) {
      logError(error);
      return { title: "An Action card Buddy can't read", shows: [] };
    }
  }

  function toCard(stored: StoredActionCard): ActionCard {
    return {
      id: stored.id,
      kind: stored.kind,
      status: stored.status,
      statusText: STATUS_WORDS[stored.status],
      note:
        stored.status === "waiting"
          ? `You can approve this until ${describeInPhiladelphia(stored.expiresAt)}. Buddy will do it once, exactly as shown. If anything changes, it will ask you again.`
          : null,
      outcome: stored.outcome,
      fingerprint: stored.fingerprint,
      expiresAt: stored.expiresAt.toISOString(),
      canDecide: stored.status === "waiting",
      ...describe(stored),
    };
  }

  function prepareCard(input: unknown, afterMessageId: number) {
    const routine = routineFor((input as { kind?: unknown } | null)?.kind);
    const content = canonicalJson(routine.prepare(input));
    const createdAt = clock.now();
    return {
      kind: routine.kind,
      content,
      fingerprint: fingerprintOf(routine.kind, content),
      afterMessageId,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + CARD_LIFETIME_MS),
    };
  }

  /** Why a waiting card can't ever count now. A card that can't be read can't count either. */
  function whyNoLongerValid(stored: StoredActionCard): string | null {
    try {
      return routineFor(stored.kind).noLongerValid?.(JSON.parse(stored.content)) ?? null;
    } catch (error) {
      logError(error);
      return "What Buddy had stored no longer matched what you were shown, so it didn't do this.";
    }
  }

  function expireIfDue(stored: StoredActionCard): StoredActionCard {
    if (stored.status !== "waiting") return stored;
    const why = whyNoLongerValid(stored);
    const moved =
      clock.now() >= stored.expiresAt
        ? store.moveActionCard(THE_STUDENT, stored.id, "waiting", { status: "expired" }, [actionCardExpired(describe(stored), stored.expiresAt)])
        : why
          ? store.moveActionCard(THE_STUDENT, stored.id, "waiting", { status: "invalid", outcome: why }, [actionCardInvalid(clock.now(), why)])
          : stored;
    return moved ?? store.actionCard(THE_STUDENT, stored.id)!;
  }

  function current(id: number): StoredActionCard | null {
    const stored = store.actionCard(THE_STUDENT, id);
    return stored && expireIfDue(stored);
  }

  function replace(id: number, input: unknown, afterMessageId: number): ActionCard {
    const old = current(id);
    if (old?.status !== "waiting") throw new ActionRefused("That card is no longer waiting, so it can't be changed.");
    if (routineFor(old.kind).onlyTheStudentAsks) throw new ActionRefused("Only the Student can change that card.");
    const card = prepareCard(input, afterMessageId);
    const description = routineFor(card.kind).describe(JSON.parse(card.content));
    const replaced = store.replaceActionCard(THE_STUDENT, id, card, [
      actionCardReplaced(describe(old), card.createdAt),
      actionCardRequested(description, card.createdAt),
    ]);
    if (!replaced) throw new ActionRefused("That card is no longer waiting, so it can't be changed.");
    return toCard(replaced);
  }

  async function runStep(stored: StoredActionCard, routine: ActionRoutine): Promise<StoredActionCard> {
    let result: StepResult;
    try {
      result = await routine.run(stored.id);
    } catch (error) {
      // The routine couldn't promise that nothing left the browser, so neither can this.
      logError(error);
      result = { status: "unknown", outcome: "Something went wrong partway, so Buddy can't tell whether this happened." };
    }
    const finished = store.moveActionCard(
      THE_STUDENT,
      stored.id,
      "running",
      { status: result.status, outcome: result.outcome },
      [actionFinished(result, describe(stored), clock.now()), ...(result.alsoRecord ?? [])],
    );
    return finished ?? store.actionCard(THE_STUDENT, stored.id)!;
  }

  return {
    canAsk: () => routines.some((routine) => !routine.onlyTheStudentAsks && routine.isAvailable()),

    request(input, { afterMessageId, replaces }) {
      // Not the same as refusing a tap: Claude is told there's no such thing, as for any unknown kind.
      if (routineFor((input as { kind?: unknown } | null)?.kind).onlyTheStudentAsks) throw new ActionRefused("Buddy has no such action.");
      if (replaces !== undefined) return replace(replaces, input, afterMessageId);
      const card = prepareCard(input, afterMessageId);
      const description = routineFor(card.kind).describe(JSON.parse(card.content));
      return toCard(store.addActionCard(THE_STUDENT, card, actionCardRequested(description, card.createdAt)));
    },

    requestFromStudent(input, { afterMessageId }) {
      const card = prepareCard(input, afterMessageId);
      for (const same of store.listActionCards(THE_STUDENT).filter((stored) => stored.fingerprint === card.fingerprint)) {
        const latest = expireIfDue(same);
        if (latest.status === "waiting") return toCard(latest);
        const already = ALREADY_HAPPENED[latest.status];
        if (already) throw new ActionRefused(already);
      }
      const description = routineFor(card.kind).describe(JSON.parse(card.content));
      return toCard(store.addActionCard(THE_STUDENT, card, actionCardRequested(description, card.createdAt)));
    },

    get(id) {
      const stored = current(id);
      return stored && toCard(stored);
    },

    list() {
      return store.listActionCards(THE_STUDENT).map((stored) => {
        const latest = expireIfDue(stored);
        return { card: toCard(latest), afterMessageId: latest.afterMessageId, createdAt: latest.createdAt };
      });
    },

    async approve(id, seenFingerprint) {
      const stored = current(id);
      if (!stored) return null;
      const now = clock.now();

      // A retry after a dropped connection lands here, and so does a second tap. Neither runs anything.
      if (stored.approvedFingerprint !== null) return toCard(stored);
      if (stored.status !== "waiting") throw new CardRefused(STATUS_WORDS[stored.status], toCard(stored));

      if (fingerprintOf(stored.kind, stored.content) !== stored.fingerprint) {
        const invalid = store.moveActionCard(THE_STUDENT, id, "waiting", { status: "invalid" }, [actionCardInvalid(now)]);
        const after = invalid ?? store.actionCard(THE_STUDENT, id)!;
        throw new CardRefused(STATUS_WORDS[after.status], toCard(after));
      }
      if (seenFingerprint !== stored.fingerprint) {
        throw new CardRefused("This isn't what the card says now, so that tap can't count.", toCard(stored));
      }
      const routine = routineFor(stored.kind);
      const reason = routine.whyNotNow();
      if (reason) throw new CardRefused(reason, toCard(stored));

      // From here the tap is used up, so this card can't run again, whatever becomes of this request.
      const running = store.moveActionCard(
        THE_STUDENT,
        id,
        "waiting",
        { status: "running", approvedFingerprint: seenFingerprint },
        [actionApproved(describe(stored), now)],
      );
      if (!running) return toCard(store.actionCard(THE_STUDENT, id)!);
      return toCard(await runStep(running, routine));
    },

    decline(id) {
      const stored = current(id);
      if (!stored) return null;
      if (stored.status === "declined") return toCard(stored);
      const declined =
        stored.status === "waiting" &&
        store.moveActionCard(THE_STUDENT, id, "waiting", { status: "declined" }, [
          actionCardDeclined(describe(stored), clock.now()),
        ]);
      if (declined) return toCard(declined);
      const now = store.actionCard(THE_STUDENT, id)!;
      throw new CardRefused(STATUS_WORDS[now.status], toCard(now));
    },

    expireDue() {
      for (const stored of store.listActionCards(THE_STUDENT)) expireIfDue(stored);
    },

    endInterrupted() {
      for (const stored of store.listActionCards(THE_STUDENT)) {
        if (stored.status !== "running") continue;
        const result: StepResult = {
          status: "unknown",
          outcome: "The backend stopped partway through, so Buddy can't tell whether this happened.",
        };
        store.moveActionCard(THE_STUDENT, stored.id, "running", { status: result.status, outcome: result.outcome }, [
          actionFinished(result, describe(stored), clock.now()),
        ]);
      }
    },

    noteForTurn() {
      const latest = store.listActionCards(THE_STUDENT).slice(-CARDS_IN_TURN_NOTE).map(expireIfDue);
      if (latest.length === 0) return "";
      const lines = latest.map(
        (stored) => `Card ${stored.id}, "${describe(stored).title}": ${STATUS_FOR_CLAUDE[stored.status]}.`,
      );
      return `\n\nWhat became of your latest Action cards, from Buddy's own record:\n${lines.join("\n")}`;
    },
  };
}

/** Covers the kind and every part of the content, so any change at all makes a different one. */
export function fingerprintOf(kind: string, canonicalContent: string): string {
  return createHash("sha256").update(kind).update("\0").update(canonicalContent).digest("hex");
}

/** The same content always gives the same text, whatever order its keys were made in. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, inner) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([left], [right]) => (left < right ? -1 : 1)))
      : inner,
  );
}
