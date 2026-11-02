// Checks the Navigate360 reader against the real login in Buddy's Browser, for someone who must not see
// the Student's records. It runs the real reader through the real gate and prints only counts, cleaned
// addresses and shapes, and it saves nothing: see navigate360-check.ts. The Student must have tapped
// Give Read Permission on the phone first, which it reads from the real database and can't change.
//
// npm run check-navigate360
//
// Exits 0 if it opened Navigate360, 2 with no Read Permission, 3 during a Takeover, 4 if the login has expired.
import { EXIT_FAILED, readStudentState } from "../src/canvas-check.ts";
import { containerBrowser } from "../src/container-browser.ts";
import { navigate360 } from "../src/navigate360.ts";
import { runNavigate360Check } from "../src/navigate360-check.ts";
import { settings } from "../src/settings.ts";

const fail = (error: unknown) => {
  // Its words could quote a page, so only that it happened goes out.
  console.log(`The check stopped unexpectedly${error instanceof Error ? ` (${error.constructor.name})` : ""}. Nothing was saved.`);
  process.exit(EXIT_FAILED);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

process.exitCode = await runNavigate360Check({
  browser: containerBrowser(settings.browser),
  connection: navigate360,
  sites: settings.sites,
  student: () => readStudentState(settings.databasePath, navigate360.id),
  print: (line) => console.log(line),
});
