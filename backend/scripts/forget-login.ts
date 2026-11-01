// Makes Buddy's Browser forget a site's login: npm run forget-login [site]
import { startLocalBackend } from "./local-backend.ts";

const id = process.argv[2] ?? "canvas";
const backend = await startLocalBackend();

try {
  await backend.browserAccess.forgetLogin(id);
  console.log(`Forgot the login for ${id}.`);
} finally {
  await backend.close();
}
