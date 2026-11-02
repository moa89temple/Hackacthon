// Reads Temple's real office pages with real Haiku, then asks real Claude about them, through the real
// backend with a throwaway database. Everything found is printed, so a person can read it against the pages.
// It costs real money, so it's run by hand and isn't part of the test suite: npm run smoke:guidebook
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionAdapters } from "../src/adapters.ts";
import { startBackend } from "../src/server.ts";
import { readSecrets, settings } from "../src/settings.ts";
import { readEvents } from "../test/support/read-events.ts";

const directory = mkdtempSync(join(tmpdir(), "buddy-smoke-guidebook-"));
const backend = await startBackend({
  adapters: productionAdapters(readSecrets(), settings.browser),
  sites: settings.sites,
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

const response = await fetch(`${backend.url}/devices/pair`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: backend.devices.newPairingCode().code }),
});
const { deviceKey } = (await response.json()) as { deviceKey: string };
const keyHeader = { authorization: `Bearer ${deviceKey}` };

async function send(text: string): Promise<any[]> {
  console.log(`\n> ${text}`);
  const reply = await fetch(`${backend.url}/conversation/messages`, {
    method: "POST",
    headers: { ...keyHeader, "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const events = [];
  for await (const event of readEvents(reply)) {
    events.push(event);
    if (event.type === "text") process.stdout.write(event.text);
    if (event.type === "guidebook_card") {
      console.log(`[Card: ${event.item.name} | ${event.item.cost} | ${event.item.phone} | ${event.item.sources[0].url}]`);
    }
  }
  process.stdout.write("\n");
  return events;
}

const cards = (events: any[]) => events.filter((event) => event.type === "guidebook_card").map((event) => event.item);
const replyOf = (events: any[]): string => events.at(-1)?.reply?.text ?? "";
const saysNoSource = (reply: string) => /(couldn't|could not|can't|cannot|don't|didn't|wasn't able to|unable to)\b.{0,60}\b(find|have|source|confirm)/i.test(reply);

async function activity(): Promise<any[]> {
  const entries = await fetch(`${backend.url}/activity`, { headers: keyHeader }).then((r) => r.json());
  return (entries as { entries: any[] }).entries;
}

try {
  const startedAt = Date.now();
  await backend.discovery.run();
  console.log(`\nDiscovery took ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  const [read] = await activity();
  console.log(`${read.title}: ${read.detail}`);
  const pages = settings.discovery.offices.flatMap((office) => office.pages).length;
  check("every office page answered", read.detail.startsWith(`Read ${pages} of ${pages} pages.`));

  for (const term of ["writing", "tutoring", "counseling", "career", "financial aid", "disability", "dean", "wellness"]) {
    const found = backend.guidebook.search(term);
    console.log(`\n"${term}":`);
    for (const item of found) {
      console.log(`  [${item.kind}] ${item.name}: ${item.summary} | ${item.cost} | ${item.phone} | ${item.email} | ${item.place} | ${item.hours} | ${item.sources.map((source) => source.url).join(" ")}`);
    }
    check(`the Guidebook has something for "${term}"`, found.length > 0);
  }

  const essay = await send("Where can I get help with my essay?");
  check("the essay question ends in a reply", essay.at(-1)?.type === "done");
  check("it shows the Writing Center's card", cards(essay).some((item) => /writing/i.test(item.name)));
  check("each card has a Temple Source", cards(essay).every((item) => item.sources.every((source: any) => source.url.includes(".temple.edu/"))));
  const decision = (await activity()).find((entry) => entry.decision).decision;
  console.log(`How Buddy decided: ${JSON.stringify({ tools: decision.tools, sources: decision.sources })}`);
  check("how Buddy decided lists the Sources", decision.sources.length > 0);

  const counseling = await send("How do I reach Tuttleman Counseling?");
  check("it shows a card for Tuttleman", cards(counseling).some((item) => /tuttleman|counseling/i.test(item.name)));

  const parking = await send("How much does a student parking permit cost at Temple?");
  check("it doesn't name a price it has no Source for", !/\$\d/.test(replyOf(parking)));
  check("it says it couldn't find a Source", saysNoSource(replyOf(parking)));

  const madeUp = await send("What's the phone number for Temple's Office of Underwater Basket Weaving?");
  check("it shows no card for an office that doesn't exist", cards(madeUp).length === 0);
  check("it gives no phone number for it", !/\d{3}[-.) ]+\d{3}[-. ]\d{4}/.test(replyOf(madeUp)));
  check("it says it couldn't find a Source for that too", saysNoSource(replyOf(madeUp)));

  const fromMemory = await send("Temple's bursar is in Conwell Hall, right? And what's their phone number?");
  check("it doesn't give a phone number from memory", cards(fromMemory).length > 0 || !/\d{3}[-.) ]+\d{3}[-. ]\d{4}/.test(replyOf(fromMemory)));

  const general = await send("In one short sentence, what's a credit hour?");
  check("a general college question still gets an answer", general.at(-1)?.type === "done" && replyOf(general).length > 0);
} finally {
  await backend.close();
  rmSync(directory, { recursive: true, force: true });
}

console.log(failures.length === 0 ? "\nSMOKE TEST PASSED" : `\nSMOKE TEST FAILED: ${failures.join("; ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
