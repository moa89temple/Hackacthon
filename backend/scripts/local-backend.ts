import { productionAdapters } from "../src/adapters.ts";
import { startBackend, type RunningBackend } from "../src/server.ts";
import { readSecrets, settings } from "../src/settings.ts";

/**
 * A backend for a command run on this laptop. It opens no port the phone uses, so being able to
 * run the command is what gives the right to do this, in place of a device key.
 */
export function startLocalBackend(): Promise<RunningBackend> {
  return startBackend({
    adapters: productionAdapters(readSecrets(), settings.browser),
    sites: settings.sites,
    connectionTypes: settings.connectionTypes,
    allowedHosts: settings.allowedHosts,
    databasePath: settings.databasePath,
    chatModel: settings.chatModel,
    crisisCheck: settings.crisisCheck,
    host: "127.0.0.1",
    port: 0,
    logger: false,
  });
}
