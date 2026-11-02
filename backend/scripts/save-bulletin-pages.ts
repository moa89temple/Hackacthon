// Saves a copy of the Bulletin's list of programs and of a few program pages for the tests, from the real web,
// the way Buddy reads them. Stops at the first page that doesn't answer, because that address needs fixing.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { savedCopyName } from "../src/office-pages.ts";
import { realWeb } from "../src/web.ts";
import { SAVED_BULLETIN_PAGES } from "../test/support/bulletin-pages.ts";

const directory = fileURLToPath(new URL("../test/fixtures/bulletin-pages/", import.meta.url));
mkdirSync(directory, { recursive: true });
const web = realWeb();

for (const page of SAVED_BULLETIN_PAGES) {
  const { status, text } = await web.get(page);
  if (status !== 200) throw new Error(`${page} answered ${status}`);
  writeFileSync(`${directory}${savedCopyName(page)}`, text);
  console.log(`${page}: ${text.length} characters`);
}
