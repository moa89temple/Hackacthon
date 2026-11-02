// Reads Temple's real calendar and deadline pages with real Haiku, then asks real Claude about them, through
// the real backend with a throwaway database. Everything found is printed, so a person can read it against the
// pages. It costs real money, so it's run by hand and isn't part of the test suite: npm run smoke:milestones
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionAdapters } from "../src/adapters.ts";
import { startBackend } from "../src/server.ts";
import { readSecrets, settings } from "../src/settings.ts";
import { readEvents } from "../test/support/read-events.ts";

const directory = mkdtempSync(join(tmpdir(), "buddy-smoke-milestones-"));
const backend = await startBackend({
  adapters: productionAdapters(readSecrets(), settings.browser),
  sites: settings.sites,
  connectionTypes: settings.connectionTypes,
  allowedHosts: settings.allowedHosts,
  databasePath: join(directory, "buddy.sqlite"),
  chatModel: settings.chatModel,
  crisisCheck: settings.crisisCheck,
  // Only the pages this is about, so that it doesn't pay to read the office pages too.
  discovery: { ...settings.discovery, offices: [] },
  host: "127.0.0.1",
  port: 0,
  logger: true,
});

const failures: string[] = [];
function check(name: string, passed: boolean): void {
  console.log(`${passed ? "ok    " : "FAILED"} ${name}`);
  if (!passed) failures.push(name);
}

const paired = await fetch(`${backend.url}/devices/pair`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: backend.devices.newPairingCode().code }),
});
const { deviceKey } = (await paired.json()) as { deviceKey: string };
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
    if (event.type === "milestone_card") {
      console.log(`[Card: ${event.milestone.name} | ${event.milestone.when} | ${event.milestone.sources[0].url}]`);
    }
  }
  process.stdout.write("\n");
  return events;
}

const cards = (events: any[]) => events.filter((event) => event.type === "milestone_card").map((event) => event.milestone);
const replyOf = (events: any[]): string => events.at(-1)?.reply?.text ?? "";
const saysNoSource = (reply: string) => /(couldn't|could not|can't|cannot|don't|didn't|wasn't able to|unable to)\b.{0,60}\b(find|have|source|confirm)/i.test(reply);

try {
  const startedAt = Date.now();
  await backend.discovery.run();
  console.log(`\nDiscovery took ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

  const entries = (await fetch(`${backend.url}/activity`, { headers: keyHeader }).then((r) => r.json())) as { entries: any[] };
  const read = entries.entries[0];
  console.log(`${read.title}: ${read.detail}`);
  const pages = settings.discovery.milestoneOffices.flatMap((office) => office.pages);
  check("every calendar and deadline page answered", read.detail.startsWith(`Read ${pages.length} of ${pages.length} pages.`));

  const { milestones } = (await fetch(`${backend.url}/milestones/upcoming`, { headers: keyHeader }).then((r) => r.json())) as { milestones: any[] };
  console.log(`\n${milestones.length} upcoming Standard Milestones:`);
  for (const milestone of milestones) {
    console.log(`  ${milestone.when} | ${milestone.term ?? "no term"} | ${milestone.name} | ${milestone.sources.map((source: any) => source.url).join(" ")}`);
  }
  for (const url of pages) {
    console.log(`  ${milestones.filter((milestone) => milestone.sources.some((source: any) => source.url === url)).length} upcoming from ${url}`);
  }
  check("each has a Temple Source", milestones.length > 0 && milestones.every((milestone) => milestone.sources.every((source: any) => /(registrar|sfs)\.temple\.edu\//.test(source.url))));

  // What the saved pages said on November 2, 2026. If one fails, compare it with its page, which may have changed.
  const has = (date: string, words: RegExp) => backend.milestones.search(words.source).some((milestone) => milestone.date === date && words.test(milestone.name));
  check("the last day to withdraw from a 16-week course in Fall 2026 is December 7", has("2026-12-07", /withdraw/i));
  check("final exams begin December 9", has("2026-12-09", /final/i));
  check("priority registration for Fall 2027 begins March 29, 2027", has("2027-03-29", /registration/i));
  check("the FAFSA priority deadline is February 1, 2027", has("2027-02-01", /fafsa/i));
  // By "2026-27", because the page itself leaves out the word FAFSA on this line.
  check("the last day to submit a 2026-27 FAFSA for Spring 2027 is April 19, 2027", has("2027-04-19", /2026-27/));
  check("there's nothing for grading", !milestones.some((milestone) => /grading/i.test(milestone.name)));
  check("there's nothing for a holiday", !milestones.some((milestone) => /thanksgiving|labor day/i.test(milestone.name)));

  const withdraw = await send("When's the last day to withdraw?");
  check("the withdrawal question ends in a reply", withdraw.at(-1)?.type === "done");
  check("it gives December 7", /December 7/i.test(replyOf(withdraw)));
  check("it shows a card with the date and a Source", cards(withdraw).some((milestone) => milestone.date === "2026-12-07" && milestone.sources.length > 0));

  const finals = await send("When are finals this semester?");
  check("it gives a December date for finals", /December (9|1[0-5])/i.test(replyOf(finals)));
  check("it shows a card for finals", cards(finals).some((milestone) => /final/i.test(milestone.name)));

  const fafsa = await send("I need to renew my FAFSA. When's the deadline?");
  check("it gives February 1 for the FAFSA", /February 1\b/i.test(replyOf(fafsa)));
  check("it shows a card for the FAFSA", cards(fafsa).some((milestone) => /fafsa/i.test(milestone.name)));

  const parking = await send("When do Temple student parking permits expire?");
  check("it names no date it has no Source for", cards(parking).length === 0);
  check("it says it couldn't find a Source", saysNoSource(replyOf(parking)));
} finally {
  await backend.close();
  rmSync(directory, { recursive: true, force: true });
}

console.log(failures.length === 0 ? "\nSMOKE TEST PASSED" : `\nSMOKE TEST FAILED: ${failures.join("; ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
