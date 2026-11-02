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
  /** The Student's message it came from, for a fact from the conversation. */
  originMessageId: number | null;
  /** The Connection it came from, for a fact from a Connection. */
  originConnection: string | null;
  /** Written by the backend and shown below the text, such as an event's times. */
  detail: string | null;
  /** What the Connection's own code keeps with the fact. Never shown to the Student or Claude as is. */
  data: unknown;
  savedAt: Date;
  editedAt: Date | null;
}

/** One fact from reading a Connection. The key stays the same from one read to the next. */
export interface ConnectionFactToStore {
  key: string;
  text: string;
  detail: string;
  data: unknown;
}

/** A Read Permission the Student gave. It lasts until they revoke it. */
export interface StoredReadPermission {
  id: number;
  connection: string;
  /** The secret address, for a Connection that's read through one. Never leaves the backend. */
  address: string | null;
  givenAt: Date;
  lastReadAt: Date | null;
  /** When Buddy last tried, whether it worked or not. */
  lastTriedAt: Date | null;
  /** What went wrong the last time, for the Student to read. Null once a read works. */
  lastReadProblem: string | null;
}

/** A Read Permission card that was shown in the conversation. Its content comes from the code. */
export interface StoredReadPermissionCard {
  connection: string;
  afterMessageId: number;
  createdAt: Date;
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
  addProfileFact(
    studentId: string,
    fact: { text: string; originMessageId: number; savedAt: Date },
  ): StoredProfileFact;
  listProfileFacts(studentId: string): StoredProfileFact[];
  /** Returns the edited fact, or null if this Student has no such fact. */
  editProfileFact(studentId: string, id: number, text: string, editedAt: Date): StoredProfileFact | null;
  /**
   * Returns whether this Student had such a fact. A fact from a Connection stays deleted through
   * later reads, until the Read Permission is revoked.
   */
  deleteProfileFact(studentId: string, id: number): boolean;
  readPermission(studentId: string, connection: string): StoredReadPermission | null;
  giveReadPermission(studentId: string, connection: string, permission: { address: string | null; givenAt: Date }): void;
  /** Deletes the Read Permission, its address and every fact from this Connection, on disk too. */
  revokeReadPermission(studentId: string, connection: string): void;
  /**
   * Brings this Connection's facts into line with a read, all together, and keeps the Student's
   * edits and deletions. Does nothing if this Read Permission no longer stands.
   */
  saveConnectionReading(studentId: string, permissionId: number, facts: ConnectionFactToStore[], readAt: Date): void;
  recordReadProblem(permissionId: number, problem: string, triedAt: Date): void;
  addReadPermissionCard(studentId: string, card: StoredReadPermissionCard): void;
  listReadPermissionCards(studentId: string): StoredReadPermissionCard[];
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
  `ALTER TABLE profile_facts ADD COLUMN origin_connection TEXT;
   ALTER TABLE profile_facts ADD COLUMN origin_key TEXT;
   ALTER TABLE profile_facts ADD COLUMN detail TEXT;
   ALTER TABLE profile_facts ADD COLUMN data TEXT;
   CREATE UNIQUE INDEX profile_facts_from_connection
     ON profile_facts (student_id, origin_connection, origin_key) WHERE origin_connection IS NOT NULL;
   CREATE TABLE read_permissions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     connection TEXT NOT NULL,
     address TEXT,
     given_at TEXT NOT NULL,
     last_read_at TEXT,
     last_tried_at TEXT,
     last_read_problem TEXT,
     UNIQUE (student_id, connection)
   );
   CREATE TABLE deleted_connection_facts (
     student_id TEXT NOT NULL,
     connection TEXT NOT NULL,
     origin_key TEXT NOT NULL,
     PRIMARY KEY (student_id, connection, origin_key)
   );
   CREATE TABLE read_permission_cards (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     connection TEXT NOT NULL,
     after_message_id INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX read_permission_cards_by_student ON read_permission_cards (student_id, id);`,
];

export function openStore(databasePath: string): Store {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  // So that what's deleted, such as a secret address, is overwritten rather than left in free space.
  db.exec("PRAGMA secure_delete = ON");
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
    `INSERT INTO profile_facts (student_id, text, origin_type, origin_message_id, saved_at) VALUES (?, ?, 'conversation', ?, ?)`,
  );
  const selectFacts = db.prepare(
    `SELECT id, text, origin_message_id, origin_connection, detail, data, saved_at, edited_at
     FROM profile_facts WHERE student_id = ? ORDER BY id`,
  );
  const updateFact = db.prepare(`UPDATE profile_facts SET text = ?, edited_at = ? WHERE student_id = ? AND id = ?`);
  const deleteFact = db.prepare(`DELETE FROM profile_facts WHERE student_id = ? AND id = ?`);
  const selectFactOrigin = db.prepare(`SELECT origin_connection, origin_key FROM profile_facts WHERE student_id = ? AND id = ?`);
  const insertDeletedFact = db.prepare(
    `INSERT OR IGNORE INTO deleted_connection_facts (student_id, connection, origin_key) VALUES (?, ?, ?)`,
  );
  const selectDeletedFacts = db.prepare(
    `SELECT origin_key FROM deleted_connection_facts WHERE student_id = ? AND connection = ?`,
  );
  const selectPermission = db.prepare(`SELECT * FROM read_permissions WHERE student_id = ? AND connection = ?`);
  const selectPermissionById = db.prepare(`SELECT connection FROM read_permissions WHERE student_id = ? AND id = ?`);
  const insertPermission = db.prepare(
    `INSERT INTO read_permissions (student_id, connection, address, given_at) VALUES (?, ?, ?, ?)`,
  );
  const deletePermission = db.prepare(`DELETE FROM read_permissions WHERE student_id = ? AND connection = ?`);
  const deleteConnectionFacts = db.prepare(`DELETE FROM profile_facts WHERE student_id = ? AND origin_connection = ?`);
  const deleteDeletedFacts = db.prepare(`DELETE FROM deleted_connection_facts WHERE student_id = ? AND connection = ?`);
  const selectConnectionFacts = db.prepare(
    `SELECT id, origin_key, edited_at FROM profile_facts WHERE student_id = ? AND origin_connection = ?`,
  );
  const insertConnectionFact = db.prepare(
    `INSERT INTO profile_facts (student_id, text, origin_type, origin_connection, origin_key, detail, data, saved_at)
     VALUES (?, ?, 'connection', ?, ?, ?, ?, ?)`,
  );
  const updateConnectionFact = db.prepare(`UPDATE profile_facts SET text = ?, detail = ?, data = ?, saved_at = ? WHERE id = ?`);
  const updateEditedConnectionFact = db.prepare(`UPDATE profile_facts SET detail = ?, data = ?, saved_at = ? WHERE id = ?`);
  const deleteFactById = db.prepare(`DELETE FROM profile_facts WHERE id = ?`);
  const recordRead = db.prepare(
    `UPDATE read_permissions SET last_read_at = ?, last_tried_at = ?, last_read_problem = NULL WHERE id = ?`,
  );
  const recordProblem = db.prepare(`UPDATE read_permissions SET last_tried_at = ?, last_read_problem = ? WHERE id = ?`);
  const insertPermissionCard = db.prepare(
    `INSERT INTO read_permission_cards (student_id, connection, after_message_id, created_at) VALUES (?, ?, ?, ?)`,
  );
  const selectPermissionCards = db.prepare(
    `SELECT connection, after_message_id, created_at FROM read_permission_cards WHERE student_id = ? ORDER BY id`,
  );
  const listFacts = (studentId: string): StoredProfileFact[] =>
    selectFacts.all(studentId).map((row: any) => ({
      id: row.id,
      text: row.text,
      originMessageId: row.origin_message_id,
      originConnection: row.origin_connection,
      detail: row.detail,
      data: row.data ? JSON.parse(row.data) : null,
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
      const { lastInsertRowid } = insertFact.run(studentId, fact.text, fact.originMessageId, fact.savedAt.toISOString());
      return { ...fact, id: Number(lastInsertRowid), originConnection: null, detail: null, data: null, editedAt: null };
    },

    listProfileFacts: listFacts,

    editProfileFact(studentId, id, text, editedAt) {
      const { changes } = updateFact.run(text, editedAt.toISOString(), studentId, id);
      return changes === 0 ? null : (listFacts(studentId).find((fact) => fact.id === id) ?? null);
    },

    deleteProfileFact(studentId, id) {
      return inTransaction(db, () => {
        const origin = selectFactOrigin.get(studentId, id) as any;
        if (origin?.origin_connection) insertDeletedFact.run(studentId, origin.origin_connection, origin.origin_key);
        return deleteFact.run(studentId, id).changes !== 0;
      });
    },

    readPermission(studentId, connection) {
      const row = selectPermission.get(studentId, connection) as any;
      if (!row) return null;
      return {
        id: row.id,
        connection: row.connection,
        address: row.address,
        givenAt: new Date(row.given_at),
        lastReadAt: row.last_read_at ? new Date(row.last_read_at) : null,
        lastTriedAt: row.last_tried_at ? new Date(row.last_tried_at) : null,
        lastReadProblem: row.last_read_problem,
      };
    },

    giveReadPermission(studentId, connection, permission) {
      insertPermission.run(studentId, connection, permission.address, permission.givenAt.toISOString());
    },

    revokeReadPermission(studentId, connection) {
      inTransaction(db, () => {
        deleteConnectionFacts.run(studentId, connection);
        deleteDeletedFacts.run(studentId, connection);
        deletePermission.run(studentId, connection);
      });
      // secure_delete covers the database file, and this empties the log of recent changes.
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    },

    saveConnectionReading(studentId, permissionId, facts, readAt) {
      inTransaction(db, () => {
        const permission = selectPermissionById.get(studentId, permissionId) as any;
        if (!permission) return;
        const at = readAt.toISOString();
        const incomingKeys = new Set(facts.map((fact) => fact.key));
        const deletedKeys = new Set(selectDeletedFacts.all(studentId, permission.connection).map((row: any) => row.origin_key));
        const existing = new Map(
          selectConnectionFacts.all(studentId, permission.connection).map((row: any) => [row.origin_key, row]),
        );

        for (const fact of facts) {
          if (deletedKeys.has(fact.key)) continue;
          const row: any = existing.get(fact.key);
          const data = JSON.stringify(fact.data);
          if (!row) {
            insertConnectionFact.run(studentId, fact.text, permission.connection, fact.key, fact.detail, data, at);
          } else if (row.edited_at) {
            updateEditedConnectionFact.run(fact.detail, data, at, row.id);
          } else {
            updateConnectionFact.run(fact.text, fact.detail, data, at, row.id);
          }
        }
        for (const [key, row] of existing as Map<string, any>) {
          if (incomingKeys.has(key)) continue;
          // The Student's own words stay, so that a series they renamed doesn't return under its old name.
          if (row.edited_at) updateEditedConnectionFact.run(null, null, at, row.id);
          else deleteFactById.run(row.id);
        }
        recordRead.run(at, at, permissionId);
      });
    },

    recordReadProblem(permissionId, problem, triedAt) {
      recordProblem.run(triedAt.toISOString(), problem, permissionId);
    },

    addReadPermissionCard(studentId, card) {
      insertPermissionCard.run(studentId, card.connection, card.afterMessageId, card.createdAt.toISOString());
    },

    listReadPermissionCards(studentId) {
      return selectPermissionCards.all(studentId).map((row: any) => ({
        connection: row.connection,
        afterMessageId: row.after_message_id,
        createdAt: new Date(row.created_at),
      }));
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
