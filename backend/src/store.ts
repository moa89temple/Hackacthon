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
  /** What the Student sees in place of the content, when that isn't what Claude wrote. */
  shownText?: string | null;
  createdAt: Date;
}

export interface StoredMessage {
  id: number;
  role: NewMessage["role"];
  content: unknown;
  stopReason: string | null;
  shownText: string | null;
  createdAt: Date;
}

/** A Crisis card that was shown. Its content comes from the app's code, so only its place is kept. */
export interface StoredCrisisCard {
  afterMessageId: number;
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

/** Something Buddy knows about the Student, and where it came from. */
export interface StoredProfileFact {
  id: number;
  text: string;
  originType: "conversation";
  originMessageId: number;
  savedAt: Date;
  editedAt: Date | null;
}

export interface Store {
  /** Appends the messages together: either all of them are saved or none are. Messages never change once saved. */
  appendMessages(studentId: string, messages: NewMessage[]): StoredMessage[];
  listMessages(studentId: string): StoredMessage[];
  addCrisisCard(studentId: string, card: StoredCrisisCard): void;
  listCrisisCards(studentId: string): StoredCrisisCard[];
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
  addProfileFact(studentId: string, fact: Omit<StoredProfileFact, "id" | "editedAt">): StoredProfileFact;
  listProfileFacts(studentId: string): StoredProfileFact[];
  /** Returns the edited fact, or null if this Student has no such fact. */
  editProfileFact(studentId: string, id: number, text: string, editedAt: Date): StoredProfileFact | null;
  /** Returns whether this Student had such a fact. */
  deleteProfileFact(studentId: string, id: number): boolean;
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
  `ALTER TABLE messages ADD COLUMN shown_text TEXT;
   CREATE TABLE crisis_cards (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     after_message_id INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX crisis_cards_by_student ON crisis_cards (student_id, id);`,
  `CREATE TABLE profile_facts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     text TEXT NOT NULL,
     origin_type TEXT NOT NULL,
     origin_message_id INTEGER,
     saved_at TEXT NOT NULL,
     edited_at TEXT
   );
   CREATE INDEX profile_facts_by_student ON profile_facts (student_id, id);`,
];

export function openStore(databasePath: string): Store {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);

  const insert = db.prepare(
    `INSERT INTO messages (student_id, role, content, stop_reason, shown_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const select = db.prepare(
    `SELECT id, role, content, stop_reason, shown_text, created_at FROM messages WHERE student_id = ? ORDER BY id`,
  );
  const insertCrisisCard = db.prepare(
    `INSERT INTO crisis_cards (student_id, after_message_id, created_at) VALUES (?, ?, ?)`,
  );
  const selectCrisisCards = db.prepare(
    `SELECT after_message_id, created_at FROM crisis_cards WHERE student_id = ? ORDER BY id`,
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
  const insertFact = db.prepare(
    `INSERT INTO profile_facts (student_id, text, origin_type, origin_message_id, saved_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const selectFacts = db.prepare(
    `SELECT id, text, origin_type, origin_message_id, saved_at, edited_at FROM profile_facts WHERE student_id = ? ORDER BY id`,
  );
  const updateFact = db.prepare(`UPDATE profile_facts SET text = ?, edited_at = ? WHERE student_id = ? AND id = ?`);
  const deleteFact = db.prepare(`DELETE FROM profile_facts WHERE student_id = ? AND id = ?`);
  const listFacts = (studentId: string): StoredProfileFact[] =>
    selectFacts.all(studentId).map((row: any) => ({
      id: row.id,
      text: row.text,
      originType: row.origin_type,
      originMessageId: row.origin_message_id,
      savedAt: new Date(row.saved_at),
      editedAt: row.edited_at ? new Date(row.edited_at) : null,
    }));

  return {
    appendMessages(studentId, messages) {
      return inTransaction(db, () =>
        messages.map((message) => {
          const stopReason = message.stopReason ?? null;
          const shownText = message.shownText ?? null;
          const { lastInsertRowid } = insert.run(
            studentId,
            message.role,
            JSON.stringify(message.content),
            stopReason,
            shownText,
            message.createdAt.toISOString(),
          );
          return { ...message, id: Number(lastInsertRowid), stopReason, shownText };
        }),
      );
    },

    listMessages(studentId) {
      return select.all(studentId).map((row: any) => ({
        id: row.id,
        role: row.role,
        content: JSON.parse(row.content),
        stopReason: row.stop_reason,
        shownText: row.shown_text,
        createdAt: new Date(row.created_at),
      }));
    },

    addCrisisCard(studentId, card) {
      insertCrisisCard.run(studentId, card.afterMessageId, card.createdAt.toISOString());
    },

    listCrisisCards(studentId) {
      return selectCrisisCards.all(studentId).map((row: any) => ({
        afterMessageId: row.after_message_id,
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

    addProfileFact(studentId, fact) {
      const { lastInsertRowid } = insertFact.run(
        studentId,
        fact.text,
        fact.originType,
        fact.originMessageId,
        fact.savedAt.toISOString(),
      );
      return { ...fact, id: Number(lastInsertRowid), editedAt: null };
    },

    listProfileFacts: listFacts,

    editProfileFact(studentId, id, text, editedAt) {
      const { changes } = updateFact.run(text, editedAt.toISOString(), studentId, id);
      return changes === 0 ? null : (listFacts(studentId).find((fact) => fact.id === id) ?? null);
    },

    deleteProfileFact(studentId, id) {
      return deleteFact.run(studentId, id).changes !== 0;
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
