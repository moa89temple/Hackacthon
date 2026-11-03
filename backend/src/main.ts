import { productionAdapters } from "./adapters.ts";
import { startBackend } from "./server.ts";
import { allowedHostsWithTailscale, readFirebaseServiceAccountFile, readSecrets, settings } from "./settings.ts";

const adapters = productionAdapters(readSecrets(), settings.browser, readFirebaseServiceAccountFile());

const backend = await startBackend({
  adapters,
  sites: settings.sites,
  publicHosts: settings.publicHosts,
  connectionTypes: settings.connectionTypes,
  allowedHosts: allowedHostsWithTailscale(),
  databasePath: settings.databasePath,
  chatModel: settings.chatModel,
  crisisCheck: settings.crisisCheck,
  discovery: settings.discovery,
  host: settings.host,
  port: settings.port,
  logger: true,
});

backend.actionCards.endInterrupted();
backend.tasks.endInterrupted();
backend.connections.startSchedule();
backend.discovery.startSchedule();
backend.opportunityDiscovery.startSchedule();
backend.briefings.startSchedule();
backend.tasks.startSchedule();

console.log(adapters.notifier.offBecause ?? "Phone notifications are on, through Firebase Cloud Messaging.");

if (!backend.devices.anyPaired()) {
  console.log("No phone is paired yet. In another terminal, run: npm run pair");
}
