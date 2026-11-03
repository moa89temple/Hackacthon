// Starts one real Task from a real chat turn, through the real backend with a throwaway database, and prints what it did,
// so a person can read what it found against its Sources. No phone is told, no Connection is on and no card can be tapped.
// It costs real money, at most about what the $1 pause allows, and takes minutes, so it's run by hand and isn't part
// of the test suite: npm run smoke:tasks
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionAdapters } from "../src/adapters.ts";
import { startBackend } from "../src/server.ts";
import { readSecrets, settings } from "../src/settings.ts";

const ASKED = process.argv[2] ?? "Please start a background Task: find paid summer research programs for biology majors, then check my Profile and tell me which I qualify for.";

const directory = mkdtempSync(join(tmpdir(), "buddy-smoke-tasks-"));
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
  logger: { level: "error", stream: { write: (line) => console.error(line.slice(0, 2000)) } },
});

const failures: string[] = [];
function check(name: string, passed: boolean): void {
  console.log(`${passed ? "ok    " : "FAILED"} ${name}`);
  if (!passed) failures.push(name);
}

try {
  const pairing = await fetch(`${backend.url}/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: backend.devices.newPairingCode().code }),
  });
  const { deviceKey } = (await pairing.json()) as { deviceKey: string };
  const headers = { "x-device-key": deviceKey, authorization: `Bearer ${deviceKey}`, "content-type": "application/json" };

  const stopWatching = backend.tasks.watch((task) => console.log(`  [${task.state}] ${task.steps.at(-1) ?? ""}`));
  const turn = await fetch(`${backend.url}/conversation/messages`, { method: "POST", headers, body: JSON.stringify({ text: ASKED }) });
  const stream = await turn.text();
  console.log(stream.split("\n").filter((line) => line.includes('"done"') || line.includes('"error"')).join("\n").slice(0, 600));
  check("the chat turn started a Task, with a card", stream.includes('"task_card"'));

  await backend.tasks.idle();
  stopWatching();

  const [task] = backend.tasks.list();
  if (task) {
    console.log(`\nState: ${task.state}\nCost: $${(task.spentNanodollars / 1e9).toFixed(4)}\nSteps:\n${task.steps.map((step) => `  ${step}`).join("\n")}`);
    console.log(`\nResult:\n${task.result ?? task.problem ?? task.needs.join(" ")}`);
    console.log(`\nSources:\n${task.sources.map(({ title, url }) => `  ${title}: ${url}`).join("\n")}`);
    check("it ended or stopped to ask, rather than failing", task.state === "done" || (task.state === "needs_student" && task.askingToSpend));
    check("it stayed within what it may spend", task.spentNanodollars <= task.allowanceNanodollars);
    check("it searched the web", task.steps.some((step) => step.startsWith("Searched the web")));
  }
  console.log(`\nSpent today: $${(backend.spending.today().total / 1e9).toFixed(4)}`);
} finally {
  await backend.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
