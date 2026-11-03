import type { FastifyInstance } from "fastify";
import type { Opportunities } from "./opportunities.ts";

/** Saving and reporting are taps on a card, which never pass through the model. */
export function addOpportunityRoutes(app: FastifyInstance, opportunities: Opportunities, isStoredId: (id: string) => boolean): void {
  app.get("/opportunities", async () => ({ opportunities: opportunities.list() }));

  app.put<{ Params: { id: string } }>("/opportunities/:id/saved", async (request, reply) => {
    const known = isStoredId(request.params.id) && opportunities.save(Number(request.params.id));
    return known ? reply.code(204).send() : reply.code(404).send({ error: "There's no such Opportunity" });
  });

  app.delete<{ Params: { id: string } }>("/opportunities/:id/saved", async (request, reply) => {
    const known = isStoredId(request.params.id) && opportunities.unsave(Number(request.params.id));
    return known ? reply.code(204).send() : reply.code(404).send({ error: "There's no such Opportunity" });
  });

  app.post<{ Params: { id: string } }>("/opportunities/:id/report", async (request, reply) => {
    const known = isStoredId(request.params.id) && opportunities.report(Number(request.params.id));
    return known ? reply.code(204).send() : reply.code(404).send({ error: "There's no such Opportunity" });
  });
}
