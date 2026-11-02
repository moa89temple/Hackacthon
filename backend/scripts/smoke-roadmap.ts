// Takes a Student with no Goal to a first Roadmap, with Temple's real Bulletin and calendar pages, real Haiku and
// real Claude, through the real backend with a throwaway database. Everything on the card is printed, so a person
// can read it against the pages. It costs real money, so it's run by hand and isn't part of the test suite:
// npm run smoke:roadmap
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionAdapters } from "../src/adapters.ts";
import { BULLETIN_PROGRAMS_PAGE, readBulletinPrograms, readSuggestedPlans } from "../src/bulletin-plan.ts";
import { startBackend } from "../src/server.ts";
import { readSecrets, settings } from "../src/settings.ts";
import { realWeb } from "../src/web.ts";
import { readEvents } from "../test/support/read-events.ts";

const directory = mkdtempSync(join(tmpdir(), "buddy-smoke-roadmap-"));
const backend = await startBackend({
  adapters: productionAdapters(readSecrets(), settings.browser),
  sites: settings.sites,
  connectionTypes: settings.connectionTypes,
  allowedHosts: settings.allowedHosts,
  databasePath: join(directory, "buddy.sqlite"),
  chatModel: settings.chatModel,
  crisisCheck: settings.crisisCheck,
  // Only the dates a Roadmap uses, so that it doesn't pay to read the office pages too.
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

const getJson = async (path: string): Promise<any> => (await fetch(`${backend.url}${path}`, { headers: keyHeader })).json();

function printMilestone(milestone: any): void {
  const badge = milestone.goal ? `Goal: ${milestone.goal.text}` : "Standard";
  const source = milestone.sources[0]?.url ?? milestone.sourceNote;
  console.log(`  ${milestone.when} | ${badge} | ${milestone.kind} | ${milestone.name} | ${source}`);
}

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
    if (event.type === "roadmap_card") {
      console.log(`\n[Roadmap card ${event.card.id}, ${event.card.kind}: ${event.card.why}]\n[Note: ${event.card.note}]`);
      event.card.milestones.forEach(printMilestone);
      for (const removed of event.card.removes) console.log(`  Remove: ${removed.name}`);
    }
  }
  process.stdout.write("\n");
  return events;
}

const cardsIn = (events: any[]) => events.filter((event) => event.type === "roadmap_card").map((event) => event.card);
const goals = async (): Promise<any[]> => (await getJson("/goals")).goals;
const roadmap = async (): Promise<any[]> => (await getJson("/roadmap")).milestones;

/** Claude is told to ask rather than guess, and a real run may take a turn more. This keeps the talk going. */
async function sendUntilCard(texts: string[]): Promise<any | undefined> {
  for (const text of texts) {
    const [card] = cardsIn(await send(text));
    if (card) return card;
  }
  return undefined;
}

try {
  // The Bulletin's tables, read by code, with no Claude involved. What it found on November 2, 2026.
  const web = realWeb();
  const programs = readBulletinPrograms((await web.get(BULLETIN_PROGRAMS_PAGE)).text);
  console.log(`\nThe Bulletin lists ${programs.length} undergraduate degrees`);
  check("it lists well over a hundred degrees", programs.length > 100);
  check("it lists Biology BS", programs.some((program) => program.name === "Biology BS"));
  const biology = readSuggestedPlans((await web.get(programs.find((program) => program.name === "Biology BS")!.url)).text);
  check("Biology BS has one plan of eight terms, each with courses", biology.length === 1 && biology[0]!.terms.length === 8 && biology[0]!.terms.every((term) => term.courses.length > 0));

  await backend.discovery.run();
  const standardDates = backend.milestones.upcoming();
  console.log(`\n${standardDates.length} upcoming Standard Milestones`);
  check("Discovery found Standard Milestones to use", standardDates.length > 0);

  const asked = await send("Can you make me a Roadmap for Temple?");
  check("with no Goal, it shows no card", cardsIn(asked).length === 0);
  check("with no Goal, it asks about one rather than just failing", asked.at(-1)?.type === "done" && /\?/.test(asked.at(-1).reply.text));
  check("no Goal has been saved for the Student yet", (await goals()).length === 0);

  await send("I'm not sure yet. I like helping people and I liked biology in high school. What would you suggest?");
  check("it suggests rather than choosing for them", (await goals()).length === 0);

  const card = await sendUntilCard([
    "I want to get into PA school. Please make my Roadmap.",
    "I'm a Biology major, the BS, in my second year at Temple.",
    "Yes, please go ahead.",
    "Go ahead and show me the card.",
  ]);
  const savedGoals = await goals();
  console.log(`\nGoals: ${savedGoals.map((goal) => goal.text).join("; ")}`);
  check("it saved the Goal they chose", savedGoals.length >= 1);
  check("it saved the major to the Profile", (await getJson("/profile/facts")).facts.some((fact: any) => /biology/i.test(fact.text)));
  check("it showed a Roadmap card", card !== undefined);

  if (card) {
    const milestones: any[] = card.milestones;
    check("the card has Standard Milestones with a Temple Source", milestones.some((milestone) => milestone.kind === "standard_date" && /temple\.edu/.test(milestone.sources[0]?.url ?? "")));
    check("the card has the Plan's terms, from the Bulletin", milestones.some((milestone) => milestone.kind === "plan" && milestone.sources[0]?.url.startsWith("https://bulletin.temple.edu/")));
    check("the card has Milestones Claude wrote for the Goal", milestones.some((milestone) => milestone.kind === "goal"));
    check("the card has going to office hours early", milestones.some((milestone) => /office hours/i.test(milestone.name)));
    check("the card has the internship search", milestones.some((milestone) => /internship/i.test(milestone.name)));
    check("each Goal has a Milestone", savedGoals.every((goal) => milestones.some((milestone) => milestone.goal?.id === goal.id)));
    check("each is a Goal's or Standard", milestones.every((milestone) => milestone.goal !== undefined));
    check("each has a date, and a Source or says why not", milestones.every((milestone) => /^\d{4}-/.test(milestone.dueDate) && (milestone.sources.length > 0 || milestone.sourceNote)));
    check("nothing has changed yet", (await roadmap()).length === 0);

    const typedYes = await send("Yes, accept it.");
    check("a typed yes shows no new card", cardsIn(typedYes).length === 0);
    check("a typed yes changes nothing", (await roadmap()).length === 0);

    const accepted = await fetch(`${backend.url}/roadmap/cards/${card.id}/accept`, { method: "POST", headers: keyHeader });
    check("one tap accepts it", accepted.status === 200);
    const onRoadmap = await roadmap();
    console.log(`\n${onRoadmap.length} Milestones on the Roadmap:`);
    onRoadmap.forEach(printMilestone);
    console.log(`\nA calendar link: ${onRoadmap[0]?.calendarUrl}`);
    check("the Roadmap now holds every Milestone", onRoadmap.length === milestones.length);
    check("each has an Add to Google Calendar link", onRoadmap.every((milestone) => milestone.calendarUrl.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE")));

    const later = await send("I've also decided I want to study abroad for a semester. Could you add that to my Roadmap?");
    const [change] = cardsIn(later);
    check("a change Buddy suggests comes as a card", change?.kind === "change");
    check("the new Goal is saved", (await goals()).length > savedGoals.length);
    check("the change hasn't happened yet", (await roadmap()).length === onRoadmap.length);
  }

  const entries = (await getJson("/activity")).entries as any[];
  console.log(`\nActivity kinds: ${[...new Set(entries.map((entry) => entry.kind))].join(", ")}`);
  check("Activity names the Bulletin page Buddy read", entries.some((entry) => entry.decision?.sources?.some((source: any) => source.url.startsWith("https://bulletin.temple.edu/"))));
} finally {
  await backend.close();
  rmSync(directory, { recursive: true, force: true });
}

console.log(failures.length === 0 ? "\nSMOKE TEST PASSED" : `\nSMOKE TEST FAILED: ${failures.join("; ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
