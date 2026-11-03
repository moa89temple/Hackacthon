import type { FastifyInstance, FastifyReply } from "fastify";
import type { Opportunities } from "./opportunities.ts";

/** Saving and reporting are taps on a card, which never pass through the model. */
export function addOpportunityRoutes(app: FastifyInstance, opportunities: Opportunities, isStoredId: (id: string) => boolean): void {
  /** What each tap does, by id, and whether there was such an Opportunity. */
  const answerTap = (id: string, reply: FastifyReply, tap: (id: number) => boolean) =>
    isStoredId(id) && tap(Number(id)) ? reply.code(204).send() : reply.code(404).send({ error: "There's no such Opportunity" });

  app.get("/opportunities", async () => ({ opportunities: opportunities.list() }));

  app.put<{ Params: { id: string } }>("/opportunities/:id/saved", async (request, reply) => answerTap(request.params.id, reply, opportunities.save));

  app.delete<{ Params: { id: string } }>("/opportunities/:id/saved", async (request, reply) => answerTap(request.params.id, reply, opportunities.unsave));

  app.post<{ Params: { id: string } }>("/opportunities/:id/report", async (request, reply) => answerTap(request.params.id, reply, opportunities.report));
}
