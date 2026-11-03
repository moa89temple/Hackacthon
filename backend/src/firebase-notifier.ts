import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Clock } from "./clock.ts";
import { offNotifier, type Notifier, type NotifyOutcome, type PhoneNotification } from "./notifier.ts";

/** The parts of the file Firebase gives a project's service account that Buddy uses. */
export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Google's address, whatever the file says, so that the file can't send the signed token anywhere else. */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const SIGNED_TOKEN_LIFETIME_S = 3600;
/** So that a token can't run out on its way there. */
const RENEW_BEFORE_EXPIRY_MS = 5 * 60_000;
const TIMEOUT_MS = 30_000;
const STILL_ON_TODAY = "Briefings still show on the Today tab.";

/** The answers that mean this token will never reach a phone again. Anything else may work if tried again. */
const TOKEN_IS_GONE = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);

const base64Url = (text: string) => Buffer.from(text).toString("base64url");

/** The token Google swaps for an access token: RS256 with the service account's key, which never leaves this laptop. */
function signedToken({ client_email, private_key }: ServiceAccount, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({ iss: client_email, scope: SCOPE, aud: TOKEN_URL, iat: issuedAt, exp: issuedAt + SIGNED_TOKEN_LIFETIME_S }),
  )}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(private_key).toString("base64url")}`;
}

/** What Firebase calls the problem, if it says. */
async function errorCodeIn(response: Response): Promise<string | null> {
  try {
    const { error } = (await response.json()) as { error?: { status?: string; details?: { errorCode?: string }[] } };
    return error?.details?.find(({ errorCode }) => errorCode)?.errorCode ?? error?.status ?? null;
  } catch {
    return null;
  }
}

/** Sends through the FCM HTTP v1 API. Errors never carry the token, the key or the words sent. */
export function firebaseNotifier(account: ServiceAccount, clock: Clock, fetchFrom: typeof fetch = fetch): Notifier {
  let access: { token: string; renewAt: number } | null = null;
  const sendUrl = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;

  /** Null if Google won't give one. */
  async function accessToken(): Promise<string | null> {
    const now = clock.now();
    if (access && now.getTime() < access.renewAt) return access.token;
    const response = await fetchFrom(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedToken(account, now) }).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const { access_token, expires_in } = (await response.json()) as { access_token: string; expires_in: number };
    access = { token: access_token, renewAt: now.getTime() + expires_in * 1000 - RENEW_BEFORE_EXPIRY_MS };
    return access_token;
  }

  async function send(token: string, { title, body, data, replaces }: PhoneNotification): Promise<NotifyOutcome> {
    const bearer = await accessToken();
    if (!bearer) return { outcome: "failed", problem: "Google refused Buddy's Firebase service account." };
    const response = await fetchFrom(sendUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          // A phone's push token is its Firebase Installation ID, which is what Firebase now says to send to.
          fid: token,
          notification: { title, body },
          data,
          android: { priority: "high", collapse_key: replaces, notification: { tag: replaces } },
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { outcome: "sent" };
    if (response.status === 401) access = null;
    const code = await errorCodeIn(response);
    if (code && TOKEN_IS_GONE.has(code)) return { outcome: "token_gone" };
    return { outcome: "failed", problem: `Firebase answered ${response.status}${code ? ` (${code})` : ""}.` };
  }

  return {
    offBecause: null,
    async send(token, notification) {
      try {
        return await send(token, notification);
      } catch {
        // A failure's own error is left behind, so that nothing it mentions ends up in the logs.
        return { outcome: "failed", problem: "Firebase couldn't be reached." };
      }
    },
  };
}

function parsedAccount(contents: string): ServiceAccount | null {
  try {
    const { type, project_id, client_email, private_key } = JSON.parse(contents) as Record<string, unknown>;
    if (type !== "service_account" || typeof project_id !== "string" || typeof client_email !== "string" || typeof private_key !== "string") return null;
    createPrivateKey(private_key);
    return { project_id, client_email, private_key };
  } catch {
    return null;
  }
}

/** Phone notifications through Firebase if the file is there and good. If not, the backend still runs, and says why they're off. */
export function firebaseNotifierFromFile(path: string | undefined, clock: Clock): Notifier {
  if (!path) return offNotifier(`Phone notifications are off, because FIREBASE_SERVICE_ACCOUNT_FILE isn't set in .env.local. ${STILL_ON_TODAY}`);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return offNotifier(`Phone notifications are off, because the file FIREBASE_SERVICE_ACCOUNT_FILE names couldn't be read. ${STILL_ON_TODAY}`);
  }
  const account = parsedAccount(contents);
  if (!account) return offNotifier(`Phone notifications are off, because the file FIREBASE_SERVICE_ACCOUNT_FILE names isn't a Firebase service account. ${STILL_ON_TODAY}`);
  return firebaseNotifier(account, clock);
}
