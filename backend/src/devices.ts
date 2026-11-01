import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { Clock } from "./clock.ts";
import { THE_STUDENT, type Store } from "./store.ts";

const PAIRING_CODE_LIFETIME_MS = 5 * 60_000;
/** A code has about 39 bits, so this leaves a guesser no real chance. */
const WRONG_TRIES_ALLOWED = 5;
/** No I, L, O or U, which are easy to misread or to type as something else. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;

const LIVE_VIEW_PATH = /^\/takeover\/live\/([^/]+)\//;
const PASS_COOKIE = "buddy_live_view";

export interface Devices {
  /** Makes the one code that can pair a phone now. Any earlier code stops working. */
  newPairingCode(): { code: string; expiresAt: Date };
  /** Uses up a pairing code and returns the new phone's key, or null if the code isn't good. */
  pair(typedCode: string): string | null;
  /** Whether a request for this path comes from a paired phone. */
  allows(headers: IncomingHttpHeaders, path: string): boolean;
  /**
   * The cookie that lets a WebView use the live view of one Takeover, for a request that carries a
   * device key. A WebView can only add a header when it opens the page, not to the page's scripts
   * or its socket. So the page's response gives it this instead of the key: the key stays out of
   * the WebView's cookie file, and a pass is no use for anything but this Takeover.
   */
  liveViewCookie(headers: IncomingHttpHeaders, liveViewToken: string): string | null;
  anyPaired(): boolean;
}

export function createDevices({ store, clock }: { store: Store; clock: Clock }): Devices {
  function presentedKeyHash(headers: IncomingHttpHeaders): string | null {
    const key = /^Bearer (\S+)$/.exec(headers.authorization ?? "")?.[1];
    if (!key) return null;
    const keyHash = sha256(key);
    return store.isDeviceKey(keyHash) ? keyHash : null;
  }

  return {
    newPairingCode() {
      const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      const expiresAt = new Date(clock.now().getTime() + PAIRING_CODE_LIFETIME_MS);
      store.savePairingCode(THE_STUDENT, { codeHash: sha256(code), expiresAt });
      return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt };
    },

    pair(typedCode) {
      const stored = store.pairingCode(THE_STUDENT);
      if (!stored) return null;

      if (clock.now() >= stored.expiresAt) {
        store.deletePairingCode(THE_STUDENT);
        return null;
      }

      const typed = typedCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (sha256(typed) !== stored.codeHash) {
        if (stored.wrongTries + 1 >= WRONG_TRIES_ALLOWED) store.deletePairingCode(THE_STUDENT);
        else store.countWrongPairingTry(THE_STUDENT);
        return null;
      }

      store.deletePairingCode(THE_STUDENT);
      const deviceKey = randomBytes(32).toString("base64url");
      store.addDevice(THE_STUDENT, { keyHash: sha256(deviceKey), pairedAt: clock.now() });
      return deviceKey;
    },

    allows(headers, path) {
      if (presentedKeyHash(headers)) return true;

      const token = LIVE_VIEW_PATH.exec(path)?.[1];
      const pass = cookieValue(headers.cookie, PASS_COOKIE);
      if (!token || !pass) return false;
      return store.deviceKeyHashes().some((keyHash) => constantTimeEquals(livePass(keyHash, token), pass));
    },

    liveViewCookie(headers, liveViewToken) {
      const keyHash = presentedKeyHash(headers);
      if (!keyHash) return null;
      // Not marked Secure, because the emulator reaches the backend over plain HTTP on this laptop.
      // A release build of the app won't connect to any address that isn't HTTPS.
      return (
        `${PASS_COOKIE}=${livePass(keyHash, liveViewToken)}; ` +
        `Path=/takeover/live/${liveViewToken}/; HttpOnly; SameSite=Strict`
      );
    },

    anyPaired() {
      return store.deviceKeyHashes().length > 0;
    },
  };
}

/**
 * Worked out from what's stored rather than saved, so that it still works after a restart, and stops
 * working once the Takeover ends or the phone is no longer paired.
 */
function livePass(keyHash: string, liveViewToken: string): string {
  return createHmac("sha256", keyHash).update(liveViewToken).digest("base64url");
}

/** Keys and codes are stored only as hashes. Keys are long and random, so a plain hash is enough. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function constantTimeEquals(a: string, b: string): boolean {
  const [left, right] = [Buffer.from(a), Buffer.from(b)];
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === name) return value;
  }
  return undefined;
}
