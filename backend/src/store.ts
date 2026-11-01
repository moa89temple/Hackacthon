import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** This version has one Student, but all data is keyed by Student so more can come later. */
export const THE_STUDENT = "the-student";

export interface NewMessage {
  role: "user" | "assistant" | "system";
  /** Exactly what Claude was sent or returned, kept as JSON. */
  content: unknown;
  stopReason?: string | null;
  createdAt: Date;
}

export interface StoredMessage {
  id: number;
  role: NewMessage["role"];
  content: unknown;
  stopReason: string | null;
  createdAt: Date;
}

/** A Takeover under way. Saved so that Buddy stays locked out even if the backend restarts. */
export interface StoredTakeover {
  site: string;
  liveViewToken: string;
  startedAt: Date;
}

/** The code that can pair a phone now. Only its hash is kept. */
export interface StoredPairingCode {
  codeHash: string;
  expiresAt: Date;
  wrongTries: number;
}

export interface Store {
  /** Appends the messages together: either all of them are saved or none are. Messages never change once saved. */
  appendMessages(studentId: string, messages: NewMessage[]): StoredMessage[];
  listMessages(studentId: string): StoredMessage[];
  currentTakeover(studentId: string): StoredTakeover | null;
  beginTakeover(studentId: string, takeover: StoredTakeover): void;
  endTakeover(studentId: string): void;
  /** Replaces any code already saved. */
  savePairingCode(studentId: string, code: { codeHash: string; expiresAt: Date }): void;
  pairingCode(studentId: string): StoredPairingCode | null;
  countWrongPairingTry(studentId: string): void;
  deletePairingCode(studentId: string): void;
  addDevice(studentId: string, device: { keyHash: string; pairedAt: Date }): void;
  isDeviceKey(keyHash: string): boolean;
  deviceKeyHashes(): string[];
  close(): void;
}

/** Each entry runs once, in order. Add new entries to the end; never edit one that has shipped. */
const MIGRATIONS = [
  `CREATE TABLE messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
     content TEXT NOT NULL,
     stop_reason TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX messages_by_student ON messages (student_id, id);`,
  `CREATE TABLE takeovers (
     student_id TEXT PRIMARY KEY,
     site TEXT NOT NULL,
     live_view_token TEXT NOT NULL,
     started_at TEXT NOT NULL
   );`,
  `CREATE TABLE devices (
     key_hash TEXT PRIMARY KEY,
     student_id TEXT NOT NULL,
     paired_at TEXT NOT NULL
   );
   CREATE TABLE pairing_codes (
     student_id TEXT PRIMARY KEY,
     code_hash TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     wrong_tries INTEGER NOT NULL
   );`,
];

export function openStore(databasePath: string): Store {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);

  const insert = db.prepare(
    `INSERT INTO messages (student_id, role, content, stop_reason, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const select = db.prepare(
    `SELECT id, role, content, stop_reason, created_at FROM messages WHERE student_id = ? ORDER BY id`,
  );
  const selectTakeover = db.prepare(
    `SELECT site, live_view_token, started_at FROM takeovers WHERE student_id = ?`,
  );
  const insertTakeover = db.prepare(
    `INSERT INTO takeovers (student_id, site, live_view_token, started_at) VALUES (?, ?, ?, ?)`,
  );
  const deleteTakeover = db.prepare(`DELETE FROM takeovers WHERE student_id = ?`);
  const upsertPairingCode = db.prepare(
    `INSERT OR REPLACE INTO pairing_codes (student_id, code_hash, expires_at, wrong_tries) VALUES (?, ?, ?, 0)`,
  );
  const selectPairingCode = db.prepare(
    `SELECT code_hash, expires_at, wrong_tries FROM pairing_codes WHERE student_id = ?`,
  );
  const countWrongTry = db.prepare(`UPDATE pairing_codes SET wrong_tries = wrong_tries + 1 WHERE student_id = ?`);
  const deletePairingCode = db.prepare(`DELETE FROM pairing_codes WHERE student_id = ?`);
  const insertDevice = db.prepare(`INSERT INTO devices (key_hash, student_id, paired_at) VALUES (?, ?, ?)`);
  const selectDevice = db.prepare(`SELECT 1 FROM devices WHERE key_hash = ?`);
  const selectDeviceKeys = db.prepare(`SELECT key_hash FROM devices`);

  return {
    appendMessages(studentId, messages) {
      return inTransaction(db, () =>
        messages.map((message) => {
          const stopReason = message.stopReason ?? null;
          const { lastInsertRowid } = insert.run(
            studentId,
            message.role,
            JSON.stringify(message.content),
            stopReason,
            message.createdAt.toISOString(),
          );
          return { ...message, id: Number(lastInsertRowid), stopReason };
        }),
      );
    },

    listMessages(studentId) {
      return select.all(studentId).map((row: any) => ({
        id: row.id,
        role: row.role,
        content: JSON.parse(row.content),
        stopReason: row.stop_reason,
        createdAt: new Date(row.created_at),
      }));
    },

    currentTakeover(studentId) {
      const row = selectTakeover.get(studentId) as any;
      if (!row) return null;
      return { site: row.site, liveViewToken: row.live_view_token, startedAt: new Date(row.started_at) };
    },

    beginTakeover(studentId, takeover) {
      insertTakeover.run(studentId, takeover.site, takeover.liveViewToken, takeover.startedAt.toISOString());
    },

    endTakeover(studentId) {
      deleteTakeover.run(studentId);
    },

    savePairingCode(studentId, code) {
      upsertPairingCode.run(studentId, code.codeHash, code.expiresAt.toISOString());
    },

    pairingCode(studentId) {
      const row = selectPairingCode.get(studentId) as any;
      if (!row) return null;
      return { codeHash: row.code_hash, expiresAt: new Date(row.expires_at), wrongTries: row.wrong_tries };
    },

    countWrongPairingTry(studentId) {
      countWrongTry.run(studentId);
    },

    deletePairingCode(studentId) {
      deletePairingCode.run(studentId);
    },

    addDevice(studentId, device) {
      insertDevice.run(device.keyHash, studentId, device.pairedAt.toISOString());
    },

    isDeviceKey(keyHash) {
      return selectDevice.get(keyHash) !== undefined;
    },

    deviceKeyHashes() {
      return selectDeviceKeys.all().map((row: any) => row.key_hash);
    },

    close() {
      db.close();
    },
  };
}

function migrate(db: DatabaseSync): void {
  const { user_version: applied } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  MIGRATIONS.slice(applied).forEach((sql, index) => {
    inTransaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${applied + index + 1}`);
    });
  });
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
