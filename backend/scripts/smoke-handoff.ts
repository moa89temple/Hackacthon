// Reads Temple's real office pages with real Haiku, then asks real Claude for Handoffs, through the real
// backend with a throwaway database. The Drafts are printed, so a person can read them for the Student's
// voice. It costs real money, so it's run by hand and isn't part of the test suite: npm run smoke:handoff
// The name below is made up, and exists only in this throwaway conversation.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionAdapters } from "../src/adapters.ts";
import { AI_LINE } from "../src/drafts.ts";
import { startBackend } from "../src/server.ts";
import { readSecrets, settings } from "../src/settings.ts";
import { readEvents } from "../test/support/read-events.ts";

const directory = mkdtempSync(join(tmpdir(), "buddy-smoke-handoff-"));
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
    if (event.type === "guidebook_card") console.log(`[Card: ${event.item.kind} ${event.item.name} | ${event.item.sources[0].url}]`);
    if (event.type === "draft_card") {
      const { contact, why, subject, body } = event.draft;
      console.log(`[Draft to ${contact.name} <${contact.email}>\nWhy: ${why}\nSubject: ${subject}\n\n${body}\n]`);
    }
  }
  process.stdout.write("\n");
  return events;
}

const drafts = (events: any[]) => events.filter((event) => event.type === "draft_card").map((event) => event.draft);
const replyOf = (events: any[]): string => events.at(-1)?.reply?.text ?? "";

try {
  await backend.discovery.run();

  const hold = await send(
    "I'm Maria Lopez, a sophomore. I got a hold on my account and I can't register, and I don't understand why. I need to talk to someone at student financial services. Can you help me write to them?",
  );
  const [draft] = drafts(hold);
  check("it makes one Handoff", drafts(hold).length === 1);
  check("it names a Contact from the Guidebook", draft?.contact?.kind === "contact");
  check("the Contact has a Temple Source", (draft?.contact?.sources ?? []).length > 0 && draft.contact.sources.every((source: any) => source.url.includes(".temple.edu/")));
  check("it shows the Contact's card", hold.some((event) => event.type === "guidebook_card" && event.item.id === draft?.contact?.id));
  check("it says why", (draft?.why ?? "").length > 0);
  check("the Draft is in the Student's name", /Maria/.test(draft?.body ?? ""));
  check("the Draft is in the first person", /\bI\b/.test(draft?.body ?? ""));
  check("the Draft ends with the AI line, once", Boolean(draft?.body.endsWith(AI_LINE)) && draft.body.split(AI_LINE).length === 2);
  check("it doesn't say it sent anything", !/\b(I've|I have) sent\b/i.test(replyOf(hold)));

  const explain = await send("Actually, could you explain what a hold is yourself first?");
  check("it explains the issue itself when asked", explain.at(-1)?.type === "done" && /hold/i.test(replyOf(explain)));
  check("it makes no new Handoff for that", drafts(explain).length === 0);

  const parking = await send("How much does a student parking permit cost at Temple?");
  check("it doesn't name a price it has no Source for", !/\$\d/.test(replyOf(parking)));
  check("it offers a Handoff when it has no Source", /draft|write|reach out|contact/i.test(replyOf(parking)));
  console.log("(Read that reply: does it offer to write to one named Contact, rather than sending the Student to an advisor?)");

  const { entries } = (await fetch(`${backend.url}/activity`, { headers: keyHeader }).then((response) => response.json())) as { entries: any[] };
  check("the Draft is in Activity", entries.some((entry) => entry.kind === "draft_written"));
} finally {
  await backend.close();
  rmSync(directory, { recursive: true, force: true });
}

console.log(failures.length === 0 ? "\nSMOKE TEST PASSED" : `\nSMOKE TEST FAILED: ${failures.join("; ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
