import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firebaseNotifier, firebaseNotifierFromFile, type ServiceAccount } from "../src/firebase-notifier.ts";
import type { PhoneNotification } from "../src/notifier.ts";
import { MovableClock } from "./support/movable-clock.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://fcm.googleapis.com/v1/projects/made-up-project/messages:send";
const PUSH_TOKEN = "made-up-push-token";
const NOTIFICATION: PhoneNotification = { title: "Your Briefing", body: "1 Milestone.", data: { type: "briefing" }, replaces: "briefing" };

/** Made fresh for each run of the tests, and never used for anything else. */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const SERVICE_ACCOUNT: ServiceAccount = { project_id: "made-up-project", client_email: "buddy@made-up-project.iam.gserviceaccount.test", private_key: privateKey };

interface Call {
  url: string;
  init: RequestInit;
}

/** Stands in for Google, in the way its documentation describes. Nothing here reaches the network. */
class FakeGoogle {
  readonly calls: Call[] = [];
  sendAnswers: { status: number; body?: unknown }[] = [];
  tokenAnswers: { status: number; body?: unknown }[] = [];
  #issued = 0;
  #fail: Error | null = null;

  failWith(error: Error): void {
    this.#fail = error;
  }

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    this.calls.push({ url, init });
    if (this.#fail) throw this.#fail;
    if (url === TOKEN_URL) {
      const answer = this.tokenAnswers.shift();
      if (answer) return Response.json(answer.body ?? {}, { status: answer.status });
      this.#issued++;
      return Response.json({ access_token: `access-${this.#issued}`, expires_in: 3599, token_type: "Bearer" });
    }
    const answer = this.sendAnswers.shift() ?? { status: 200, body: { name: "projects/made-up-project/messages/1" } };
    return Response.json(answer.body ?? {}, { status: answer.status });
  };

  get tokenCalls(): Call[] {
    return this.calls.filter(({ url }) => url === TOKEN_URL);
  }

  get sendCalls(): Call[] {
    return this.calls.filter(({ url }) => url === SEND_URL);
  }
}

function fcmError(status: number, code: string, errorCode?: string) {
  return {
    status,
    body: {
      error: {
        code: status,
        message: "Made up.",
        status: code,
        details: errorCode ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] : [],
      },
    },
  };
}

let google: FakeGoogle;
let clock: MovableClock;

beforeEach(() => {
  google = new FakeGoogle();
  clock = new MovableClock("2026-11-03T13:00:00Z");
});

const notifier = () => firebaseNotifier(SERVICE_ACCOUNT, clock, google.fetch);

describe("sending through Firebase Cloud Messaging", () => {
  it("is on", () => {
    expect(notifier().offBecause).toBeNull();
  });

  it("signs in as the service account with a signed token, for sending messages and nothing else", async () => {
    await notifier().send(PUSH_TOKEN, NOTIFICATION);

    const [{ init }] = google.tokenCalls as [Call];
    expect(init.method).toBe("POST");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const [header, claims, signature] = form.get("assertion")!.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: SERVICE_ACCOUNT.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: TOKEN_URL,
      iat: Date.parse("2026-11-03T13:00:00Z") / 1000,
      exp: Date.parse("2026-11-03T14:00:00Z") / 1000,
    });
    const signed = verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), createPublicKey(publicKey), Buffer.from(signature, "base64url"));
    expect(signed).toBe(true);
  });

  it("sends the message the v1 API asks for, to this project, with the access token", async () => {
    const answer = await notifier().send(PUSH_TOKEN, NOTIFICATION);

    expect(answer).toEqual({ outcome: "sent" });
    const [{ init }] = google.sendCalls as [Call];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer access-1", "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      message: {
        token: PUSH_TOKEN,
        notification: { title: "Your Briefing", body: "1 Milestone." },
        data: { type: "briefing" },
        android: { priority: "HIGH", collapse_key: "briefing", notification: { tag: "briefing" } },
      },
    });
  });

  it("keeps using an access token until it's nearly run out", async () => {
    const sender = notifier();

    await sender.send(PUSH_TOKEN, NOTIFICATION);
    clock.moveForward(50 * 60_000);
    await sender.send(PUSH_TOKEN, NOTIFICATION);
    expect(google.tokenCalls).toHaveLength(1);

    clock.moveForward(9 * 60_000);
    await sender.send(PUSH_TOKEN, NOTIFICATION);
    expect(google.tokenCalls).toHaveLength(2);
    expect(google.sendCalls[2]!.init.headers).toMatchObject({ authorization: "Bearer access-2" });
  });

  it("gets a new access token after Google refuses the old one", async () => {
    const sender = notifier();
    google.sendAnswers.push(fcmError(401, "UNAUTHENTICATED"));

    expect((await sender.send(PUSH_TOKEN, NOTIFICATION)).outcome).toBe("failed");
    await sender.send(PUSH_TOKEN, NOTIFICATION);

    expect(google.tokenCalls).toHaveLength(2);
  });

  it.each([
    ["the app was removed", fcmError(404, "NOT_FOUND", "UNREGISTERED")],
    ["the token belongs to another Firebase project", fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH")],
  ])("says the token is gone when %s", async (_, answer) => {
    google.sendAnswers.push(answer);

    expect(await notifier().send(PUSH_TOKEN, NOTIFICATION)).toEqual({ outcome: "token_gone" });
  });

  it.each([
    ["Firebase is busy", fcmError(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED")],
    ["Firebase is down", fcmError(503, "UNAVAILABLE", "UNAVAILABLE")],
    ["the service account can't send", fcmError(403, "PERMISSION_DENIED")],
    ["Firebase doesn't like the message", fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT")],
  ])("says it failed, to try again, when %s", async (_, answer) => {
    google.sendAnswers.push(answer);

    const sent = await notifier().send(PUSH_TOKEN, NOTIFICATION);

    expect(sent.outcome).toBe("failed");
    expect(JSON.stringify(sent)).not.toContain(PUSH_TOKEN);
  });

  it("says it failed, without throwing or giving anything away, when Google won't give an access token", async () => {
    google.tokenAnswers.push({ status: 400, body: { error: "invalid_grant", error_description: "Made up." } });

    const sent = await notifier().send(PUSH_TOKEN, NOTIFICATION);

    expect(sent.outcome).toBe("failed");
    expect(google.sendCalls).toEqual([]);
    expect(JSON.stringify(sent)).not.toContain("BEGIN PRIVATE KEY");
  });

  it("says it failed, without throwing, when there's no network", async () => {
    google.failWith(new Error(`Made up, mentioning ${PUSH_TOKEN}`));

    const sent = await notifier().send(PUSH_TOKEN, NOTIFICATION);

    expect(sent.outcome).toBe("failed");
    expect(JSON.stringify(sent)).not.toContain(PUSH_TOKEN);
  });
});

describe("the service account file", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "buddy-firebase-test-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("isn't needed: without one, phone notifications are off and say so plainly", async () => {
    const off = firebaseNotifierFromFile(undefined, clock);

    expect(off.offBecause).toMatch(/Phone notifications are off/);
    expect(off.offBecause).toContain("FIREBASE_SERVICE_ACCOUNT_FILE");
    expect((await off.send(PUSH_TOKEN, NOTIFICATION)).outcome).toBe("failed");
  });

  it("turns phone notifications on when it's good", () => {
    const path = join(directory, "account.json");
    writeFileSync(path, JSON.stringify({ type: "service_account", ...SERVICE_ACCOUNT }));

    expect(firebaseNotifierFromFile(path, clock).offBecause).toBeNull();
  });

  it("leaves them off, saying why, when the file isn't there", () => {
    const off = firebaseNotifierFromFile(join(directory, "missing.json"), clock);

    expect(off.offBecause).toMatch(/Phone notifications are off/);
    expect(off.offBecause).toContain("couldn't be read");
  });

  it.each([
    ["isn't JSON", "not json at all"],
    ["isn't a service account", JSON.stringify({ project_info: { project_id: "made-up-project" } })],
    ["has a key that can't be used", JSON.stringify({ type: "service_account", ...SERVICE_ACCOUNT, private_key: "not a key" })],
  ])("leaves them off, without repeating the file, when it %s", (_, contents) => {
    const path = join(directory, "account.json");
    writeFileSync(path, contents);

    const off = firebaseNotifierFromFile(path, clock);

    expect(off.offBecause).toMatch(/Phone notifications are off/);
    expect(off.offBecause).not.toContain("not a key");
    expect(off.offBecause).not.toContain("not json");
  });
});
