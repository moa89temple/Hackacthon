import type { FastifyInstance } from "fastify";
import { ActionRefused, type ActionCards } from "./action-cards.ts";
import type { Site } from "./browser-access.ts";
import { SEND_EMAIL } from "./buddys-browser.ts";
import { asStep, whyCrisisEmailCantGoYet } from "./email-send.ts";
import type { GuidebookItem } from "./guidebook.ts";
import type { Sending } from "./sending.ts";
import { THE_STUDENT, type Store } from "./store.ts";
import { addressesIn } from "./tumail-rules.ts";

/**
 * Temple's Let's Talk page gives this for emailing a consent form, and it's the only address its counseling
 * pages publish. Nothing says anyone reads it for a Student who needs help, so Buddy never offers it for that.
 */
const NOT_FOR_REACHING_SOMEONE = "lets.talk@temple.edu";

export interface CrisisEmailRoutesDeps {
  sites: Record<string, Site>;
  store: Pick<Store, "readPermission" | "actionCard">;
  sending: Sending;
  actionCards: ActionCards;
  contacts: () => GuidebookItem[];
  /** The newest message on the Student's screen, so that a card made by a tap goes after it when the conversation loads. */
  lastMessageShown: () => number | null;
  isStoredId: (id: string) => boolean;
}

/** Only from the Guidebook, so with its Source, and only if there's one address to go by. It's never made up here. */
function tuttlemanIn(contacts: GuidebookItem[]): GuidebookItem | null {
  for (const contact of contacts) {
    if (!/tuttleman/i.test(contact.name)) continue;
    const addresses = [...new Set(addressesIn(contact.email ?? ""))];
    if (addresses.length === 1 && addresses[0] !== NOT_FOR_REACHING_SOMEONE) return { ...contact, email: addresses[0]! };
  }
  return null;
}

/**
 * What the Crisis card's offer to email someone calls. Like an Approve tap, each comes straight from the
 * paired phone and never passes through Claude, so nothing Buddy reads can choose who gets an email. The
 * crisis Resources are in the app's own code and wait for none of this. The backend's request hook has
 * already refused anything but a paired phone's key.
 */
export function addCrisisEmailRoutes(app: FastifyInstance, deps: CrisisEmailRoutesDeps): void {
  const { sites, store, sending, actionCards, contacts, lastMessageShown, isStoredId } = deps;

  /** It only ever makes a card. The email goes only after the Student taps Approve on that. */
  function makeCard(email: Record<string, unknown>) {
    const afterMessageId = lastMessageShown();
    // A card goes after a message, so with none it would never appear. There's no Crisis card to ask from then either.
    if (afterMessageId === null) throw new ActionRefused("Buddy can only make this from a Crisis card in your conversation.");
    return actionCards.requestFromStudent({ kind: SEND_EMAIL, crisis_email: email }, { afterMessageId });
  }

  app.get("/crisis-email/offer", async () => {
    const { mode, ownAddress } = sending.settings();
    return {
      offer: {
        whyNotYet: whyCrisisEmailCantGoYet(sites, store),
        isLive: mode === "live",
        ownAddress,
        tuttleman: tuttlemanIn(contacts()),
      },
    };
  });

  app.post<{ Body: Record<string, unknown> | undefined }>("/crisis-email/card", async (request, reply) => {
    const { name, address, subject, body } = request.body ?? {};
    try {
      return { card: makeCard({ name, address, subject, body }) };
    } catch (error) {
      if (error instanceof ActionRefused) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  /**
   * The Practice card's offer. Switching stops that card, as any switch does, so this makes the same email
   * again from what the card held. The new card still needs its own Approve tap.
   */
  app.post<{ Params: { id: string } }>("/crisis-email/cards/:id/live", async (request, reply) => {
    const id = isStoredId(request.params.id) ? Number(request.params.id) : null;
    const stored = id === null ? null : store.actionCard(THE_STUDENT, id);
    if (id === null || !stored || stored.kind !== SEND_EMAIL) return reply.code(404).send({ error: "There's no such card" });
    const step = asStep(JSON.parse(stored.content));
    if (!step.crisis) return reply.code(404).send({ error: "There's no such card" });
    if (!actionCards.get(id)?.canDecide) return reply.code(409).send({ error: "This card no longer works, so nothing changed. You can make a new one on the Crisis card." });
    sending.switchTo("live");
    try {
      return { card: makeCard({ name: step.contactName, address: step.contactAddress, subject: step.subject, body: step.body }) };
    } catch (error) {
      if (error instanceof ActionRefused) return reply.code(409).send({ error: `You've switched to Live. ${error.message}` });
      throw error;
    }
  });
}
