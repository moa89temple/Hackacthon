// Shows the QR code that pairs a phone with this backend: npm run pair
// The backend can be running or not. The code goes into the database they share, and it's never
// served over the network, so only someone at this laptop can make one.
import qrcode from "qrcode-terminal";
import { systemClock } from "../src/clock.ts";
import { createDevices } from "../src/devices.ts";
import { pairingLink } from "../src/pairing-link.ts";
import { readTailscaleAddress, settings } from "../src/settings.ts";
import { openStore } from "../src/store.ts";

const EMULATOR_ADDRESS = `http://10.0.2.2:${settings.port}`;
/** Light squares on dark, whatever the terminal's colors, so that a phone's camera can read it. */
const QR_COLORS = "\x1b[97;40m";
const RESET_COLORS = "\x1b[0m";

const tailscaleAddress = readTailscaleAddress();
const address = tailscaleAddress ?? EMULATOR_ADDRESS;

const store = openStore(settings.databasePath);
const { code, expiresAt } = createDevices({ store, clock: systemClock }).newPairingCode();
store.close();

qrcode.generate(pairingLink(address, code), { small: true }, (qr) => {
  const lines = qr.split("\n").map((line) => `${QR_COLORS}${line}${RESET_COLORS}`);
  console.log(`\nScan this with the Buddy app, or type the address and code into it.\n\n${lines.join("\n")}\n`);
});

console.log(`Address: ${address}`);
console.log(`Code:    ${code}`);
console.log(`\nThis code works once, until ${expiresAt.toLocaleTimeString()}. Run this again for a new one.`);
if (!tailscaleAddress) {
  console.log("\nThis address only works from the Android emulator. See the README to set up a real phone.");
}
