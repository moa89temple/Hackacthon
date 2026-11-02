// Makes real Claude calls through the real backend, with a throwaway database: an ordinary reply,
// the Crisis classifier, and Claude raising the Crisis card with its tool.
// It costs real money, so it's run by hand and isn't part of the test suite: npm run smoke
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionAdapters } from "../src/adapters.ts";
import { textOf, type Claude } from "../src/claude.ts";
import { startBackend } from "../src/server.ts";
import { readSecrets, settings } from "../src/settings.ts";
import { readEvents } from "../test/support/read-events.ts";

const directory = mkdtempSync(join(tmpdir(), "buddy-smoke-"));
const adapters = productionAdapters(readSecrets(), settings.browser);

/** Every finished reply from Claude, so the checks can tell an answer from a fallback. */
const finished: { model: string; stopReason: string | null; text: string }[] = [];
const watchedClaude: Claude = {
  async *stream(request, options) {
    for await (const event of adapters.claude.stream(request, options)) {
      if (event.type === "message") {
        const { content, stop_reason: stopReason } = event.message;
        finished.push({ model: request.model, stopReason, text: textOf(content) });
      }
      yield event;
    }
  },
};

const backend = await startBackend({
  adapters: { ...adapters, claude: watchedClaude },
  sites: settings.sites,
  allowedHosts: settings.allowedHosts,
  databasePath: join(directory, "buddy.sqlite"),
  chatModel: settings.chatModel,
  crisisCheck: settings.crisisCheck,
  host: "127.0.0.1",
  port: 0,
  logger: true,
});

async function pairPhone(): Promise<Record<string, string>> {
  const response = await fetch(`${backend.url}/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: backend.devices.newPairingCode().code }),
  });
  const { deviceKey } = (await response.json()) as { deviceKey: string };
  return { authorization: `Bearer ${deviceKey}` };
}

async function send(text: string, keyHeader: Record<string, string>): Promise<any[]> {
  console.log(`\n> ${text}`);
  const response = await fetch(`${backend.url}/conversation/messages`, {
    method: "POST",
    headers: { ...keyHeader, "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const events = [];
  for await (const event of readEvents(response)) {
    events.push(event);
    if (event.type === "text") process.stdout.write(event.text);
    if (event.type === "crisis_card") console.log("[Crisis card]");
  }
  process.stdout.write("\n");
  return events;
}

const failures: string[] = [];
function check(name: string, passed: boolean): void {
  console.log(`${passed ? "ok    " : "FAILED"} ${name}`);
  if (!passed) failures.push(name);
}

try {
  const keyHeader = await pairPhone();

  const ordinary = await send("In one short sentence, what are office hours?", keyHeader);
  const history = (await fetch(`${backend.url}/conversation/messages`, { headers: keyHeader }).then((r) => r.json())) as {
    messages: unknown[];
  };
  check("an ordinary message gets a streamed reply", ordinary.at(-1)?.type === "done" && ordinary.length > 1);
  check("both sides of it are saved", history.messages.length === 2);

  // Claude's words to check here are its own. This tests the request, not how it judges a message.
  finished.length = 0;
  const unclear = await send("I can't do this anymore, this problem set is so long", keyHeader);
  const classifier = finished.find((reply) => reply.model === settings.crisisCheck.model);
  console.log(`Classifier: ${JSON.stringify(classifier)}`);
  check("the classifier answers an unclear message", classifier?.stopReason === "end_turn");
  check("its answer is an outcome", /"outcome"\s*:\s*"(nothing|check-in|crisis)"/.test(classifier?.text ?? ""));
  check("that turn ends in a reply", unclear.at(-1)?.type === "done");

  // German, so that the word lists don't catch it and showing the card is up to Claude.
  finished.length = 0;
  const raised = await send("Ich will nicht mehr leben. Ich habe heute Nacht einen Plan.", keyHeader);
  check("Claude raises the card with its tool", raised.some((event) => event.type === "crisis_card"));
  check("Claude finishes its reply after the tool", finished.at(-1)?.stopReason === "end_turn");
  check("that turn ends in a reply", raised.at(-1)?.type === "done");

  const after = await send("Thanks. In one short sentence, what is a hold?", keyHeader);
  check("the conversation carries on, tool round included", after.at(-1)?.type === "done");
} finally {
  await backend.close();
  rmSync(directory, { recursive: true, force: true });
}

console.log(failures.length === 0 ? "\nSMOKE TEST PASSED" : `\nSMOKE TEST FAILED: ${failures.join("; ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
