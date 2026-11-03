import type { FastifyInstance } from "fastify";
import type { Tasks } from "./tasks.ts";

/** A silence longer than this looks like a dead connection to some networks, so the stream says something. */
const KEEP_ALIVE_EVERY_MS = 25_000;

/**
 * What the Task card and the Today tab call. A tap comes straight here from the paired phone and never passes through
 * Claude, so nothing a Task read can cancel one or let one spend more. The backend's request hook has already refused
 * anything but a paired phone's key, the stream included.
 */
export function addTaskRoutes(app: FastifyInstance, tasks: Tasks, isStoredId: (id: string) => boolean): void {
  const noSuchTask = { error: "There's no such Task" };
  const streams = new Set<() => void>();

  app.get("/tasks", async () => ({ tasks: tasks.list() }));

  /** Each change to any Task as it happens, on a connection that stays open. It holds nothing the list doesn't. */
  app.get("/tasks/events", (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const stopWatching = tasks.watch((task) => {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify({ type: "task_update", task })}\n\n`);
    });
    const keepAlive = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": still here\n\n");
    }, KEEP_ALIVE_EVERY_MS);
    keepAlive.unref();
    const end = () => {
      stopWatching();
      clearInterval(keepAlive);
      streams.delete(end);
      reply.raw.end();
    };
    streams.add(end);
    reply.raw.on("close", end);
    // Now rather than with the first change, so that the app knows it's listening.
    reply.raw.flushHeaders();
  });

  // An open stream would otherwise keep the backend from closing.
  app.addHook("preClose", async () => {
    for (const end of [...streams]) end();
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/cancel", async (request, reply) => {
    const task = isStoredId(request.params.id) ? tasks.cancel(Number(request.params.id)) : null;
    return task ? { task } : reply.code(404).send(noSuchTask);
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/keep-going", async (request, reply) => {
    const task = isStoredId(request.params.id) ? tasks.keepGoing(Number(request.params.id)) : null;
    return task ? { task } : reply.code(404).send(noSuchTask);
  });
}
