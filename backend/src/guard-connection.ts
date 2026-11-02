import type { GuardDecision, RequestGuard } from "./network-guard.ts";

const ATTACH_TIMEOUT_MS = 10_000;
const COVER_TIMEOUT_MS = 5_000;

/**
 * Sockets don't go through the pause that every other request does, the browser has no setting to
 * stop them, and they could change anything. So while Buddy is working, pages have none to open.
 * Goes into every document and worker, ahead of its own script as far as the browser allows.
 */
const NO_SOCKETS = `(() => {
  for (const name of ["WebSocket", "WebSocketStream", "WebTransport", "RTCPeerConnection", "webkitRTCPeerConnection"]) {
    if (!(name in self)) continue;
    const refused = function () {
      throw new DOMException("Buddy's Browser doesn't open sockets", "SecurityError");
    };
    Object.defineProperty(self, name, { value: refused, writable: false, configurable: false });
  }
})();`;

/** A service worker would stay in the browser after Buddy lets go, and run with nothing checking it. */
const NO_NEW_SERVICE_WORKERS = `(() => {
  if (!self.ServiceWorkerContainer) return;
  ServiceWorkerContainer.prototype.register = () =>
    Promise.reject(new DOMException("Buddy's Browser doesn't keep service workers", "SecurityError"));
})();`;

/**
 * Target types whose requests are paused where they are. A page's own workers aren't among them: the
 * browser pauses their requests in the page, and has no way to ask for it in the worker.
 */
const TARGETS_THAT_MAKE_REQUESTS = new Set(["page", "iframe", "shared_worker", "service_worker", "other"]);
/** Target types whose own children have to be attached to as well. */
const TARGETS_WITH_CHILDREN = new Set(["page", "iframe"]);
const TARGETS_THAT_ARE_WORKERS = new Set(["worker", "shared_worker", "service_worker"]);

export interface GuardConnection {
  /** Waits until this tab's requests are being checked, or throws. Call it before the tab goes anywhere. */
  cover(targetId: string): Promise<void>;
  /** Why the guard most recently refused to open a page. */
  lastPageRefusal(): string | null;
  /** Never resolves. Rejects if the connection is lost, because from then on nothing is being checked. */
  readonly lost: Promise<never>;
  close(): void;
}

/**
 * Puts a guard between Buddy's Browser and the network, for one piece of work. It asks about every
 * request, in every tab, frame and worker, including the ones a page starts for itself and each step
 * of a redirect, and it holds each one until it has the answer.
 *
 * This talks to the browser's control port directly, rather than through Playwright, because
 * Playwright lets redirects through without asking.
 */
export async function attachGuard(controlUrl: string, guard: RequestGuard): Promise<GuardConnection> {
  const version = (await (await fetch(`${controlUrl}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Buddy's Browser didn't answer the guard")), ATTACH_TIMEOUT_MS);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("The guard couldn't reach Buddy's Browser")); }, { once: true });
  });

  let nextId = 1;
  let closing = false;
  let pageRefusal: string | null = null;
  const waiting = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();
  const targetOfSession = new Map<string, { targetId: string; type: string }>();
  /** Each tab whose requests are being checked, or are about to be. */
  const covered = new Map<string, Promise<void>>();

  let markLost!: (error: Error) => void;
  const lost = new Promise<never>((_, reject) => (markLost = reject));
  // Work that finishes first never looks at this, and it mustn't count as unhandled when it rejects.
  lost.catch(() => {});

  function send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("The guard's connection has closed"));
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
  }

  /** A tab or worker can vanish at any moment, and then there's nothing left to answer. */
  const sendAndForget = (method: string, params: object, sessionId?: string) => {
    send(method, params, sessionId).catch(() => {});
  };

  async function startChecking(sessionId: string, type: string): Promise<void> {
    if (TARGETS_THAT_MAKE_REQUESTS.has(type)) {
      await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
    }
    if (TARGETS_WITH_CHILDREN.has(type)) {
      await send("Page.enable", {}, sessionId);
      await send("Page.addScriptToEvaluateOnNewDocument", { source: `${NO_SOCKETS}${NO_NEW_SERVICE_WORKERS}` }, sessionId);
      await send(
        "Target.setAutoAttach",
        { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
        sessionId,
      );
    } else if (TARGETS_THAT_ARE_WORKERS.has(type)) {
      // Not waited for: a worker held at its start may not answer until it's let go.
      sendAndForget("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
      sendAndForget("Runtime.evaluate", { expression: NO_SOCKETS }, sessionId);
    }
  }

  async function bodyOf(event: any, sessionId: string): Promise<string | undefined> {
    const { request } = event;
    if (request.postData !== undefined) return request.postData;
    if (!request.hasPostData) return undefined;
    const answer = await send("Fetch.getRequestPostData", { requestId: event.requestId }, sessionId).catch(() => null);
    return answer?.postData;
  }

  /** Anything unexpected here is a refusal: a request is only let through on a clear yes. */
  async function answerPausedRequest(event: any, sessionId: string): Promise<void> {
    const target = targetOfSession.get(sessionId);
    const opensPage = event.resourceType === "Document" && target?.type === "page" && event.frameId === target.targetId;
    let decision: GuardDecision;
    try {
      const headers: Record<string, string> = event.request.headers ?? {};
      const contentType = Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
      const body = await bodyOf(event, sessionId);
      decision = guard.check({
        url: event.request.url,
        method: event.request.method,
        opensPage,
        ...(body !== undefined ? { body } : {}),
        ...(contentType !== undefined ? { contentType } : {}),
      });
    } catch (error) {
      decision = { allowed: false, why: `The guard couldn't check this request: ${(error as Error).message}` };
    }
    if (decision.allowed) {
      sendAndForget("Fetch.continueRequest", { requestId: event.requestId }, sessionId);
    } else {
      if (opensPage) pageRefusal = decision.why;
      sendAndForget("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }, sessionId);
    }
  }

  function onAttached(event: any): void {
    const { sessionId, targetInfo, waitingForDebugger } = event;
    targetOfSession.set(sessionId, { targetId: targetInfo.targetId, type: targetInfo.type });
    const checking = startChecking(sessionId, targetInfo.type).then(
      () => {
        if (waitingForDebugger) sendAndForget("Runtime.runIfWaitingForDebugger", {}, sessionId);
      },
      async (error) => {
        // Usually it has just gone, such as a frame on a page that's going away. If it's still there
        // with nothing checking it, Buddy's work has to stop. Closing it instead would be wrong, as
        // closing a frame closes its tab, and closing the last tab shuts the whole browser down.
        const stillThere = await send("Target.getTargetInfo", { targetId: targetInfo.targetId }).then(
          () => true,
          () => false,
        );
        if (stillThere && !closing && targetInfo.type !== "other") markLost(error);
        throw error;
      },
    );
    checking.catch(() => {});
    covered.set(targetInfo.targetId, checking);
  }

  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data));
    if (data.id !== undefined) {
      const answer = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.error) answer?.reject(new Error(data.error.message));
      else answer?.resolve(data.result);
    } else if (data.method === "Target.attachedToTarget") {
      onAttached(data.params);
    } else if (data.method === "Fetch.requestPaused") {
      void answerPausedRequest(data.params, data.sessionId);
    }
  });

  socket.addEventListener("close", () => {
    const error = new Error("The guard lost its connection to Buddy's Browser");
    for (const answer of waiting.values()) answer.reject(error);
    waiting.clear();
    if (!closing) markLost(error);
  });

  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  return {
    lost,
    lastPageRefusal: () => pageRefusal,

    async cover(targetId) {
      const deadline = Date.now() + COVER_TIMEOUT_MS;
      while (!covered.has(targetId)) {
        if (Date.now() > deadline) throw new Error("The guard couldn't cover this tab, so Buddy won't use it");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await covered.get(targetId);
    },

    close() {
      closing = true;
      socket.close();
    },
  };
}
