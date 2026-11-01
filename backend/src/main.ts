import { productionAdapters } from "./adapters.ts";
import { startBackend } from "./server.ts";
import { allowedHostsWithTailscale, readSecrets, settings } from "./settings.ts";

const backend = await startBackend({
  adapters: productionAdapters(readSecrets(), settings.browser),
  sites: settings.sites,
  allowedHosts: allowedHostsWithTailscale(),
  databasePath: settings.databasePath,
  chatModel: settings.chatModel,
  host: settings.host,
  port: settings.port,
  logger: true,
});

if (!backend.devices.anyPaired()) {
  console.log("No phone is paired yet. In another terminal, run: npm run pair");
}
