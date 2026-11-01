import { productionAdapters } from "./adapters.ts";
import { startBackend } from "./server.ts";
import { readSecrets, settings } from "./settings.ts";

await startBackend({
  adapters: productionAdapters(readSecrets()),
  databasePath: settings.databasePath,
  chatModel: settings.chatModel,
  host: settings.host,
  port: settings.port,
  logger: true,
});
