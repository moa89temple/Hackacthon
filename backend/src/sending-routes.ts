import type { FastifyInstance } from "fastify";
import { ActionRefused, type ActionCards } from "./action-cards.ts";
import { SEND_EMAIL } from "./buddys-browser.ts";
import type { Drafts } from "./drafts.ts";
import { BadOwnAddress, type Sending } from "./sending.ts";

export interface SendingRoutesDeps {
  sending: Sending;
  actionCards: ActionCards;
  drafts: Pick<Drafts, "list">;
  /** The newest message on the Student's screen, so that a card made by a tap goes after it when the conversation loads. */
  lastMessageShown: () => number | null;
  isStoredId: (id: string) => boolean;
}

/**
 * What the app's "Buddy sends it" button and the You tab's sending section call. Like an Approve tap,
 * each comes straight from the paired phone and never passes through Claude. Nothing Claude can call
 * reaches any of these. The backend's request hook has already refused anything but a paired phone's key.
 */
export function addSendingRoutes(app: FastifyInstance, deps: SendingRoutesDeps): void {
  const { sending, actionCards, drafts, lastMessageShown, isStoredId } = deps;

  app.get("/sending", async () => ({ sending: sending.settings() }));

  app.post("/sending/live", async () => ({ sending: sending.switchTo("live") }));

  app.post("/sending/practice", async () => ({ sending: sending.switchTo("practice") }));

  app.put<{ Body: { address?: unknown } | undefined }>("/sending/own-address", async (request, reply) => {
    try {
      return { sending: sending.saveOwnAddress(request.body?.address) };
    } catch (error) {
      if (error instanceof BadOwnAddress) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  // It only ever makes a card. The email goes only after the Student taps Approve on that.
  app.post<{ Params: { id: string } }>("/drafts/:id/send-card", async (request, reply) => {
    const draft = isStoredId(request.params.id) ? drafts.list().find(({ id }) => id === Number(request.params.id)) : undefined;
    if (!draft) return reply.code(404).send({ error: "There's no such Draft" });
    try {
      const card = actionCards.requestFromStudent(
        { kind: SEND_EMAIL, draft_id: draft.id },
        { afterMessageId: lastMessageShown() ?? draft.afterMessageId },
      );
      return { card };
    } catch (error) {
      if (error instanceof ActionRefused) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });
}
