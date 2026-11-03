// Reads now.temple.edu's real events with real Haiku, then runs one real web search for a Goal, through the real
// backend with a throwaway database. Everything found is printed, so a person can read it against its Sources.
// A page a plain fetch can't read goes through Buddy's Browser, under the guard, if that's running.
// It costs real money and takes minutes, so it's run by hand and isn't part of the test suite: npm run smoke:opportunities
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionAdapters } from "../src/adapters.ts";
import { startBackend } from "../src/server.ts";
import { readSecrets, settings } from "../src/settings.ts";

const GOAL = process.argv[2] ?? "Get into a physician assistant program";

const directory = mkdtempSync(join(tmpdir(), "buddy-smoke-opportunities-"));
const backend = await startBackend({
  adapters: productionAdapters(readSecrets(), settings.browser),
  sites: settings.sites,
  publicHosts: settings.publicHosts,
  connectionTypes: settings.connectionTypes,
  allowedHosts: settings.allowedHosts,
  databasePath: join(directory, "buddy.sqlite"),
  chatModel: settings.chatModel,
  crisisCheck: settings.crisisCheck,
  discovery: settings.discovery,
  host: "127.0.0.1",
  port: 0,
  logger: true,
});

const failures: string[] = [];
function check(name: string, passed: boolean): void {
  console.log(`${passed ? "ok    " : "FAILED"} ${name}`);
  if (!passed) failures.push(name);
}

const pairing = await fetch(`${backend.url}/devices/pair`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: backend.devices.newPairingCode().code }),
});
const { deviceKey } = (await pairing.json()) as { deviceKey: string };
const keyHeader = { authorization: `Bearer ${deviceKey}` };

await fetch(`${backend.url}/goals`, {
  method: "POST",
  headers: { ...keyHeader, "content-type": "application/json" },
  body: JSON.stringify({ text: GOAL }),
});
await backend.opportunityDiscovery.runDue();

const listed = (await (await fetch(`${backend.url}/opportunities`, { headers: keyHeader })).json()) as { opportunities: any[] };
const activity = (await (await fetch(`${backend.url}/activity`, { headers: keyHeader })).json()) as { entries: any[] };
for (const entry of activity.entries) console.log(`[Activity] ${entry.title}\n           ${entry.detail ?? ""}`);
for (const item of listed.opportunities) {
  console.log(`\n${item.outsideTemple ? "[Outside Temple] " : ""}${item.name}\n  ${item.when}\n  ${item.cost}${item.worthItBecause ? `\n  Worth it: ${item.worthItBecause}` : ""}\n  ${item.summary}\n  For: ${item.forGoals.join(", ") || "any Student"}\n  Source: ${item.sources.map((source: any) => source.url).join(", ")}`);
}

const temples = listed.opportunities.filter((item) => !item.outsideTemple);
const outside = listed.opportunities.filter((item) => item.outsideTemple);
check("read some of Temple's events", temples.length > 0);
check("the search found something for the Goal", listed.opportunities.some((item) => item.forGoals.includes(GOAL)));
check("every one has a date and a Source", listed.opportunities.every((item) => item.when && item.sources.length > 0));
check("every one with a fee says what it costs and why", listed.opportunities.filter((item) => item.worthItBecause).every((item) => item.cost.startsWith("Costs ")));
check("Temple's come first", listed.opportunities.findIndex((item) => item.outsideTemple) === -1 || listed.opportunities.findIndex((item) => item.outsideTemple) === temples.length);
console.log(`\n${temples.length} at Temple, ${outside.length} outside Temple.`);

await backend.close();
rmSync(directory, { recursive: true, force: true });
if (failures.length > 0) process.exit(1);
