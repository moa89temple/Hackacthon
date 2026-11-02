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

/** A Profile fact as Buddy had it when it wrote a reply. */
export interface DecisionFact {
  text: string;
  detail?: string;
  /** Where the fact came from, in words for the Student. */
  from: string;
}

/** A page Buddy looked at for a reply. */
export interface DecisionSource {
  title: string;
  url: string;
}

/** How Buddy decided one reply. Kept as it was at the time, so later changes can't rewrite it. */
export interface ReplyDecision {
  /** The reply as the Student saw it. */
  reply: string;
  /** What Buddy's tools did and what else shaped the turn, in words from Buddy's code. */
  tools: string[];
  sources: DecisionSource[];
  facts: DecisionFact[];
}

export interface NewActivityEntry {
  kind: string;
  /** Written by Buddy's code, for the Student to read. */
  title: string;
  detail?: string | null;
  decision?: ReplyDecision | null;
  at: Date;
}

export interface StoredActivityEntry {
  id: number;
  kind: string;
  title: string;
  detail: string | null;
  decision: ReplyDecision | null;
  at: Date;
}

/** What one page says about one item, as Discovery checked it. Read by the Guidebook's own code. */
export interface GuidebookItemToStore {
  /** The same on every page that has this item, which is what merges duplicates. */
  key: string;
  name: string;
  fields: unknown;
}

/** One item with what each page says about it. An item with no pages left has left the Guidebook. */
export interface StoredGuidebookItem {
  id: number;
  mentions: { url: string; pageTitle: string; lastSeenAt: Date; fields: unknown }[];
}

/** A Guidebook card that was shown in the conversation. Its content comes from the Guidebook. */
export interface StoredGuidebookCard {
  itemId: number;
  afterMessageId: number;
  createdAt: Date;
}

/** The part of a Draft the Student can change. */
export interface DraftWords {
  subject: string;
  body: string;
}

/** A Draft for the Student to send. Who it's to comes from the Guidebook, by number. */
export interface StoredDraft extends DraftWords {
  id: number;
  contactId: number;
  /** The Contact's name when Buddy wrote it, for Activity, which keeps it even after the Contact goes. */
  contactName: string;
  why: string;
  afterMessageId: number;
  createdAt: Date;
  editedAt: Date | null;
}

export interface Store {
  /**
   * Appends the messages, and any Activity entry for them, together: either all of them are saved
   * or none are. Messages never change once saved.
   */
  appendMessages(studentId: string, messages: NewMessage[], entry?: NewActivityEntry): StoredMessage[];
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
  /** Saves the Read Permission and its Activity entry together. */
  giveReadPermission(
    studentId: string,
    connection: string,
    permission: { address: string | null; givenAt: Date },
    entry: NewActivityEntry,
  ): void;
  /**
   * Deletes the Read Permission, its address and every fact from this Connection, on disk too.
   * Activity's records of replies that had those facts keep their own copies.
   */
  revokeReadPermission(studentId: string, connection: string, entry: NewActivityEntry): void;
  /**
   * Brings this Connection's facts into line with a read, all together, and keeps the Student's
   * edits and deletions. If this Read Permission no longer stands, only the Activity entry is
   * saved, because the read did happen.
   */
  saveConnectionReading(
    studentId: string,
    permissionId: number,
    facts: ConnectionFactToStore[],
    readAt: Date,
    entry: NewActivityEntry,
  ): void;
  recordReadProblem(studentId: string, permissionId: number, problem: string, triedAt: Date, entry: NewActivityEntry): void;
  addReadPermissionCard(studentId: string, card: StoredReadPermissionCard): void;
  listReadPermissionCards(studentId: string): StoredReadPermissionCard[];
  /** Changes when the page's words do, so that an unchanged page needn't go to the model again. */
  guidebookPageHash(url: string): string | null;
  /**
   * Brings one page's items into line with a new reading of it, all together. An item it has stops
   * being missing, and one it no longer has starts being missing, unless it already was.
   */
  saveGuidebookPage(page: { url: string; title: string; textHash: string }, items: GuidebookItemToStore[], readAt: Date): void;
  /** The page's words haven't changed, so what it had is seen again and what it lacked stays missing. */
  confirmGuidebookPage(url: string, title: string, readAt: Date): void;
  /** Keeps the earliest time, for a page that's already failing. A page never read has nothing to lose. */
  markGuidebookPageFailing(url: string, at: Date): void;
  /**
   * Removes what went missing at or before this moment, or whose page stopped answering by then. A
   * page that stopped answering is forgotten too, so that it's read afresh if it returns. Reports stay.
   */
  removeMissingFromGuidebook(before: Date): void;
  /** Every item with a page left that nobody has reported. */
  listGuidebookItems(): StoredGuidebookItem[];
  /** Whether the item is still known, reported or not. */
  isGuidebookItem(id: number): boolean;
  /** Hides the item for every Student and adds the entry, once. */
  reportGuidebookItem(studentId: string, id: number, at: Date, entry: NewActivityEntry): void;
  /** Reported items stay known after they leave, so that they can't come back. */
  reportedGuidebookItems(): { id: number; name: string }[];
  /** When a page last answered Discovery. */
  lastDiscoveryAt(): Date | null;
  /** When Discovery last found that no page would answer. */
  lastDiscoveryFailureAt(): Date | null;
  /** Records a round of Discovery and its Activity entry together. */
  recordDiscovery(studentId: string, at: Date, entry: NewActivityEntry): void;
  /** The entry is left out when Activity already says so for this round. */
  recordDiscoveryFailure(studentId: string, at: Date, entry: NewActivityEntry | null): void;
  addGuidebookCard(studentId: string, card: StoredGuidebookCard): void;
  listGuidebookCards(studentId: string): StoredGuidebookCard[];
  /** Saves the Draft and its Activity entry together. */
  addDraft(studentId: string, draft: Omit<StoredDraft, "id" | "editedAt">, entry: NewActivityEntry): StoredDraft;
  /** Oldest first. */
  listDrafts(studentId: string): StoredDraft[];
  /** Saves the new words and the Activity entry together. Returns null if this Student has no such Draft. */
  editDraft(
    studentId: string,
    id: number,
    words: DraftWords,
    editedAt: Date,
    entry: NewActivityEntry,
  ): StoredDraft | null;
  /** Activity only ever grows: nothing here changes or removes one entry. */
  addActivity(studentId: string, entry: NewActivityEntry): void;
  /** Newest first. */
  listActivity(studentId: string): StoredActivityEntry[];
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
  `CREATE TABLE activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     detail TEXT,
     decision TEXT,
     at TEXT NOT NULL
   );
   CREATE INDEX activity_by_student ON activity (student_id, id);`,
  // Not keyed by Student: a Guidebook item and a Report on it are for every Student.
  `CREATE TABLE guidebook_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     item_key TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     reported_at TEXT
   );
   CREATE TABLE guidebook_pages (
     url TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     text_hash TEXT NOT NULL,
     failing_since TEXT
   );
   CREATE TABLE guidebook_mentions (
     item_id INTEGER NOT NULL,
     url TEXT NOT NULL,
     fields TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     missing_since TEXT,
     PRIMARY KEY (item_id, url)
   );
   CREATE TABLE discovery_runs (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     last_run_at TEXT,
     last_failed_at TEXT
   );
   CREATE TABLE guidebook_cards (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     after_message_id INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX guidebook_cards_by_student ON guidebook_cards (student_id, id);`,
  `CREATE TABLE drafts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     contact_item_id INTEGER NOT NULL,
     contact_name TEXT NOT NULL,
     why TEXT NOT NULL,
     subject TEXT NOT NULL,
     body TEXT NOT NULL,
     after_message_id INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     edited_at TEXT
   );
   CREATE INDEX drafts_by_student ON drafts (student_id, id);`,
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
  const insertActivity = db.prepare(
    `INSERT INTO activity (student_id, kind, title, detail, decision, at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectActivity = db.prepare(
    `SELECT id, kind, title, detail, decision, at FROM activity WHERE student_id = ? ORDER BY id DESC`,
  );
  const selectGuidebookPage = db.prepare(`SELECT text_hash FROM guidebook_pages WHERE url = ?`);
  const upsertGuidebookPage = db.prepare(
    `INSERT INTO guidebook_pages (url, title, text_hash) VALUES (?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET title = excluded.title, text_hash = excluded.text_hash, failing_since = NULL`,
  );
  const confirmPage = db.prepare(`UPDATE guidebook_pages SET title = ?, failing_since = NULL WHERE url = ?`);
  const confirmMentions = db.prepare(`UPDATE guidebook_mentions SET last_seen_at = ? WHERE url = ? AND missing_since IS NULL`);
  const markPageFailing = db.prepare(`UPDATE guidebook_pages SET failing_since = COALESCE(failing_since, ?) WHERE url = ?`);
  const upsertGuidebookItem = db.prepare(
    `INSERT INTO guidebook_items (item_key, name) VALUES (?, ?)
     ON CONFLICT (item_key) DO UPDATE SET name = excluded.name`,
  );
  const selectGuidebookItemId = db.prepare(`SELECT id FROM guidebook_items WHERE item_key = ?`);
  const upsertMention = db.prepare(
    `INSERT INTO guidebook_mentions (item_id, url, fields, last_seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (item_id, url) DO UPDATE SET
       fields = excluded.fields, last_seen_at = excluded.last_seen_at, missing_since = NULL`,
  );
  const markMentionsMissing = db.prepare(
    `UPDATE guidebook_mentions SET missing_since = ? WHERE url = ? AND missing_since IS NULL`,
  );
  const removeMissingMentions = db.prepare(
    `DELETE FROM guidebook_mentions WHERE missing_since <= ?1
       OR url IN (SELECT url FROM guidebook_pages WHERE failing_since <= ?1)`,
  );
  const forgetFailedPages = db.prepare(`DELETE FROM guidebook_pages WHERE failing_since <= ?`);
  const removeEmptyItems = db.prepare(
    `DELETE FROM guidebook_items WHERE reported_at IS NULL
       AND id NOT IN (SELECT item_id FROM guidebook_mentions)`,
  );
  const selectGuidebookMentions = db.prepare(
    `SELECT item.id, mention.url, page.title, mention.last_seen_at, mention.fields
     FROM guidebook_items item
     JOIN guidebook_mentions mention ON mention.item_id = item.id
     JOIN guidebook_pages page ON page.url = mention.url
     WHERE item.reported_at IS NULL
     ORDER BY item.id, mention.url`,
  );
  const selectGuidebookItem = db.prepare(`SELECT 1 FROM guidebook_items WHERE id = ?`);
  const reportItem = db.prepare(`UPDATE guidebook_items SET reported_at = ? WHERE id = ? AND reported_at IS NULL`);
  const selectReportedItems = db.prepare(`SELECT id, name FROM guidebook_items WHERE reported_at IS NOT NULL ORDER BY id`);
  const selectLastDiscovery = db.prepare(`SELECT last_run_at, last_failed_at FROM discovery_runs WHERE id = 1`);
  const upsertDiscovery = db.prepare(
    `INSERT INTO discovery_runs (id, last_run_at) VALUES (1, ?1) ON CONFLICT (id) DO UPDATE SET last_run_at = ?1`,
  );
  const upsertDiscoveryFailure = db.prepare(
    `INSERT INTO discovery_runs (id, last_failed_at) VALUES (1, ?1) ON CONFLICT (id) DO UPDATE SET last_failed_at = ?1`,
  );
  const insertGuidebookCard = db.prepare(
    `INSERT INTO guidebook_cards (student_id, item_id, after_message_id, created_at) VALUES (?, ?, ?, ?)`,
  );
  const selectGuidebookCards = db.prepare(
    `SELECT item_id, after_message_id, created_at FROM guidebook_cards WHERE student_id = ? ORDER BY id`,
  );
  const insertDraft = db.prepare(
    `INSERT INTO drafts (student_id, contact_item_id, contact_name, why, subject, body, after_message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectDrafts = db.prepare(
    `SELECT id, contact_item_id, contact_name, why, subject, body, after_message_id, created_at, edited_at
     FROM drafts WHERE student_id = ? ORDER BY id`,
  );
  const updateDraft = db.prepare(`UPDATE drafts SET subject = ?, body = ?, edited_at = ? WHERE student_id = ? AND id = ?`);
  const listDrafts = (studentId: string): StoredDraft[] =>
    selectDrafts.all(studentId).map((row: any) => ({
      id: row.id,
      contactId: row.contact_item_id,
      contactName: row.contact_name,
      why: row.why,
      subject: row.subject,
      body: row.body,
      afterMessageId: row.after_message_id,
      createdAt: new Date(row.created_at),
      editedAt: row.edited_at ? new Date(row.edited_at) : null,
    }));
  const addActivity = (studentId: string, entry: NewActivityEntry): void => {
    insertActivity.run(
      studentId,
      entry.kind,
      entry.title,
      entry.detail ?? null,
      entry.decision ? JSON.stringify(entry.decision) : null,
      entry.at.toISOString(),
    );
  };
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
    appendMessages(studentId, messages, entry) {
      return inTransaction(db, () => {
        if (entry) addActivity(studentId, entry);
        return messages.map((message) => {
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
        });
      });
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

    giveReadPermission(studentId, connection, permission, entry) {
      inTransaction(db, () => {
        insertPermission.run(studentId, connection, permission.address, permission.givenAt.toISOString());
        addActivity(studentId, entry);
      });
    },

    revokeReadPermission(studentId, connection, entry) {
      inTransaction(db, () => {
        addActivity(studentId, entry);
        deleteConnectionFacts.run(studentId, connection);
        deleteDeletedFacts.run(studentId, connection);
        deletePermission.run(studentId, connection);
      });
      // secure_delete covers the database file, and this empties the log of recent changes.
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    },

    saveConnectionReading(studentId, permissionId, facts, readAt, entry) {
      inTransaction(db, () => {
        addActivity(studentId, entry);
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

    recordReadProblem(studentId, permissionId, problem, triedAt, entry) {
      inTransaction(db, () => {
        addActivity(studentId, entry);
        recordProblem.run(triedAt.toISOString(), problem, permissionId);
      });
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

    guidebookPageHash(url) {
      return (selectGuidebookPage.get(url) as any)?.text_hash ?? null;
    },

    saveGuidebookPage(page, items, readAt) {
      inTransaction(db, () => {
        const at = readAt.toISOString();
        upsertGuidebookPage.run(page.url, page.title, page.textHash);
        // Everything counts as gone from the page, except what this reading then finds.
        markMentionsMissing.run(at, page.url);
        for (const item of items) {
          upsertGuidebookItem.run(item.key, item.name);
          const { id } = selectGuidebookItemId.get(item.key) as any;
          upsertMention.run(id, page.url, JSON.stringify(item.fields), at);
        }
      });
    },

    confirmGuidebookPage(url, title, readAt) {
      inTransaction(db, () => {
        confirmPage.run(title, url);
        confirmMentions.run(readAt.toISOString(), url);
      });
    },

    markGuidebookPageFailing(url, at) {
      markPageFailing.run(at.toISOString(), url);
    },

    removeMissingFromGuidebook(before) {
      inTransaction(db, () => {
        removeMissingMentions.run(before.toISOString());
        forgetFailedPages.run(before.toISOString());
        removeEmptyItems.run();
      });
    },

    listGuidebookItems() {
      const items = new Map<number, StoredGuidebookItem>();
      for (const row of selectGuidebookMentions.all() as any[]) {
        const item: StoredGuidebookItem = items.get(row.id) ?? { id: row.id, mentions: [] };
        item.mentions.push({
          url: row.url,
          pageTitle: row.title,
          lastSeenAt: new Date(row.last_seen_at),
          fields: JSON.parse(row.fields),
        });
        items.set(row.id, item);
      }
      return [...items.values()];
    },

    isGuidebookItem(id) {
      return selectGuidebookItem.get(id) !== undefined;
    },

    reportGuidebookItem(studentId, id, at, entry) {
      inTransaction(db, () => {
        if (reportItem.run(at.toISOString(), id).changes > 0) addActivity(studentId, entry);
      });
    },

    reportedGuidebookItems() {
      return selectReportedItems.all().map((row: any) => ({ id: row.id, name: row.name }));
    },

    lastDiscoveryAt() {
      const at = (selectLastDiscovery.get() as any)?.last_run_at;
      return at ? new Date(at) : null;
    },

    lastDiscoveryFailureAt() {
      const at = (selectLastDiscovery.get() as any)?.last_failed_at;
      return at ? new Date(at) : null;
    },

    recordDiscovery(studentId, at, entry) {
      inTransaction(db, () => {
        upsertDiscovery.run(at.toISOString());
        addActivity(studentId, entry);
      });
    },

    recordDiscoveryFailure(studentId, at, entry) {
      inTransaction(db, () => {
        upsertDiscoveryFailure.run(at.toISOString());
        if (entry) addActivity(studentId, entry);
      });
    },

    addGuidebookCard(studentId, card) {
      insertGuidebookCard.run(studentId, card.itemId, card.afterMessageId, card.createdAt.toISOString());
    },

    listGuidebookCards(studentId) {
      return selectGuidebookCards.all(studentId).map((row: any) => ({
        itemId: row.item_id,
        afterMessageId: row.after_message_id,
        createdAt: new Date(row.created_at),
      }));
    },

    addDraft(studentId, draft, entry) {
      return inTransaction(db, () => {
        const { lastInsertRowid } = insertDraft.run(
          studentId,
          draft.contactId,
          draft.contactName,
          draft.why,
          draft.subject,
          draft.body,
          draft.afterMessageId,
          draft.createdAt.toISOString(),
        );
        addActivity(studentId, entry);
        return { ...draft, id: Number(lastInsertRowid), editedAt: null };
      });
    },

    listDrafts,

    editDraft(studentId, id, words, editedAt, entry) {
      return inTransaction(db, () => {
        const { changes } = updateDraft.run(words.subject, words.body, editedAt.toISOString(), studentId, id);
        if (changes === 0) return null;
        addActivity(studentId, entry);
        return listDrafts(studentId).find((draft) => draft.id === id) ?? null;
      });
    },

    addActivity,

    listActivity(studentId) {
      return selectActivity.all(studentId).map((row: any) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        detail: row.detail,
        decision: row.decision ? JSON.parse(row.decision) : null,
        at: new Date(row.at),
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
