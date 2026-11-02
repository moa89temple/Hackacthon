import fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { listActivity } from "./activity.ts";
import type { Adapters } from "./adapters.ts";
import {
  BrowserUnreachable,
  createBrowserAccess,
  NoTakeover,
  TakeoverInProgress,
  UnknownSite,
  type BrowserAccess,
  type Site,
} from "./browser-access.ts";
import {
  BadAddress,
  createConnections,
  NoReadPermission,
  ReadPermissionAlreadyGiven,
  UnknownConnection,
  type Connections,
  type ConnectionType,
} from "./connections.ts";
import { createConversation } from "./conversation.ts";
import { createCrisisCheck } from "./crisis-check.ts";
import { createDevices, type Devices } from "./devices.ts";
import { createLiveViewProxy } from "./live-view-proxy.ts";
import { hiddenNote } from "./masking.ts";
import { createProfile, type Profile } from "./profile.ts";
import { openStore } from "./store.ts";
import { BUDDY_OPENING } from "./system-prompt.ts";

const PAIR_ROUTE = "/devices/pair";

export interface BackendOptions {
  adapters: Adapters;
  sites: Record<string, Site>;
  connectionTypes: ConnectionType[];
  /** The host names the backend answers to. Requests for any other name are refused. */
  allowedHosts: string[];
  databasePath: string;
  chatModel: string;
  crisisCheck: { model: string; timeoutMs: number };
  host: string;
  port: number;
  logger: boolean;
}

export interface RunningBackend {
  url: string;
  browserAccess: BrowserAccess;
  connections: Connections;
  devices: Devices;
  close(): Promise<void>;
}

export async function startBackend(options: BackendOptions): Promise<RunningBackend> {
  const store = openStore(options.databasePath);
  const devices = createDevices({ store, clock: options.adapters.clock });
  const profile = createProfile({
    store,
    clock: options.adapters.clock,
    connectionName: (id) => options.connectionTypes.find((type) => type.id === id)?.name ?? id,
  });
  const connections = createConnections({
    types: options.connectionTypes,
    web: options.adapters.web,
    clock: options.adapters.clock,
    store,
    profile,
    logError: (error) => app.log.error(error),
  });
  const conversation = createConversation({
    claude: options.adapters.claude,
    clock: options.adapters.clock,
    store,
    chatModel: options.chatModel,
    crisisCheck: createCrisisCheck({
      claude: options.adapters.claude,
      ...options.crisisCheck,
      logError: (error) => app.log.error(error),
    }),
    profile,
    connections,
    logError: (error) => app.log.error(error),
  });
  const browserAccess = createBrowserAccess({
    browser: options.adapters.browser,
    clock: options.adapters.clock,
    store,
    sites: options.sites,
    onControlEnded: () => liveView.closeAll(),
    logError: (error) => app.log.error(error),
  });

  const app = fastify({ logger: options.logger });
  const liveView = createLiveViewProxy({
    target: options.adapters.browser.liveView,
    isOpen: browserAccess.isLiveViewOpen,
    isAllowedHost: (host) => isAllowedHost(host, options.allowedHosts),
    devices,
  });
  liveView.attachTo(app);

  app.addHook("onClose", async () => {
    connections.stopSchedule();
    store.close();
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!isAllowedHost(request.headers.host, options.allowedHosts)) {
      return reply.code(403).send({ error: "This backend doesn't answer to that address" });
    }
    // Pairing is how a phone gets its key, so it's the one operation that can't ask for one.
    // Everything else is refused here, including any route added later.
    if (request.routeOptions.url === PAIR_ROUTE) return;
    if (!devices.allows(request.headers, request.url)) {
      return reply.code(401).send({ error: "This needs a paired phone" });
    }
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = browserErrorStatus(error) ?? connectionErrorStatus(error);
    if (status) return reply.code(status).send({ error: error.message });
    request.log.error(error);
    return reply.code(error.statusCode ?? 500).send({ error: "Something went wrong" });
  });

  app.post<{ Body: { code?: unknown } }>(PAIR_ROUTE, async (request, reply) => {
    const code = request.body?.code;
    if (typeof code !== "string") return reply.code(400).send({ error: "code must be a string" });
    const deviceKey = devices.pair(code);
    if (!deviceKey) return reply.code(401).send({ error: "That pairing code isn't valid" });
    return { deviceKey };
  });

  app.get("/conversation/messages", async () => ({ opening: BUDDY_OPENING, messages: conversation.history() }));

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

  // Only this route, on purpose: no entry can be changed or removed one at a time.
  app.get("/activity", async () => ({ entries: listActivity(store) }));

  addProfileRoutes(app, profile);
  addBrowserRoutes(app, browserAccess);
  addConnectionRoutes(app, connections);

  const url = await app.listen({ host: options.host, port: options.port });
  return { url, browserAccess, connections, devices, close: () => app.close() };
}

function addProfileRoutes(app: FastifyInstance, profile: Profile): void {
  app.get("/profile/facts", async () => ({ facts: profile.list() }));

  app.patch<{ Params: { id: string }; Body: { text?: unknown } }>("/profile/facts/:id", async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== "string" || text.trim() === "") {
      return reply.code(400).send({ error: "text must be a non-empty string" });
    }
    const fact = isFactId(request.params.id) ? profile.edit(Number(request.params.id), text) : null;
    if (!fact) return reply.code(404).send({ error: "There's no such fact" });
    const note = hiddenNote(fact.text);
    return { fact, ...(note ? { hiddenNote: note } : {}) };
  });

  app.delete<{ Params: { id: string } }>("/profile/facts/:id", async (request, reply) => {
    const removed = isFactId(request.params.id) && profile.remove(Number(request.params.id));
    return removed ? reply.code(204).send() : reply.code(404).send({ error: "There's no such fact" });
  });
}

/** Longer than this, Number would round it and could land on a different fact. */
function isFactId(id: string): boolean {
  return /^\d{1,15}$/.test(id);
}

/** The address travels in a request's body, because URLs end up in the logs. */
function addConnectionRoutes(app: FastifyInstance, connections: Connections): void {
  app.get("/connections", async () => ({ connections: connections.list() }));

  app.post<{ Params: { id: string }; Body: { address?: unknown } | undefined }>(
    "/connections/:id/read-permission",
    async (request) => ({ connection: await connections.give(request.params.id, request.body?.address) }),
  );

  app.delete<{ Params: { id: string } }>("/connections/:id/read-permission", async (request) => ({
    connection: connections.revoke(request.params.id),
  }));

  app.post<{ Params: { id: string } }>("/connections/:id/read", async (request) => ({
    connection: await connections.read(request.params.id, "asked"),
  }));
}

function addBrowserRoutes(app: FastifyInstance, browserAccess: BrowserAccess): void {
  app.get("/takeover", async () => ({ takeover: browserAccess.currentTakeover() }));

  app.post<{ Body: { site?: unknown } }>("/takeover", async (request, reply) => {
    const site = request.body?.site;
    if (typeof site !== "string") return reply.code(404).send({ error: "site must name a site" });
    return { takeover: await browserAccess.startTakeover(site) };
  });

  app.post("/takeover/done", () => browserAccess.finishTakeover());

  app.delete<{ Params: { site: string } }>("/sites/:site/login", async (request, reply) => {
    await browserAccess.forgetLogin(request.params.site);
    return reply.code(204).send();
  });
}

function isAllowedHost(hostHeader: string | undefined, allowedHosts: string[]): boolean {
  if (!hostHeader) return false;
  // URL does the parsing, so that a port or an IPv6 address can't confuse the comparison.
  try {
    return allowedHosts.includes(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}

function connectionErrorStatus(error: unknown): number | undefined {
  if (error instanceof UnknownConnection) return 404;
  if (error instanceof NoReadPermission) return 403;
  if (error instanceof ReadPermissionAlreadyGiven) return 409;
  if (error instanceof BadAddress) return 400;
  return undefined;
}

function browserErrorStatus(error: unknown): number | undefined {
  if (error instanceof UnknownSite) return 404;
  if (error instanceof TakeoverInProgress || error instanceof NoTakeover) return 409;
  if (error instanceof BrowserUnreachable) return 503;
  return undefined;
}
