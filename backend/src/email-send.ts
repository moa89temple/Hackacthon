import { ActionRefused, type ActionRoutine, type CardDescription, type StepResult } from "./action-cards.ts";
import { emailMaybeSent, emailSendStarted, emailSent } from "./activity.ts";
import { NoActionPermission, TakeoverInProgress, type BrowserAccess, type Site } from "./browser-access.ts";
import { PageBlocked, SEND_EMAIL, type EmailSending, type EmailStep } from "./buddys-browser.ts";
import type { Clock } from "./clock.ts";
import type { Draft, Drafts } from "./drafts.ts";
import { hiddenNote } from "./masking.ts";
import type { Sending } from "./sending.ts";
import { THE_STUDENT, type Store } from "./store.ts";
import { addressesIn } from "./tumail-rules.ts";

const NOTHING_SENT = "Nothing was sent.";
const NEW_CARD = "Tap Buddy sends it again for a new card.";

export interface EmailSendDeps {
  sites: Record<string, Site>;
  drafts: Pick<Drafts, "list">;
  sending: Pick<Sending, "settings">;
  browserAccess: Pick<BrowserAccess, "sendApprovedEmail" | "currentTakeover">;
  hasReadPermission: (siteId: string) => boolean;
  store: Store;
  clock: Clock;
  logError: (error: unknown) => void;
}

/** The one address Buddy has for a Contact. Where a page wrote more than one, there's no telling which is right. */
function contactAddress(draft: Draft): { address: string } | { problem: string } {
  const contact = draft.contact;
  if (!contact) return { problem: "Buddy no longer shows who this Draft was for, so it can't send it. You can still open it in Outlook." };
  const addresses = [...new Set(addressesIn(contact.email ?? ""))];
  if (addresses.length === 0) return { problem: "Buddy doesn't have an email address for them, so it can't send this. You can open it in Outlook and add one." };
  if (addresses.length > 1) return { problem: "Buddy has more than one address for them and can't tell which is right. You can open it in Outlook and choose." };
  return { address: addresses[0]! };
}

const asStep = (content: unknown): EmailStep => {
  const step = content as EmailStep;
  const words = [step?.site, step?.mode, step?.to, step?.contactName, step?.contactAddress, step?.subject, step?.body];
  if (!words.every((word) => typeof word === "string") || typeof step.draftId !== "number") throw new Error("This isn't an email on a card");
  return step;
};

/**
 * The send routine, which only the Student's tap on "Buddy sends it" can ask for. A card holds the
 * recipient, subject and body as they stood when it was made, and everything after that works from the
 * card: nothing is looked up again except to see that it hasn't changed. In Practice mode the recipient
 * is the Student's own address, and with no such address there's no card, because a real recipient is
 * never what Practice mode falls back to. BrowserAccess.sendApprovedEmail is the gate in front of the
 * browser's part, and BuddysBrowser.sendEmail does it.
 */
export function emailSendRoutine(deps: EmailSendDeps): ActionRoutine {
  const { sites, drafts, sending, browserAccess, hasReadPermission, store, clock, logError } = deps;
  const siteId = Object.entries(sites).find(([, site]) => site.sending)?.[0];
  const draftWithId = (id: unknown) => drafts.list().find((draft) => draft.id === id);

  function noLongerValid(content: unknown): string | null {
    const step = asStep(content);
    const now = sending.settings();
    if (step.mode !== now.mode) return `You switched to ${now.mode === "live" ? "Live" : "Practice mode"} after this card was made, so it no longer works. ${NEW_CARD}`;
    if (step.mode === "practice" && step.to !== now.ownAddress) return `Your TUmail address changed after this card was made, so it no longer works. ${NEW_CARD}`;
    const draft = draftWithId(step.draftId);
    if (!draft || draft.subject !== step.subject || draft.body !== step.body) return `You edited the Draft after this card was made, so it no longer works. ${NEW_CARD}`;
    const contact = contactAddress(draft);
    if (!("address" in contact) || contact.address !== step.contactAddress) return `Who this Draft is for has changed since this card was made, so it no longer works. ${NEW_CARD}`;
    return null;
  }

  function describeSending(sent: EmailSending, step: EmailStep): StepResult {
    switch (sent.outcome) {
      case "sent":
        return {
          status: "done",
          outcome: `Buddy sent this from your TUmail to ${step.to}.`,
          alsoRecord: [emailSent(step, clock.now())],
        };
      case "login_needed":
        return { status: "not_run", outcome: `Buddy's Browser isn't logged in to TUmail. Tap Log in to TUmail on the You tab, then ask for a new card. ${NOTHING_SENT}` };
      case "compose_differs":
        return {
          status: "not_run",
          outcome: `What was in Outlook's new email didn't match this card, so Buddy didn't press Send. ${NOTHING_SENT}`,
          detail: sent.problems.join(" "),
        };
      case "not_sent":
        return { status: "not_run", outcome: `Buddy didn't send this. ${NOTHING_SENT}`, detail: sent.why };
      case "no_clear_answer":
        return {
          status: "unknown",
          outcome: "Buddy pressed Send, but Outlook gave no clear answer, so Buddy can't tell whether it went. It won't try again, so please check your Sent folder.",
          alsoRecord: [emailMaybeSent(step, clock.now())],
        };
    }
  }

  return {
    kind: SEND_EMAIL,
    onlyTheStudentAsks: true,

    isAvailable: () => siteId !== undefined,

    prepare(input): EmailStep {
      if (siteId === undefined) throw new ActionRefused("Buddy can't send email yet.");
      if (!hasReadPermission(siteId)) throw new ActionRefused(`Buddy sends from ${sites[siteId]!.name}, so it needs its Read Permission first. You can give it on the You tab.`);
      const draft = draftWithId((input as { draft_id?: unknown } | null)?.draft_id);
      if (!draft) throw new ActionRefused("There's no such Draft.");
      if (draft.subject.trim() === "") throw new ActionRefused("This Draft has no subject. Add one with Edit, then tap Buddy sends it again.");
      if (hiddenNote(`${draft.subject}\n${draft.body}`)) {
        throw new ActionRefused("Buddy hid something in this Draft, and it won't send the mark it left in its place. Change that part with Edit, then tap Buddy sends it again.");
      }
      const contact = contactAddress(draft);
      if (!("address" in contact)) throw new ActionRefused(contact.problem);
      const { mode, ownAddress } = sending.settings();
      if (mode === "practice" && ownAddress === null) {
        throw new ActionRefused("You're in Practice mode, where everything goes to your own TUmail address, and Buddy doesn't know it yet. Add it on the You tab, then tap Buddy sends it again.");
      }
      return {
        site: siteId,
        draftId: draft.id,
        mode,
        to: mode === "practice" ? ownAddress! : contact.address,
        contactName: draft.contact!.name,
        contactAddress: contact.address,
        subject: draft.subject,
        body: draft.body,
      };
    },

    describe(content): CardDescription {
      const step = asStep(content);
      const contact = `${step.contactName} <${step.contactAddress}>`;
      return step.mode === "practice"
        ? {
            title: "Send a practice email to yourself",
            shows: [
              { label: "Practice mode", value: `This goes to you, not to ${step.contactName}.` },
              { label: "To", value: step.to },
              { label: "In Live, this would go to", value: contact },
              { label: "From", value: "Your TUmail" },
              { label: "Subject", value: step.subject },
              { label: "Message", value: step.body },
            ],
          }
        : {
            title: "Send a real email from your TUmail",
            shows: [
              { label: "Live", value: `This really goes to ${step.contactName}.` },
              { label: "To", value: step.to },
              { label: "From", value: "Your TUmail" },
              { label: "Subject", value: step.subject },
              { label: "Message", value: step.body },
            ],
          };
    },

    noLongerValid,

    whyNotNow() {
      if (browserAccess.currentTakeover()) return "You're in control of Buddy's Browser. Tap Done first, then Approve.";
      if (siteId === undefined || !hasReadPermission(siteId)) return "TUmail's Read Permission is off, so Buddy can't open it. Give it again on the You tab, then Approve.";
      return null;
    },

    async run(cardId): Promise<StepResult> {
      const stored = store.actionCard(THE_STUDENT, cardId);
      try {
        const sent = await browserAccess.sendApprovedEmail(cardId, (step) => {
          // The last look before Send is pressed, and the record of it going ahead. If this can't be
          // saved it throws, and the browser never gets as far as pressing.
          const why = noLongerValid(step);
          if (why) return why;
          store.addActivity(THE_STUDENT, emailSendStarted(step, clock.now()));
          return null;
        });
        return describeSending(sent, asStep(JSON.parse(stored!.content)));
      } catch (error) {
        // sendApprovedEmail only throws when nothing can have left the browser.
        if (error instanceof NoActionPermission || error instanceof TakeoverInProgress || error instanceof PageBlocked) {
          return { status: "not_run", outcome: NOTHING_SENT, detail: error.message };
        }
        // The rest could hold addresses and internals, which aren't for the Student's card.
        logError(error);
        return { status: "not_run", outcome: `Buddy's Browser couldn't do this. ${NOTHING_SENT}` };
      }
    },
  };
}
