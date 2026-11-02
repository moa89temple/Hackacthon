// Checks the TUportal reader against the real login in Buddy's Browser, for someone who must not see the
// Student's records. It runs the real reader through the real gate and prints page shape only: which pages
// it understood, where they ended up, what the guard refused, and the structure of those it didn't
// understand. It never prints a hold, a balance or a name, or even whether there are holds, and it saves
// nothing: see tuportal-check.ts. The Student must have tapped Give Read Permission on the phone first,
// which it reads from the real database and can't change.
//
// npm run check-tuportal
//
// Exits 0 if it understood every page, 2 with no Read Permission, 3 during a Takeover, 4 if the login has
// expired, 5 while an old login waits to be deleted, and 6 if the login works but a page wasn't understood.
import { EXIT_FAILED, readStudentState } from "../src/canvas-check.ts";
import { containerBrowser } from "../src/container-browser.ts";
import { settings } from "../src/settings.ts";
import { runTuportalCheck } from "../src/tuportal-check.ts";
import { TUPORTAL_ID } from "../src/tuportal-rules.ts";

const fail = (error: unknown) => {
  // Its words could quote a page, so only that it happened goes out.
  console.log(`The check stopped unexpectedly${error instanceof Error ? ` (${error.constructor.name})` : ""}. Nothing was saved.`);
  process.exit(EXIT_FAILED);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

process.exitCode = await runTuportalCheck({
  browser: containerBrowser(settings.browser),
  sites: settings.sites,
  student: () => readStudentState(settings.databasePath, TUPORTAL_ID),
  print: (line) => console.log(line),
});
