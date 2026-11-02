// Saves a copy of every office and calendar page for the tests, from the real web, the way Discovery reads them.
// Stops at the first page that doesn't answer, because that address in src/office-pages.ts or
// src/milestone-pages.ts needs fixing.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MILESTONE_OFFICES } from "../src/milestone-pages.ts";
import { OFFICES, savedCopyName } from "../src/office-pages.ts";
import { realWeb } from "../src/web.ts";

const directory = fileURLToPath(new URL("../test/fixtures/office-pages/", import.meta.url));
mkdirSync(directory, { recursive: true });
const web = realWeb();

for (const page of [...OFFICES, ...MILESTONE_OFFICES].flatMap((office) => office.pages)) {
  const { status, text } = await web.get(page);
  if (status !== 200) throw new Error(`${page} answered ${status}`);
  writeFileSync(`${directory}${savedCopyName(page)}`, text);
  console.log(`${page}: ${text.length} characters`);
}
