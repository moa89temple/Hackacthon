import type { FastifyInstance } from "fastify";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";

const SOCKET_PATH = /^\/takeover\/live\/([^/]+)\/websockify$/;

export interface LiveViewProxyDeps {
  /** Where the container's live view listens. */
  target: { host: string; port: number };
  /** Whether this token belongs to a Takeover whose screen is now the Student's. */
  isOpen: (token: string) => boolean;
  /** Upgraded connections skip the backend's request hooks, so this checks them here. */
  isAllowedHost: (host: string | undefined) => boolean;
}

export interface LiveViewProxy {
  attachTo(app: FastifyInstance): void;
  /** Cuts the Student's live view off at once. */
  closeAll(): void;
}

/**
 * Carries the live view between the app and the container, and only during a Takeover.
 * Its bytes hold everything the Student types, so they're passed along and never looked at,
 * logged or kept.
 */
export function createLiveViewProxy({ target, isOpen, isAllowedHost }: LiveViewProxyDeps): LiveViewProxy {
  const connections = new Set<Duplex>();

  function closeAll(): void {
    for (const connection of connections) connection.destroy();
    connections.clear();
  }

  function track(connection: Duplex): void {
    connections.add(connection);
    connection.on("close", () => connections.delete(connection));
    connection.on("error", () => connection.destroy());
  }

  return {
    closeAll,

    attachTo(app) {
      // The live view's own page and scripts.
      app.get<{ Params: { token: string; "*": string } }>(
        "/takeover/live/:token/*",
        { logLevel: "silent" },
        async (request, reply) => {
          if (!isOpen(request.params.token)) return reply.code(404).send();
          // Set as a path, so that nothing in the request can point this at another host.
          const address = new URL(`http://${target.host}:${target.port}/`);
          address.pathname = request.params["*"];
          const upstream = await fetch(address).catch(() => null);
          if (!upstream?.ok) return reply.code(502).send();
          return reply
            .code(200)
            .header("content-type", upstream.headers.get("content-type") ?? "application/octet-stream")
            .header("cache-control", "no-store")
            .send(Buffer.from(await upstream.arrayBuffer()));
        },
      );

      // The live view itself, a WebSocket passed through without being opened.
      app.server.on("upgrade", (request, socket: Duplex, head: Buffer) => {
        if (!isAllowedHost(request.headers.host)) {
          socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          return;
        }
        const token = SOCKET_PATH.exec(new URL(request.url ?? "", "http://backend").pathname)?.[1];
        if (!token || !isOpen(token)) {
          socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          return;
        }

        // Only one view at a time: an app that reconnects replaces its old connection.
        closeAll();
        track(socket);
        const upstream: Socket = connect(target.port, target.host, () => {
          upstream.write(`GET /websockify HTTP/1.1\r\n${passOnHeaders(request.rawHeaders)}\r\n`);
          upstream.write(head);
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        track(upstream);
        // Either side ending ends the other, so no half of a connection outlives the Takeover.
        upstream.on("close", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
      });

      app.addHook("onClose", async () => closeAll());
    },
  };
}

function passOnHeaders(rawHeaders: string[]): string {
  let headers = "";
  for (let index = 0; index < rawHeaders.length; index += 2) {
    headers += `${rawHeaders[index]}: ${rawHeaders[index + 1]}\r\n`;
  }
  return headers;
}
