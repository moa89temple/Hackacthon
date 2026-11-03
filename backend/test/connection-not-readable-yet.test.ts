import { afterEach, describe, expect, it } from "vitest";
import { ReadProblem, type ConnectionType } from "../src/connections.ts";
import { HANDSHAKE_ID } from "../src/handshake-rules.ts";
import { settings } from "../src/settings.ts";
import { BackendHarness, CALENDAR } from "./support/backend-harness.ts";

const WHY = "Buddy can't read Parked yet, because of how it loads its pages.";
const PARKED = "parked";

let backend: BackendHarness;
let reads = 0;

function parkedType(failing = false): ConnectionType {
  return {
    id: PARKED,
    name: "Parked",
    logsIn: true,
    card: { reads: ["Something."], notes: [], warning: null, address: null },
    whileOnTellClaude: "Call check_parked.",
    read: async () => {
      reads++;
      if (failing) throw new ReadProblem("Buddy opened Parked but couldn't make sense of it.");
      return [];
    },
    describeForClaude: () => "Nothing.",
  };
}

async function start(type: ConnectionType): Promise<void> {
  reads = 0;
  backend = await BackendHarness.start({ extraConnectionTypes: [type] });
}

const status = async () => (await backend.connections()).find((connection) => connection.id === PARKED)!;

afterEach(async () => {
  await backend.stop();
});

describe("a Connection Buddy can't read yet", () => {
  it("says why, and that's all the app needs to stop offering it", async () => {
    await start({ ...parkedType(), notReadableYet: WHY });

    expect(await status()).toMatchObject({ on: false, notReadableYet: WHY });
  });

  it("can't be given a Read Permission, and nothing gets opened", async () => {
    await start({ ...parkedType(), notReadableYet: WHY });

    const response = await backend.giveReadPermission(PARKED, null);

    expect(response.status).toBe(409);
    expect(reads).toBe(0);
    expect((await status()).on).toBe(false);
  });

  describe("when the Student had already connected it", () => {
    async function startConnectedThenParked(): Promise<void> {
      const type = parkedType(true);
      await start(type);
      await backend.giveReadPermission(PARKED, null);
      expect(reads).toBe(1);
      type.notReadableYet = WHY;
      reads = 0;
    }

    it("shows why instead of the old read's error", async () => {
      await startConnectedThenParked();

      expect(await status()).toMatchObject({ on: true, notReadableYet: WHY, lastReadProblem: null, needsLogin: false });
    });

    it("isn't read on the schedule", async () => {
      await startConnectedThenParked();

      await backend.readDueConnections();

      expect(reads).toBe(0);
    });

    it("isn't read when asked", async () => {
      await startConnectedThenParked();

      const response = await backend.readNow(PARKED);

      expect(response.status).toBe(409);
      expect(reads).toBe(0);
    });

    it("can still be revoked, which is how the Student deletes the login", async () => {
      await startConnectedThenParked();

      await backend.revokeReadPermission(PARKED);

      expect((await status()).on).toBe(false);
    });

    it("tells Claude it can't be read, not that it's connected", async () => {
      await startConnectedThenParked();
      backend.claude.willReply({ chunks: ["Hi."] });

      await backend.sendAndCollect("Hello");

      const note = JSON.stringify(backend.claude.requests.at(-1)!.messages);
      expect(note).not.toContain("Parked is connected");
      expect(note).not.toContain("check_parked");
      expect(note).toMatch(/Parked can't be read yet/);
    });
  });

  it("leaves the other Connections alone", async () => {
    await start({ ...parkedType(), notReadableYet: WHY });

    const calendar = (await backend.connections()).find((connection) => connection.id === CALENDAR)!;

    expect(calendar.notReadableYet).toBeNull();
  });
});

describe("Handshake, for now", () => {
  it("is marked as a Connection Buddy can't read yet", () => {
    const handshake = settings.connectionTypes.find((type) => type.id === HANDSHAKE_ID)!;

    expect(handshake.notReadableYet).toMatch(/can't read Handshake yet/);
  });

  it("isn't one Claude can suggest", async () => {
    backend = await BackendHarness.start();
    backend.claude.willReply({ chunks: ["Hi."] });

    await backend.sendAndCollect("Hello");

    const tool = backend.claude.requests[0]!.tools!.find((candidate: any) => candidate.name === "suggest_connection") as any;
    expect(tool.input_schema.properties.connection.enum).not.toContain(HANDSHAKE_ID);
    expect(String(backend.claude.requests[0]!.system)).toMatch(/can't read Handshake yet/);
  });

  it("every other Connection is still readable", () => {
    const others = settings.connectionTypes.filter((type) => type.id !== HANDSHAKE_ID);

    expect(others.length).toBeGreaterThan(0);
    expect(others.every((type) => type.notReadableYet === undefined)).toBe(true);
  });
});
