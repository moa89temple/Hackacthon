// Checks the Canvas reader against the real login in Buddy's Browser, for someone who must not see the
// Student's records. It runs the real reader through the real gate and prints only counts, cleaned
// addresses and page structure, and it saves nothing: see canvas-check.ts. The Student must have tapped
// Give Read Permission on the phone first, which it reads from the real database and can't change.
//
// npm run check-canvas
//
// Exits 0 if it read Canvas, 2 with no Read Permission, 3 during a Takeover, 4 if the login has expired.
import { canvas } from "../src/canvas.ts";
import { EXIT_FAILED, readStudentState, runCanvasCheck } from "../src/canvas-check.ts";
import { containerBrowser } from "../src/container-browser.ts";
import { settings } from "../src/settings.ts";

const fail = (error: unknown) => {
  // Its words could quote a page, so only that it happened goes out.
  console.log(`The check stopped unexpectedly${error instanceof Error ? ` (${error.constructor.name})` : ""}. Nothing was saved.`);
  process.exit(EXIT_FAILED);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

process.exitCode = await runCanvasCheck({
  browser: containerBrowser(settings.browser),
  connection: canvas,
  sites: settings.sites,
  student: () => readStudentState(settings.databasePath, canvas.id),
  print: (line) => console.log(line),
});
