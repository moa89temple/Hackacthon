import type { FastifyInstance, FastifyReply } from "fastify";
import { RoadmapRefused, type Roadmap, type RoadmapCard } from "./roadmap.ts";

/**
 * What the Goals section and the Roadmap tab call. Accepting a card comes straight here from the Student's
 * tap and never passes through Claude. It isn't a Permission: it's the Student changing their own list.
 */
export function addRoadmapRoutes(app: FastifyInstance, roadmap: Roadmap, isStoredId: (id: string) => boolean): void {
  const noSuchGoal = { error: "There's no such Goal" };
  const noSuchCard = { error: "There's no such card" };
  const noSuchMilestone = { error: "There's no such Milestone" };
  const asRoadmap = () => ({ milestones: roadmap.milestones() });

  app.get("/goals", async () => ({ goals: roadmap.goals() }));

  app.post<{ Body: { text?: unknown } }>("/goals", async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== "string" || text.trim() === "") return reply.code(400).send({ error: "text must be a non-empty string" });
    return { goal: roadmap.addGoal(text) };
  });

  app.patch<{ Params: { id: string }; Body: { text?: unknown } }>("/goals/:id", async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== "string" || text.trim() === "") return reply.code(400).send({ error: "text must be a non-empty string" });
    const goal = isStoredId(request.params.id) ? roadmap.editGoal(Number(request.params.id), text) : null;
    return goal ? { goal } : reply.code(404).send(noSuchGoal);
  });

  app.delete<{ Params: { id: string } }>("/goals/:id", async (request, reply) => {
    const removed = isStoredId(request.params.id) && roadmap.removeGoal(Number(request.params.id));
    return removed ? { goals: roadmap.goals(), ...asRoadmap() } : reply.code(404).send(noSuchGoal);
  });

  app.get("/roadmap", async () => asRoadmap());

  function answerTap(reply: FastifyReply, id: string, tap: (id: number) => RoadmapCard | null) {
    const card = isStoredId(id) ? tap(Number(id)) : null;
    return card ? { card, ...asRoadmap() } : reply.code(404).send(noSuchCard);
  }

  app.post<{ Params: { id: string } }>("/roadmap/cards/:id/accept", async (request, reply) => answerTap(reply, request.params.id, roadmap.accept));
  app.post<{ Params: { id: string } }>("/roadmap/cards/:id/not-now", async (request, reply) => answerTap(reply, request.params.id, roadmap.notNow));

  app.post<{ Body: { name?: unknown; dueDate?: unknown; goalId?: unknown } }>("/roadmap/milestones", async (request, reply) => {
    const { name, dueDate, goalId } = request.body ?? {};
    try {
      roadmap.addMilestone({ name, dueDate, goalId });
      return asRoadmap();
    } catch (error) {
      if (error instanceof RoadmapRefused) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string }; Body: { done?: unknown } }>("/roadmap/milestones/:id", async (request, reply) => {
    const done = request.body?.done;
    if (typeof done !== "boolean") return reply.code(400).send({ error: "done must be true or false" });
    const known = isStoredId(request.params.id) && roadmap.setDone(Number(request.params.id), done);
    return known ? asRoadmap() : reply.code(404).send(noSuchMilestone);
  });

  app.delete<{ Params: { id: string } }>("/roadmap/milestones/:id", async (request, reply) => {
    const known = isStoredId(request.params.id) && roadmap.removeMilestone(Number(request.params.id));
    return known ? asRoadmap() : reply.code(404).send(noSuchMilestone);
  });

  app.put<{ Body: { ids?: unknown } }>("/roadmap/order", async (request, reply) => {
    const ids = request.body?.ids;
    const usable = Array.isArray(ids) && ids.every((id) => typeof id === "number") && roadmap.reorder(ids as number[]);
    return usable ? asRoadmap() : reply.code(409).send({ error: "That order doesn't hold each Milestone once" });
  });
}
