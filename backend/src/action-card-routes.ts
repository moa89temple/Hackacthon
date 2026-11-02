import type { FastifyInstance, FastifyReply } from "fastify";
import { CardRefused, type ActionCard, type ActionCards } from "./action-cards.ts";

/**
 * What the app's Approve and Decline buttons call. A tap comes straight here from the paired phone
 * and never passes through Claude, which is why a typed yes can't count and a web page can't imitate
 * one. The backend's request hook has already refused anything but a paired phone's key.
 */
export function addActionCardRoutes(
  app: FastifyInstance,
  actionCards: ActionCards,
  isStoredId: (id: string) => boolean,
): void {
  const noSuchCard = { error: "There's no such card" };

  /** Answers with the card as it is now, or says why the tap didn't count, with the card as it is. */
  async function answerTap(reply: FastifyReply, tap: () => ActionCard | null | Promise<ActionCard | null>) {
    try {
      const card = await tap();
      return card ? { card } : reply.code(404).send(noSuchCard);
    } catch (error) {
      if (error instanceof CardRefused) return reply.code(409).send({ error: error.message, card: error.card });
      throw error;
    }
  }

  app.get<{ Params: { id: string } }>("/action-cards/:id", async (request, reply) => {
    const card = isStoredId(request.params.id) ? actionCards.get(Number(request.params.id)) : null;
    return card ? { card } : reply.code(404).send(noSuchCard);
  });

  // It answers once the step has finished, but the step doesn't depend on anyone hearing the answer.
  app.post<{ Params: { id: string }; Body: { fingerprint?: unknown } | undefined }>(
    "/action-cards/:id/approve",
    async (request, reply) => {
      const fingerprint = request.body?.fingerprint;
      if (!isStoredId(request.params.id)) return reply.code(404).send(noSuchCard);
      if (typeof fingerprint !== "string") return reply.code(400).send({ error: "fingerprint must say what the card showed" });
      return answerTap(reply, () => actionCards.approve(Number(request.params.id), fingerprint));
    },
  );

  app.post<{ Params: { id: string } }>("/action-cards/:id/decline", async (request, reply) => {
    if (!isStoredId(request.params.id)) return reply.code(404).send(noSuchCard);
    return answerTap(reply, () => actionCards.decline(Number(request.params.id)));
  });
}
