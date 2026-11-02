// Checks that a login in Buddy's Browser works, by reading the site's home page through the same
// gate Buddy uses, so it's refused during a Takeover. Prints only the title and how much was read,
// because the page holds the Student's own records: npm run check-login [site]
import { settings } from "../src/settings.ts";
import { startLocalBackend } from "./local-backend.ts";

const sites: Record<string, { name: string; homeUrl: string; loginHosts: string[] }> = settings.sites;
const id = process.argv[2] ?? "canvas";
const site = sites[id];
if (!site) throw new Error(`Unknown site: ${id}`);

const backend = await startLocalBackend();

try {
  const page = await backend.browserAccess.readToCheckLogin(id);
  const url = new URL(page.url);
  console.log(`Landed on: ${url.hostname}${url.pathname}`);
  console.log(`Title: ${page.title}`);
  console.log(`Text read: ${page.text.length} characters`);
  console.log(`Accessibility snapshot read: ${page.accessibilitySnapshot.length} characters`);
} finally {
  await backend.close();
}
