import type { FastifyInstance } from "fastify";
import { BadBriefingTime, BadPushToken, type Briefings } from "./briefings.ts";
import type { Devices } from "./devices.ts";

/**
 * What the Today tab and the You tab call, and what the app calls to say where to reach this phone. Nothing
 * Claude can call reaches any of these. The backend's request hook has already refused anything but a paired phone's key.
 */
export function addBriefingRoutes(app: FastifyInstance, briefings: Briefings, devices: Devices): void {
  app.get("/briefings/latest", async () => ({ briefing: briefings.latest() }));

  app.get("/briefings/settings", async () => briefings.settings());

  app.put<{ Body: { weekdays?: unknown; sunday?: unknown } | undefined }>("/briefings/settings", async (request, reply) => {
    try {
      return briefings.changeTimes(request.body ?? {});
    } catch (error) {
      if (error instanceof BadBriefingTime) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  // By the phone's own key, so that it replaces this phone's old token and no other's.
  app.put<{ Body: { token?: unknown } | undefined }>("/devices/push-token", async (request, reply) => {
    const deviceKeyHash = devices.keyHashOf(request.headers);
    if (!deviceKeyHash) return reply.code(401).send({ error: "This needs a paired phone" });
    try {
      briefings.savePushToken(deviceKeyHash, request.body?.token);
    } catch (error) {
      if (error instanceof BadPushToken) return reply.code(400).send({ error: error.message });
      throw error;
    }
    return reply.code(204).send();
  });
}
