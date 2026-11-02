import { ActionRefused, type ActionCard, type ActionCards } from "./action-cards.ts";
import { newTurnRecord, noteFactsGiven, noteSourcesLookedAt, replyDecided, replyFailed, type TurnRecord } from "./activity.ts";
import { textOf, type Claude, type ClaudeMessage, type ClaudeRequest } from "./claude.ts";
import { describeInPhiladelphia, type Clock } from "./clock.ts";
import { NoReadPermission, type Connections } from "./connections.ts";
import type { CrisisCheck, CrisisOutcome } from "./crisis-check.ts";
import type { Draft, Drafts } from "./drafts.ts";
import { CANVAS_ID } from "./canvas-rules.ts";
import { GOOGLE_CALENDAR_ID } from "./google-calendar.ts";
import { sameName, type Guidebook, type GuidebookItem, type GuidebookKind } from "./guidebook.ts";
import { hiddenNote, maskSecrets } from "./masking.ts";
import { newMilestoneTurn, type ToolOutcome } from "./milestone-chat.ts";
import { describeProfile, type Profile } from "./profile.ts";
import type { StandardMilestone, StandardMilestones } from "./standard-milestones.ts";
import {
  BUDDY_SYSTEM_PROMPT,
  CHECK_CALENDAR_TOOL,
  CHECK_CANVAS_TOOL,
  CHECK_TUMAIL_TOOL,
  CRISIS_CARD_TOOL,
  FIND_CONTACTS_TOOL,
  MAKE_HANDOFF_TOOL,
  FIND_MILESTONES_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  SEARCH_GUIDEBOOK_TOOL,
  SHOW_GUIDEBOOK_CARDS_TOOL,
  SHOW_MILESTONE_CARDS_TOOL,
  SUGGEST_CONNECTION_TOOL,
} from "./system-prompt.ts";
import { THE_STUDENT, type NewMessage, type Store, type StoredMessage } from "./store.ts";
import { newMailTurn, noteMailGiven } from "./tumail-chat.ts";
import { TUMAIL_ID } from "./tumail-rules.ts";

const REFUSAL_NOTE =
  "I can't help with that one. Try asking another way, or tell me what you're trying to get done and I'll point you to someone at Temple who can help.";
const FAILURE_NOTE = "Something went wrong and I couldn't finish that reply. Please try again.";
// What Buddy says itself when Claude can't answer a Student who may be struggling. An error
// or "I can't help with that" is the wrong thing to read at that moment.
const CRISIS_NOTE =
  "I'm having trouble writing a reply right now, so please don't wait on me. The people on this card can help right now. You can keep writing to me here too.";
const CHECK_IN_NOTE =
  "It sounds like things might be hard right now. How are you doing? I'm an AI, so I can't take the place of a person, but I'm glad to listen and help you find someone at Temple to talk to.";

const TURN_INSTRUCTIONS: Record<CrisisOutcome, string> = {
  nothing: "",
  "check-in":
    " Buddy's safety check found the Student may be struggling, but it isn't clear. Gently check in and ask how they're doing, in a sentence or two, before anything else. Don't list crisis numbers unless what they say calls for it.",
  crisis: ` Buddy's safety check found the Student's safety may be at risk, and the app has already shown them the Crisis card, so don't call ${CRISIS_CARD_TOOL.name}. Reply briefly and with care, and encourage them to reach out to someone on the card.`,
};

/**
 * Goes in every turn as well as the system prompt, because in the system prompt alone Claude still
 * went back to a question it had asked when the Student moved on to something else.
 */
const QUESTIONS_REMINDER =
  "Any getting-to-know question you've already asked in this conversation is finished, whether or not the Student answered it. Don't ask it again unless they bring it up.";

/** In every turn for the same reason as the reminder above. */
const SOURCE_REMINDER =
  "Anything specific to Temple has to come from the Guidebook or the Standard Milestones, with its card shown, even if you said it earlier or feel sure of it. If it isn't there, say you couldn't find a Source and offer a Handoff.";

/** By number, because Claude has seen the numbers and a system message shouldn't carry a page's words. */
function reportedItemsNote(ids: number[]): string {
  if (ids.length === 0) return "";
  const items = ids.map((id) => `item ${id}`).join(", ");
  return ` These Guidebook items were reported as wrong or out of date, so don't use or mention what you saw about them earlier in this conversation: ${items}.`;
}

const NOTHING_IN_THE_GUIDEBOOK =
  `The Guidebook has nothing on that, so there's no Source for it. Tell the Student you couldn't find a Source, and don't answer from memory. Then use ${FIND_CONTACTS_TOOL.name} and offer a Handoff to whoever is most likely to know.`;

const NO_CONTACT_IN_THE_GUIDEBOOK =
  "The Guidebook has no Contact for those words. Try wider words, for whoever is most likely to know. A Handoff needs a Contact from the Guidebook, so if none fits, tell the Student you couldn't find one, and don't name one from memory.";

const HANDOFF_MADE =
  "The Contact's card and the Draft card are on the Student's screen. The Draft hasn't been sent, and only the Student can send it. The card says why you picked this Contact and that you can explain the issue yourself instead. Now reply in a sentence or two, without repeating the Draft.";

const COULD_NOT_SAVE_FACT = "Tried to save something to your Profile, but couldn't.";

/** A reply takes one request, or a few if Claude uses its tools first. This stops it looping. */
const MAX_REQUESTS_PER_TURN = 6;
/** Goes between what Claude wrote before a tool call and what it writes after. */
const ROUND_BREAK = "\n\n";

type ClaudeMessageParam = ClaudeRequest["messages"][number];
type ContentBlock = ClaudeMessage["content"][number];
type ToolCall = Extract<ContentBlock, { type: "tool_use" }>;

export interface ChatMessage {
  id: number;
  role: "student" | "buddy";
  text: string;
  sentAt: string;
  /** On a Student's message that had something hidden, what to tell them about it. */
  hiddenNote?: string;
}

/** The app draws the card from its own code. This only says where it goes. */
export interface CrisisCardEntry {
  type: "crisis_card";
  sentAt: string;
}

/** The app draws the card from what the backend says about this Connection. */
export interface ReadPermissionCardEntry {
  type: "read_permission_card";
  connection: string;
  sentAt: string;
}

/** A card as it should look now. Null once the item has been reported or has left its Source. */
export interface GuidebookCardEntry {
  type: "guidebook_card";
  item: GuidebookItem | null;
  sentAt: string;
}

/** An Action card as it stands now, in words from Buddy's code. */
export interface ActionCardEntry {
  type: "action_card";
  card: ActionCard;
  sentAt: string;
}

/** A Draft as it stands now, with the Student's edits. */
export interface DraftCardEntry {
  type: "draft_card";
  draft: Draft;
  sentAt: string;
}

/** A Standard Milestone's card as it should look now. Null once it's gone from its Source. */
export interface MilestoneCardEntry {
  type: "milestone_card";
  milestone: StandardMilestone | null;
  sentAt: string;
}

export type ConversationEvent =
  /** The Student's message had something hidden. This is the message as Buddy kept it. */
  | { type: "hidden"; text: string; note: string }
  | { type: "text"; text: string }
  | { type: "crisis_card" }
  | { type: "read_permission_card"; connection: string }
  | { type: "guidebook_card"; item: GuidebookItem }
  | { type: "action_card"; card: ActionCard }
  | { type: "draft_card"; draft: Draft }
  | { type: "milestone_card"; milestone: StandardMilestone }
  | { type: "done"; reply: ChatMessage }
  | { type: "error"; message: string };

export interface Conversation {
  /**
   * Takes the Student's message as they typed it, and returns the stream of events for Buddy's
   * turn. Everything after the first step of the turn sees only the masked text.
   * Drain it to the end even if the app has gone away, so that the reply is still saved.
   */
  send(text: string): AsyncGenerator<ConversationEvent>;
  history(): (ChatMessage | CrisisCardEntry | ReadPermissionCardEntry | GuidebookCardEntry | ActionCardEntry | DraftCardEntry | MilestoneCardEntry)[];
}

export interface ConversationDeps {
  claude: Claude;
  clock: Clock;
  store: Store;
  chatModel: string;
  crisisCheck: CrisisCheck;
  profile: Profile;
  connections: Connections;
  guidebook: Guidebook;
  actionCards: ActionCards;
  drafts: Drafts;
  milestones: StandardMilestones;
  logError: (error: unknown) => void;
}

export function createConversation(deps: ConversationDeps): Conversation {
  const { claude, clock, store, chatModel, crisisCheck, profile, connections, guidebook, actionCards, drafts, milestones, logError } = deps;
  const waitForTurn = oneTurnAtATime();

  /** The Student has seen this message, and the turn's tools may have done things before it failed. */
  function recordFailedTurn(shown: string, turn: TurnRecord): void {
    try {
      store.addActivity(THE_STUDENT, replyFailed(shown, turn, clock.now()));
    } catch (error) {
      logError(error);
    }
  }

  /** Ends a turn Claude didn't finish. Saving can be what failed, so that can't stop the note. */
  function endTurnWithoutClaude(note: string | null, now: Date, turn: TurnRecord): ConversationEvent {
    if (!note) {
      recordFailedTurn(FAILURE_NOTE, turn);
      return { type: "error", message: FAILURE_NOTE };
    }
    turn.tools.push("The AI's reply didn't come through, so Buddy wrote this note itself.");
    try {
      const [saved] = store.appendMessages(
        THE_STUDENT,
        [
          {
            role: "assistant",
            content: [{ type: "text", text: note, citations: null }],
            stopReason: "end_turn",
            createdAt: now,
          },
        ],
        replyDecided(note, turn, clock.now()),
      );
      return { type: "done", reply: toChatMessage(saved!) };
    } catch (error) {
      logError(error);
      recordFailedTurn(note, turn);
      return { type: "error", message: note };
    }
  }

  /** A Connection's tool: what Buddy has from it, read again first if that's what was asked. */
  async function lookAtConnection(
    call: ToolCall,
    turn: TurnRecord,
    id: string,
    name: string,
    couldNotCheck: string,
    noteFacts = noteFactsGiven,
  ) {
    try {
      let looked = `Looked at what Buddy has from your ${name}.`;
      if ((call.input as { read_again?: unknown } | null)?.read_again === true) {
        // A read that fails shows in the description, which falls back on the last reading.
        const { lastReadProblem } = await connections.read(id, "conversation");
        looked = lastReadProblem
          ? `Tried to read your ${name} again but couldn't, so looked at the last reading.`
          : `Read your ${name} again and looked at it.`;
      }
      const description = connections.describeForClaude(id);
      turn.tools.push(looked);
      noteFacts(turn, factsFromConnection(profile, id));
      return toolAnswer(call, description);
    } catch (error) {
      if (error instanceof NoReadPermission) {
        turn.tools.push(`Tried to look at your ${name}, but it isn't connected.`);
        return toolFailure(
          call,
          `The Student hasn't given ${name} a Read Permission, so you can't see it. Use ${SUGGEST_CONNECTION_TOOL.name} if it would help.`,
        );
      }
      logError(error);
      turn.tools.push(`Tried to look at your ${name}, but something went wrong.`);
      return toolFailure(call, couldNotCheck);
    }
  }

  /** The card that asks for a Takeover is the Read Permission card, which follows the Connection's state. */
  function askForLoginIfNeeded(id: string, suggestedThisTurn: Set<string>, afterMessageId: number, now: Date): string | null {
    const connection = connections.list().find((candidate) => candidate.id === id);
    if (!connection?.on || !connection.needsLogin || suggestedThisTurn.has(id)) return null;
    suggestedThisTurn.add(id);
    try {
      store.addReadPermissionCard(THE_STUDENT, { connection: id, afterMessageId, createdAt: now });
    } catch (error) {
      logError(error);
    }
    return id;
  }

  /** The card appears only for a Connection Buddy has that's still off. */
  function suggestConnection(
    call: ToolCall,
    suggestedThisTurn: Set<string>,
    afterMessageId: number,
    now: Date,
    turn: TurnRecord,
  ) {
    const id = (call.input as { connection?: unknown } | null)?.connection;
    const connection = connections.list().find((candidate) => candidate.id === id);
    if (!connection) {
      turn.tools.push("Tried to show a Read Permission card for a Connection Buddy doesn't have.");
      return { answer: toolFailure(call, "There's no such Connection.") };
    }
    if (connection.on) {
      turn.tools.push(`Didn't show the Read Permission card for ${connection.name}, because it's already connected.`);
      return { answer: toolFailure(call, `${connection.name} is already connected, so there's nothing to suggest.`) };
    }
    const onScreen = toolAnswer(call, "The card is on the Student's screen. Only their tap on it gives the Read Permission. Now reply to them.");
    if (suggestedThisTurn.has(connection.id)) return { answer: onScreen };
    suggestedThisTurn.add(connection.id);
    turn.tools.push(`Showed you the Read Permission card for ${connection.name}.`);
    try {
      store.addReadPermissionCard(THE_STUDENT, { connection: connection.id, afterMessageId, createdAt: now });
    } catch (error) {
      logError(error);
    }
    return { answer: onScreen, card: connection.id };
  }

  function searchGuidebook(call: ToolCall, turn: TurnRecord, kind?: GuidebookKind) {
    const query = (call.input as { query?: unknown } | null)?.query;
    const lookedFor = kind === "contact" ? "Looked for Contacts" : "Searched the Guidebook";
    if (typeof query !== "string" || query.trim() === "") {
      turn.tools.push(`${lookedFor}, but with nothing to look for.`);
      return toolFailure(call, "query must be a non-empty string.");
    }
    try {
      const items = guidebook.search(query, kind ? { kind } : {});
      turn.tools.push(`${lookedFor} for ${JSON.stringify(query)} and found ${items.length}.`);
      noteSourcesLookedAt(turn, items.flatMap((item) => item.sources));
      if (items.length > 0) return toolAnswer(call, guidebook.describeForClaude(items));
      return toolAnswer(call, kind === "contact" ? NO_CONTACT_IN_THE_GUIDEBOOK : NOTHING_IN_THE_GUIDEBOOK);
    } catch (error) {
      logError(error);
      turn.tools.push(`${lookedFor}, but something went wrong.`);
      return toolFailure(call, "The Guidebook couldn't be searched, so you have no Source. Tell the Student, and don't answer from memory.");
    }
  }

  /** Returns the cards the Student hasn't seen yet this turn, saved so that they come back with the conversation. */
  function addCards(items: GuidebookItem[], shownThisTurn: Map<number, string>, afterMessageId: number, now: Date, turn: TurnRecord) {
    const fresh = items.filter((item) => !shownThisTurn.has(item.id));
    for (const item of fresh) {
      shownThisTurn.set(item.id, item.name);
      turn.tools.push(`Showed you the card for ${JSON.stringify(item.name)}.`);
      noteSourcesLookedAt(turn, item.sources);
      try {
        store.addGuidebookCard(THE_STUDENT, { itemId: item.id, afterMessageId, createdAt: now });
      } catch (error) {
        logError(error);
      }
    }
    return fresh;
  }

  function showGuidebookCards(call: ToolCall, shownThisTurn: Map<number, string>, afterMessageId: number, now: Date, turn: TurnRecord) {
    const asked = (call.input as { item_ids?: unknown } | null)?.item_ids;
    const ids = Array.isArray(asked) ? asked.filter((id): id is number => typeof id === "number") : [];
    const items = guidebook.itemsWithIds(ids);
    const cards = addCards(items, shownThisTurn, afterMessageId, now, turn);
    if (items.length < new Set(ids).size || ids.length === 0) {
      return {
        cards,
        answer: toolFailure(call, "At least one of those isn't in the Guidebook, because it was reported or has left its Source. Don't mention it."),
      };
    }
    return { cards, answer: toolAnswer(call, "The cards are on the Student's screen, each with its Source. Now reply to them.") };
  }

  /** Only ever makes a card. Nothing Claude can call gives the Action Permission or runs a step. */
  function requestAction(call: ToolCall, askedThisTurn: Map<string, number>, afterMessageId: number, turn: TurnRecord) {
    const asked = JSON.stringify(call.input);
    const earlier = askedThisTurn.get(asked);
    if (earlier !== undefined) return { answer: toolAnswer(call, actionCardOnScreen(earlier)) };
    const replaces = (call.input as { replaces_card?: unknown } | null)?.replaces_card;
    try {
      const card = actionCards.request(call.input, {
        afterMessageId,
        ...(typeof replaces === "number" ? { replaces } : {}),
      });
      askedThisTurn.set(asked, card.id);
      turn.tools.push(`Asked for your Approve on an Action card: ${card.title}`);
      return { answer: toolAnswer(call, actionCardOnScreen(card.id)), card };
    } catch (error) {
      turn.tools.push("Tried to ask for an Action card, but Buddy refused it.");
      if (error instanceof ActionRefused) return { answer: toolFailure(call, `${error.message} No card was shown.`) };
      logError(error);
      return { answer: toolFailure(call, "The card couldn't be made. No card was shown, so tell the Student.") };
    }
  }

  /** The Contact's card goes first, so that the Draft comes with who it's to and their Source. */
  function makeHandoff(call: ToolCall, shownThisTurn: Map<number, string>, afterMessageId: number, now: Date, turn: TurnRecord) {
    const { contact_id: contactId, why, subject, body } = (call.input ?? {}) as Record<string, unknown>;
    if (![why, subject, body].every((words) => typeof words === "string" && words.trim() !== "")) {
      turn.tools.push("Tried to write a Draft, but with nothing to say.");
      return { answer: toolFailure(call, "why, subject and body must each say something.") };
    }
    const contact = guidebook.itemsWithIds([contactId as number])[0];
    if (!contact) {
      turn.tools.push("Tried to write a Draft to a Contact that isn't in the Guidebook.");
      return { answer: toolFailure(call, "That isn't in the Guidebook, because it was reported or has left its Source. Don't mention it.") };
    }
    if (contact.kind !== "contact") {
      turn.tools.push("Tried to write a Draft to something that isn't a Contact.");
      return { answer: toolFailure(call, `That isn't a Contact. Use ${FIND_CONTACTS_TOOL.name} to find one.`) };
    }
    const cards = addCards([contact], shownThisTurn, afterMessageId, now, turn);
    try {
      const draft = drafts.write({ contact, why: why as string, subject: subject as string, body: body as string, afterMessageId });
      turn.tools.push(`Wrote a Draft to ${JSON.stringify(contact.name)}.`);
      return { cards, draft, answer: toolAnswer(call, HANDOFF_MADE) };
    } catch (error) {
      logError(error);
      turn.tools.push(`Tried to write a Draft to ${JSON.stringify(contact.name)}, but couldn't save it.`);
      return { cards, answer: toolFailure(call, "The Draft couldn't be saved. Tell the Student, and don't say you wrote it.") };
    }
  }

  async function answerCall(call: ToolCall, originMessageId: number, turn: TurnRecord) {
    if (call.name === CHECK_CALENDAR_TOOL.name) {
      return lookAtConnection(
        call,
        turn,
        GOOGLE_CALENDAR_ID,
        "Google Calendar",
        "The calendar couldn't be checked. Tell the Student, and don't guess at their schedule.",
      );
    }
    if (call.name === CHECK_CANVAS_TOOL.name) {
      return lookAtConnection(
        call,
        turn,
        CANVAS_ID,
        "Canvas",
        "Canvas couldn't be checked. Tell the Student, and don't guess at what's due or what their grades are.",
      );
    }
    if (call.name === CHECK_TUMAIL_TOOL.name) {
      return lookAtConnection(
        call,
        turn,
        TUMAIL_ID,
        "TUmail",
        "TUmail couldn't be checked. Tell the Student, and don't guess at what's in their mail.",
        noteMailGiven,
      );
    }
    if (call.name === SEARCH_GUIDEBOOK_TOOL.name) return searchGuidebook(call, turn);
    if (call.name === FIND_CONTACTS_TOOL.name) return searchGuidebook(call, turn, "contact");
    if (call.name === CRISIS_CARD_TOOL.name) {
      return toolAnswer(call, "The Crisis card is on the Student's screen. Now reply to them.");
    }
    if (call.name !== REMEMBER_TOOL.name) {
      turn.tools.push("Tried to use a tool Buddy doesn't have.");
      return toolFailure(call, `There's no tool called ${call.name}.`);
    }

    const fact = (call.input as { fact?: unknown } | null)?.fact;
    if (typeof fact !== "string" || fact.trim() === "") {
      turn.tools.push(COULD_NOT_SAVE_FACT);
      return toolFailure(call, "fact must be a non-empty string.");
    }
    try {
      const saved = profile.remember(fact, { messageId: originMessageId });
      turn.tools.push(`Saved this to your Profile: ${JSON.stringify(saved.text)}`);
      return toolAnswer(call, "Saved to the Profile. Carry on with your reply.");
    } catch (error) {
      logError(error);
      turn.tools.push(COULD_NOT_SAVE_FACT);
      return toolFailure(call, "This couldn't be saved. Carry on with your reply, and don't say it was saved.");
    }
  }

  return {
    async *send(typed) {
      const endTurn = await waitForTurn();
      const text = maskSecrets(typed);
      const now = clock.now();
      let cardShown = false;
      let checkingIn = false;
      const suggestedThisTurn = new Set<string>();
      const cardsThisTurn = new Map<number, string>();
      const actionsAskedThisTurn = new Map<string, number>();
      let handoffMade = false;
      const turn = newTurnRecord();
      const mailTurn = newMailTurn(turn);
      const noteIfClaudeCant = () => (cardShown ? CRISIS_NOTE : checkingIn ? CHECK_IN_NOTE : null);

      try {
        const note = hiddenNote(text);
        if (note) yield { type: "hidden", text, note };

        // A failed save holds until the check has run, because the card doesn't depend on saving.
        let studentMessageId: number | undefined;
        let saveFailure: unknown;
        try {
          [{ id: studentMessageId }] = store.appendMessages(THE_STUDENT, [
            { role: "user", content: [{ type: "text", text }], createdAt: now },
          ]) as [StoredMessage];
        } catch (error) {
          saveFailure = error;
        }

        const showCard = (shownBy: string) => {
          cardShown = true;
          turn.tools.push(shownBy);
          try {
            if (studentMessageId !== undefined) {
              store.addCrisisCard(THE_STUDENT, { afterMessageId: studentMessageId, createdAt: now });
            }
          } catch (error) {
            logError(error);
          }
          return { type: "crisis_card" } as const;
        };

        const outcome = await crisisCheck.check(text);
        if (outcome === "crisis") yield showCard("Buddy's safety check showed you the Crisis card.");
        checkingIn = outcome === "check-in";
        if (checkingIn) turn.tools.push("Buddy's safety check asked it to check in with you.");
        if (saveFailure) throw saveFailure;

        const factsGiven = factsToldToBuddy(profile);
        noteFactsGiven(turn, factsGiven);
        const lastReply = store.listMessages(THE_STUDENT).findLast((message) => message.role === "assistant");
        const turnContext = {
          role: "system" as const,
          content: `${describeCurrentTime(now)}${TURN_INSTRUCTIONS[outcome]}\n\n${describeProfile(factsGiven)}\n\n${connections.describeForTurn()}\n\n${SOURCE_REMINDER}${reportedItemsNote(guidebook.reportedItemIds())}${drafts.newestEditNote(lastReply?.createdAt)}\n\n${QUESTIONS_REMINDER}${actionCards.noteForTurn()}`,
        };
        const milestoneTurn = newMilestoneTurn({ milestones, store, logError, afterMessageId: studentMessageId!, now, turn });
        const history = [...toClaudeMessages(store.listMessages(THE_STUDENT)), turnContext];
        const toolRounds: NewMessage[] = [];
        // What Claude wrote before its tool calls this turn. The Student watched it arrive, so it
        // stays part of the reply, and it may be the whole reply if Claude has nothing to add.
        let wordsSoFar = "";

        for (let requests = 0; requests < MAX_REQUESTS_PER_TURN; requests++) {
          const request = chatRequest(chatModel, [...history, ...toClaudeMessages(toolRounds)], actionCards.canAsk());
          let wroteThisRound = false;
          for await (const event of claude.stream(request)) {
            if (event.type === "text") {
              if (wordsSoFar && !wroteThisRound) yield { type: "text", text: ROUND_BREAK };
              wroteThisRound = true;
              yield event;
              continue;
            }

            const { message } = event;
            const reply = {
              role: "assistant" as const,
              content: message.content,
              stopReason: message.stop_reason,
              createdAt: now,
            };
            if (message.stop_reason === "refusal") {
              // Tool rounds are left out too: Claude's history can't end on an unanswered call.
              const refused = { ...reply, shownText: noteIfClaudeCant() };
              turn.tools.push("The AI declined to answer, so Buddy showed a note of its own.");
              const [saved] = store.appendMessages(
                THE_STUDENT,
                [refused],
                replyDecided(wordsShownFor(refused), turn, clock.now()),
              );
              yield { type: "done", reply: toChatMessage(saved!) };
              return;
            }
            if (message.stop_reason === "tool_use") {
              const calls = toolCallsIn(message.content);
              if (!cardShown && calls.some((call) => call.name === CRISIS_CARD_TOOL.name)) {
                yield showCard("Showed you the Crisis card.");
              }
              const answers = [];
              for (const call of calls) {
                const refusedAfterMail = mailTurn.refusal(call.name);
                if (refusedAfterMail) {
                  answers.push(toolFailure(call, refusedAfterMail));
                } else if (call.name === SUGGEST_CONNECTION_TOOL.name) {
                  const { answer, card } = suggestConnection(call, suggestedThisTurn, studentMessageId!, now, turn);
                  if (card) yield { type: "read_permission_card", connection: card };
                  answers.push(answer);
                } else if (call.name === SHOW_GUIDEBOOK_CARDS_TOOL.name) {
                  const { answer, cards } = showGuidebookCards(call, cardsThisTurn, studentMessageId!, now, turn);
                  for (const item of cards) yield { type: "guidebook_card", item };
                  answers.push(answer);
                } else if (call.name === REQUEST_ACTION_TOOL.name) {
                  const { answer, card } = requestAction(call, actionsAskedThisTurn, studentMessageId!, turn);
                  if (card) yield { type: "action_card", card };
                  answers.push(answer);
                } else if (call.name === MAKE_HANDOFF_TOOL.name) {
                  if (handoffMade) {
                    answers.push(toolFailure(call, "You've made this reply's one Handoff, so don't make another. Now reply to the Student."));
                    continue;
                  }
                  const { answer, cards = [], draft } = makeHandoff(call, cardsThisTurn, studentMessageId!, now, turn);
                  for (const item of cards) yield { type: "guidebook_card", item };
                  if (draft) yield { type: "draft_card", draft };
                  handoffMade = draft !== undefined;
                  answers.push(answer);
                } else if (call.name === FIND_MILESTONES_TOOL.name) {
                  answers.push(toolResultFrom(call, milestoneTurn.find(call.input)));
                } else if (call.name === SHOW_MILESTONE_CARDS_TOOL.name) {
                  const { cards, ...outcome } = milestoneTurn.show(call.input);
                  for (const milestone of cards) yield { type: "milestone_card", milestone };
                  answers.push(toolResultFrom(call, outcome));
                } else {
                  const answer = await answerCall(call, studentMessageId!, turn);
                  answers.push(answer);
                  if (call.name === CHECK_CANVAS_TOOL.name) {
                    const card = askForLoginIfNeeded(CANVAS_ID, suggestedThisTurn, studentMessageId!, now);
                    if (card) yield { type: "read_permission_card", connection: card };
                  }
                  if (call.name === CHECK_TUMAIL_TOOL.name) {
                    if (!("is_error" in answer)) mailTurn.noteRead(call.id);
                    const card = askForLoginIfNeeded(TUMAIL_ID, suggestedThisTurn, studentMessageId!, now);
                    if (card) yield { type: "read_permission_card", connection: card };
                  }
                }
              }
              toolRounds.push(reply, { role: "user", content: answers, createdAt: now });
              wordsSoFar = joinWords(wordsSoFar, textOf(message.content));
              continue;
            }
            // Cut off mid-call, say by max_tokens. Saved, the call would go unanswered in every later request.
            if (toolCallsIn(message.content).length > 0) {
              throw new Error(`Claude's reply ended in a tool call (stop reason: ${message.stop_reason})`);
            }
            const words = joinWords(wordsSoFar, textOf(message.content));
            if (words.trim() === "") {
              throw new Error(`Claude's reply had no text (stop reason: ${message.stop_reason})`);
            }
            // Whatever Claude did about cards, an item the reply names is shown with its Source. Next
            // to the Crisis card, which has what the Student needs, more cards would only get in the way.
            if (!cardShown) {
              try {
                const shownNames = [...cardsThisTurn.values()];
                const unshown = guidebook.itemsNamedIn(words).filter((item) => !shownNames.some((name) => sameName(name, item.name)));
                const named = addCards(unshown, cardsThisTurn, studentMessageId!, now, turn);
                for (const item of named) yield { type: "guidebook_card", item };
              } catch (error) {
                logError(error);
              }
            }
            // The same for a date the reply gives, which is never given without its Source.
            if (!cardShown) {
              for (const milestone of milestoneTurn.cardsForReply(words)) yield { type: "milestone_card", milestone };
            }
            // Saved together so a system message is always followed by an assistant
            // turn, as the API requires, even when a turn fails partway through.
            const saved = store.appendMessages(
              THE_STUDENT,
              [
                { role: "system", content: turnContext.content, createdAt: now },
                ...mailTurn.forHistory([...toolRounds, wordsSoFar ? { ...reply, shownText: words } : reply]),
              ],
              replyDecided(words, turn, clock.now()),
            );
            yield { type: "done", reply: toChatMessage(saved.at(-1)!) };
            return;
          }
        }
        throw new Error(`Claude was still calling tools after ${MAX_REQUESTS_PER_TURN} requests`);
      } catch (error) {
        logError(error);
        yield endTurnWithoutClaude(noteIfClaudeCant(), now, turn);
      } finally {
        endTurn();
      }
    },

    history() {
      const cards = store.listCrisisCards(THE_STUDENT);
      const readPermissionCards = store.listReadPermissionCards(THE_STUDENT);
      const guidebookCards = store.listGuidebookCards(THE_STUDENT);
      const itemsOnCards = guidebook.itemsWithIds(guidebookCards.map((card) => card.itemId));
      const actionCardsSoFar = actionCards.list();
      const draftCards = drafts.list();
      const milestoneCards = store.listMilestoneCards(THE_STUDENT);
      const milestonesOnCards = milestones.withIds(milestoneCards.map((card) => card.milestoneId));
      return store
        .listMessages(THE_STUDENT)
        .filter(isShownToStudent)
        .flatMap((message) => [
          toChatMessage(message),
          ...cards
            .filter((card) => card.afterMessageId === message.id)
            .map((card) => ({ type: "crisis_card" as const, sentAt: card.createdAt.toISOString() })),
          ...readPermissionCards
            .filter((card) => card.afterMessageId === message.id)
            .map((card) => ({
              type: "read_permission_card" as const,
              connection: card.connection,
              sentAt: card.createdAt.toISOString(),
            })),
          ...guidebookCards
            .filter((card) => card.afterMessageId === message.id)
            .map((card) => ({
              type: "guidebook_card" as const,
              item: itemsOnCards.find((item) => item.id === card.itemId) ?? null,
              sentAt: card.createdAt.toISOString(),
            })),
          ...milestoneCards
            .filter((card) => card.afterMessageId === message.id)
            .map((card) => ({
              type: "milestone_card" as const,
              milestone: milestonesOnCards.find((milestone) => milestone.id === card.milestoneId) ?? null,
              sentAt: card.createdAt.toISOString(),
            })),
          ...actionCardsSoFar
            .filter(({ afterMessageId }) => afterMessageId === message.id)
            .map(({ card, createdAt }) => ({
              type: "action_card" as const,
              card,
              sentAt: createdAt.toISOString(),
            })),
          // Last, so that a Draft follows its Contact's card, as it did when it first appeared.
          ...draftCards
            .filter((card) => card.afterMessageId === message.id)
            .map(({ afterMessageId: _, ...draft }) => ({ type: "draft_card" as const, draft, sentAt: draft.createdAt })),
        ]);
    },
  };
}

/**
 * The constraints here come from the Claude API docs for Sonnet 5.5. The system prompt and
 * tool list stay frozen, and leaving tool_choice unset means automatic tool choice. They can
 * still change between versions of Buddy, which would make the API reject the thinking blocks
 * in a saved conversation. drop_block has it drop them instead, so the conversation carries on.
 */
function chatRequest(model: string, messages: ClaudeMessageParam[], canAskForActions: boolean): ClaudeRequest {
  return {
    model,
    max_tokens: 64000,
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
    output_config: { effort: "low" },
    cache_control: { type: "ephemeral" },
    betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
    fallbacks: "default",
    system: BUDDY_SYSTEM_PROMPT,
    tools: [
      CRISIS_CARD_TOOL,
      REMEMBER_TOOL,
      CHECK_CALENDAR_TOOL,
      CHECK_CANVAS_TOOL,
      CHECK_TUMAIL_TOOL,
      SUGGEST_CONNECTION_TOOL,
      SEARCH_GUIDEBOOK_TOOL,
      FIND_CONTACTS_TOOL,
      SHOW_GUIDEBOOK_CARDS_TOOL,
      ...(canAskForActions ? [REQUEST_ACTION_TOOL] : []),
      MAKE_HANDOFF_TOOL,
      FIND_MILESTONES_TOOL,
      SHOW_MILESTONE_CARDS_TOOL,
    ],
    messages,
  };
}

/** The calls that need an answer. Any from before a fallback aren't sent back, so they get none. */
function toolCallsIn(blocks: ContentBlock[]) {
  return blocksToResend(blocks).filter((block) => block.type === "tool_use");
}

function toolAnswer(call: ToolCall, content: string) {
  return { type: "tool_result", tool_use_id: call.id, content };
}

function toolFailure(call: ToolCall, content: string) {
  return { type: "tool_result", tool_use_id: call.id, is_error: true, content };
}

function actionCardOnScreen(id: number): string {
  return `Card ${id} is on the Student's screen. Nothing has happened: only their Approve tap on it lets Buddy do this, and a typed yes never counts. Now reply to them.`;
}

function toolResultFrom(call: ToolCall, outcome: ToolOutcome) {
  return outcome.isError ? toolFailure(call, outcome.content) : toolAnswer(call, outcome.content);
}

function joinWords(earlier: string, later: string): string {
  return [earlier, later].filter((words) => words.trim() !== "").join(ROUND_BREAK);
}

/** Tool rounds are for Claude. The Student sees the reply they led to, and the card. */
function isShownToStudent(message: StoredMessage): boolean {
  if (message.role === "system" || message.stopReason === "tool_use") return false;
  return message.role === "assistant" || textOf(message.content as ContentBlock[]) !== "";
}

/**
 * Rebuilds what Claude sees from the stored record. Everything is sent as it was stored, so
 * each request starts with the one before it. A refused turn is left out along with the
 * Student's messages that led to it: the API docs say to remove the turn before continuing,
 * or else later requests keep being refused. The Student's own record keeps it.
 */
function toClaudeMessages(stored: NewMessage[]): ClaudeMessageParam[] {
  const messages: ClaudeMessageParam[] = [];
  let currentTurn: ClaudeMessageParam[] = [];

  for (const message of stored) {
    if (message.stopReason === "refusal") {
      currentTurn = [];
    } else if (message.role === "assistant") {
      const content = blocksToResend(message.content as ContentBlock[]);
      messages.push(...currentTurn);
      currentTurn = [];
      // Claude can end a turn with nothing to add after a tool, and the API won't take that back.
      // What came before it stays, so that a refusal next turn can't drop the tool's answer.
      if (content.some((block) => block.type !== "thinking" && block.type !== "redacted_thinking")) {
        messages.push({ role: "assistant", content } as ClaudeMessageParam);
      }
    } else {
      currentTurn.push({ role: message.role, content: message.content } as ClaudeMessageParam);
    }
  }
  return [...messages, ...currentTurn];
}

/**
 * After a fallback model takes over mid-reply, the API wants thinking and tool calls from
 * before the final fallback block left out. Buddy's tools run on its own side, so only text
 * and the fallback marker itself survive from before that point.
 */
function blocksToResend(blocks: ContentBlock[]): ContentBlock[] {
  const lastFallback = blocks.findLastIndex((block) => block.type === "fallback");
  return blocks.filter(
    (block, index) => index > lastFallback || block.type === "text" || block.type === "fallback",
  );
}

function describeCurrentTime(now: Date): string {
  return `The current time in Philadelphia is ${describeInPhiladelphia(now)}.`;
}

/** A calendar or a term of Canvas can run to dozens of lines, so Claude gets those from a tool, when it needs them. */
function factsToldToBuddy(profile: Profile) {
  return profile.list().filter((fact) => fact.origin.type === "conversation");
}

function factsFromConnection(profile: Profile, id: string) {
  return profile.list().filter((fact) => fact.origin.type === "connection" && fact.origin.connection === id);
}

function wordsShownFor(message: NewMessage): string {
  return (
    message.shownText ??
    (message.stopReason === "refusal" ? REFUSAL_NOTE : textOf(message.content as ContentBlock[]))
  );
}

function toChatMessage(message: StoredMessage): ChatMessage {
  const text = wordsShownFor(message);
  const note = message.role === "user" ? hiddenNote(text) : null;
  return {
    id: message.id,
    role: message.role === "user" ? "student" : "buddy",
    text,
    sentAt: message.createdAt.toISOString(),
    ...(note ? { hiddenNote: note } : {}),
  };
}

/** Returns a function that waits for earlier turns to finish, then gives back this turn's release. */
function oneTurnAtATime(): () => Promise<() => void> {
  let lastTurn = Promise.resolve();
  return async () => {
    const previousTurn = lastTurn;
    let release!: () => void;
    lastTurn = new Promise((resolve) => (release = resolve));
    await previousTurn;
    return release;
  };
}
