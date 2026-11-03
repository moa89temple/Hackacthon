// Checks the Handshake reader against the real login in Buddy's Browser, for someone who must not see the
// Student's records. It runs the real reader through the real gate and prints only counts, cleaned addresses
// and shapes, it saves nothing, and it sends nothing to Claude: see handshake-check.ts. The Student must have
// tapped Give Read Permission on the phone first, which it reads from the real database and can't change.
//
// Nobody has seen real Handshake yet, so this is what to correct handshake-rules.ts and handshake-pages.ts by.
//
// npm run check-handshake
//
// Exits 0 if the reader got what it came for, 2 with no Read Permission, 3 during a Takeover, 4 if the Student
// isn't logged in, 5 if an old login still has to go, and 7 if the login works and the reader missed something.
import { EXIT_FAILED, readStudentState } from "../src/canvas-check.ts";
import { containerBrowser } from "../src/container-browser.ts";
import { handshake } from "../src/handshake.ts";
import { runHandshakeCheck } from "../src/handshake-check.ts";
import { settings } from "../src/settings.ts";

const fail = (error: unknown) => {
  // Its words could quote a page, so only that it happened goes out.
  console.log(`The check stopped unexpectedly${error instanceof Error ? ` (${error.constructor.name})` : ""}. Nothing was saved.`);
  process.exit(EXIT_FAILED);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

process.exitCode = await runHandshakeCheck({
  browser: containerBrowser(settings.browser),
  connection: handshake,
  sites: settings.sites,
  student: () => readStudentState(settings.databasePath, handshake.id),
  print: (line) => console.log(line),
});
