// Makes one real Claude call through the real backend, with a throwaway database.
// It costs real money, so it's run by hand and isn't part of the test suite: npm run smoke
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionAdapters } from "../src/adapters.ts";
import { startBackend } from "../src/server.ts";
import { readSecrets, settings } from "../src/settings.ts";
import { readEvents } from "../test/support/read-events.ts";

const directory = mkdtempSync(join(tmpdir(), "buddy-smoke-"));
const backend = await startBackend({
  adapters: productionAdapters(readSecrets(), settings.browser),
  sites: settings.sites,
  allowedHosts: settings.allowedHosts,
  databasePath: join(directory, "buddy.sqlite"),
  chatModel: settings.chatModel,
  host: "127.0.0.1",
  port: 0,
  logger: true,
});

let passed = false;
try {
  const response = await fetch(`${backend.url}/conversation/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "In one short sentence, what are office hours?" }),
  });

  const events = [];
  for await (const event of readEvents(response)) {
    events.push(event);
    if (event.type === "text") process.stdout.write(event.text);
  }
  process.stdout.write("\n");

  const history = await fetch(`${backend.url}/conversation/messages`).then((r) => r.json()) as { messages: unknown[] };
  const textEvents = events.filter((event) => event.type === "text").length;
  const ended = events.at(-1);
  console.log(`\nModel: ${settings.chatModel}`);
  console.log(`Text events: ${textEvents}; last event: ${JSON.stringify(ended)}`);
  console.log(`Messages saved: ${history.messages.length}`);
  passed = ended?.type === "done" && textEvents > 0 && history.messages.length === 2;
} finally {
  await backend.close();
  rmSync(directory, { recursive: true, force: true });
}

console.log(passed ? "\nSMOKE TEST PASSED" : "\nSMOKE TEST FAILED");
process.exitCode = passed ? 0 : 1;
