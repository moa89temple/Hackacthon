import fastify from "fastify";
import type { Adapters } from "./adapters.ts";
import { createConversation } from "./conversation.ts";
import { openStore } from "./store.ts";

export interface BackendOptions {
  adapters: Adapters;
  databasePath: string;
  chatModel: string;
  host: string;
  port: number;
  logger: boolean;
}

export interface RunningBackend {
  url: string;
  close(): Promise<void>;
}

export async function startBackend(options: BackendOptions): Promise<RunningBackend> {
  const store = openStore(options.databasePath);
  const conversation = createConversation({
    claude: options.adapters.claude,
    clock: options.adapters.clock,
    store,
    chatModel: options.chatModel,
    logError: (error) => app.log.error(error),
  });

  const app = fastify({ logger: options.logger });

  app.addHook("onClose", async () => store.close());

  app.get("/conversation/messages", async () => ({ messages: conversation.history() }));

  app.post<{ Body: { text?: unknown } }>("/conversation/messages", async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== "string" || text.trim() === "") {
      return reply.code(400).send({ error: "text must be a non-empty string" });
    }

    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    // Keeps going if the app disconnects, so that Buddy's reply is saved for next time.
    for await (const event of conversation.send(text)) {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    reply.raw.end();
  });

  const url = await app.listen({ host: options.host, port: options.port });
  return { url, close: () => app.close() };
}
