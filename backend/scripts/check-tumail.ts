// Checks the TUmail reader against the real login in Buddy's Browser, for someone who must not see the
// Student's mail. It runs the real reader through the real gate and prints only counts, cleaned addresses
// and the shape of a page, and it saves nothing: see tumail-check.ts. The Student must have tapped Give
// Read Permission on the phone first, which it reads from the real database and can't change.
//
// npm run check-tumail
//
// Exits 7 if the login works and the reader missed something. Otherwise it exits 0 if it read TUmail, 2 with no Read Permission, 3 during a Takeover, 4 if the login has expired,
// 5 if an old login is waiting to be deleted, and 6 if opening a message marked it read.
import { EXIT_FAILED, readStudentState } from "../src/canvas-check.ts";
import { containerBrowser } from "../src/container-browser.ts";
import { settings } from "../src/settings.ts";
import { tumail } from "../src/tumail.ts";
import { runTumailCheck } from "../src/tumail-check.ts";

const fail = (error: unknown) => {
  // Its words could quote a page, so only that it happened goes out.
  console.log(`The check stopped unexpectedly${error instanceof Error ? ` (${error.constructor.name})` : ""}. Nothing was saved.`);
  process.exit(EXIT_FAILED);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

process.exitCode = await runTumailCheck({
  browser: containerBrowser(settings.browser),
  connection: tumail,
  sites: settings.sites,
  student: () => readStudentState(settings.databasePath, tumail.id),
  print: (line) => console.log(line),
});
