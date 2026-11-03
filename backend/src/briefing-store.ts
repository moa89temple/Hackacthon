import type { DatabaseSync } from "node:sqlite";
import { USUAL_BRIEFING_TIMES, type BriefingKind, type BriefingTimes } from "./briefing-schedule.ts";
import type { NewActivityEntry } from "./store.ts";

/** Briefings' storage, in its own file. Store.briefings is how the rest of the backend reaches it. */

export const BRIEFING_MIGRATION = `CREATE TABLE briefing_schedules (
     student_id TEXT PRIMARY KEY,
     weekdays_time TEXT NOT NULL,
     sunday_time TEXT NOT NULL,
     handled_up_to TEXT NOT NULL
   );
   CREATE TABLE briefings (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     made_at TEXT NOT NULL,
     contents TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT,
     told_sent INTEGER NOT NULL DEFAULT 0,
     told_failed INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE push_tokens (
     device_key_hash TEXT PRIMARY KEY,
     student_id TEXT NOT NULL,
     token TEXT NOT NULL UNIQUE,
     last_briefing_id INTEGER NOT NULL
   );`;

/**
 * What's in a Briefing, as ids and nothing else. The app gets each one's current words when it asks, so
 * that a Report, a revoked Read Permission or a deleted fact takes it out of the Briefing too, and no
 * words from a Connection stay behind here.
 */
export interface BriefingContents {
  standardMilestoneIds: number[];
  roadmapMilestoneIds: number[];
  opportunityIds: number[];
  connectionEventIds: number[];
}

export interface StoredBriefing {
  id: number;
  kind: BriefingKind;
  madeAt: Date;
  contents: BriefingContents;
  title: string;
  /** What the phone notification says. Null when nothing was relevant, so no notification goes. */
  body: string | null;
  toldSent: boolean;
  toldFailed: boolean;
}

export interface NewBriefing {
  kind: BriefingKind;
  madeAt: Date;
  contents: BriefingContents;
  title: string;
  body: string | null;
}

export interface StoredPushToken {
  token: string;
  /** The newest Briefing this phone has been sent. */
  lastBriefingId: number;
}

export interface BriefingStore {
  times(studentId: string): BriefingTimes;
  /** The moment every Briefing due until then has been dealt with. Null until the schedule first runs. */
  handledUpTo(studentId: string): Date | null;
  startSchedule(studentId: string, now: Date): void;
  /** Saves the times, the moment to count from, and the Activity entry together. */
  saveTimes(studentId: string, times: BriefingTimes, handledUpTo: Date, entry: NewActivityEntry): void;
  /** The one Briefing kept. Saves it, what it replaces going, the moment handled and the Activity entry together. */
  addBriefing(studentId: string, briefing: NewBriefing, handledUpTo: Date, entry: NewActivityEntry): void;
  latest(studentId: string): StoredBriefing | null;
  noteSent(studentId: string, briefingId: number, entry: NewActivityEntry): void;
  noteFailed(studentId: string, briefingId: number, entry: NewActivityEntry): void;
  /** A phone's token. A token this device had before is replaced, and any other device's row with this token goes. */
  savePushToken(studentId: string, deviceKeyHash: string, token: string): void;
  pushTokens(studentId: string): StoredPushToken[];
  markTokenSent(token: string, briefingId: number): void;
  deleteToken(token: string): void;
}

export function createBriefingStore(
  db: DatabaseSync,
  inTransaction: <T>(work: () => T) => T,
  addActivity: (studentId: string, entry: NewActivityEntry) => void,
): BriefingStore {
  const selectSchedule = db.prepare(`SELECT weekdays_time, sunday_time, handled_up_to FROM briefing_schedules WHERE student_id = ?`);
  const insertSchedule = db.prepare(
    `INSERT OR IGNORE INTO briefing_schedules (student_id, weekdays_time, sunday_time, handled_up_to) VALUES (?, ?, ?, ?)`,
  );
  const upsertTimes = db.prepare(
    `INSERT INTO briefing_schedules (student_id, weekdays_time, sunday_time, handled_up_to) VALUES (?, ?, ?, ?)
     ON CONFLICT (student_id) DO UPDATE SET weekdays_time = excluded.weekdays_time, sunday_time = excluded.sunday_time, handled_up_to = excluded.handled_up_to`,
  );
  const updateHandled = db.prepare(`UPDATE briefing_schedules SET handled_up_to = ? WHERE student_id = ?`);
  const insertBriefing = db.prepare(`INSERT INTO briefings (student_id, kind, made_at, contents, title, body) VALUES (?, ?, ?, ?, ?, ?)`);
  const deleteOlder = db.prepare(`DELETE FROM briefings WHERE student_id = ? AND id < ?`);
  const selectLatest = db.prepare(
    `SELECT id, kind, made_at, contents, title, body, told_sent, told_failed FROM briefings WHERE student_id = ? ORDER BY id DESC LIMIT 1`,
  );
  const updateToldSent = db.prepare(`UPDATE briefings SET told_sent = 1 WHERE student_id = ? AND id = ?`);
  const updateToldFailed = db.prepare(`UPDATE briefings SET told_failed = 1 WHERE student_id = ? AND id = ?`);
  const deleteTokenRow = db.prepare(`DELETE FROM push_tokens WHERE token = ?`);
  const deleteTokenOnOtherDevices = db.prepare(`DELETE FROM push_tokens WHERE token = ? AND device_key_hash != ?`);
  const upsertToken = db.prepare(
    `INSERT INTO push_tokens (device_key_hash, student_id, token, last_briefing_id) VALUES (?, ?, ?, ?)
     ON CONFLICT (device_key_hash) DO UPDATE SET token = excluded.token`,
  );
  const selectTokens = db.prepare(`SELECT token, last_briefing_id FROM push_tokens WHERE student_id = ? ORDER BY device_key_hash`);
  const updateTokenSent = db.prepare(`UPDATE push_tokens SET last_briefing_id = ? WHERE token = ?`);

  const latest = (studentId: string): StoredBriefing | null => {
    const row = selectLatest.get(studentId) as any;
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      madeAt: new Date(row.made_at),
      contents: JSON.parse(row.contents),
      title: row.title,
      body: row.body,
      toldSent: row.told_sent !== 0,
      toldFailed: row.told_failed !== 0,
    };
  };

  return {
    times(studentId) {
      const row = selectSchedule.get(studentId) as any;
      return row ? { weekdays: row.weekdays_time, sunday: row.sunday_time } : USUAL_BRIEFING_TIMES;
    },

    handledUpTo(studentId) {
      const row = selectSchedule.get(studentId) as any;
      return row ? new Date(row.handled_up_to) : null;
    },

    startSchedule(studentId, now) {
      insertSchedule.run(studentId, USUAL_BRIEFING_TIMES.weekdays, USUAL_BRIEFING_TIMES.sunday, now.toISOString());
    },

    saveTimes(studentId, times, handledUpTo, entry) {
      inTransaction(() => {
        upsertTimes.run(studentId, times.weekdays, times.sunday, handledUpTo.toISOString());
        addActivity(studentId, entry);
      });
    },

    addBriefing(studentId, briefing, handledUpTo, entry) {
      inTransaction(() => {
        const { lastInsertRowid } = insertBriefing.run(
          studentId,
          briefing.kind,
          briefing.madeAt.toISOString(),
          JSON.stringify(briefing.contents),
          briefing.title,
          briefing.body,
        );
        deleteOlder.run(studentId, lastInsertRowid);
        updateHandled.run(handledUpTo.toISOString(), studentId);
        addActivity(studentId, entry);
      });
    },

    latest,

    noteSent(studentId, briefingId, entry) {
      inTransaction(() => {
        updateToldSent.run(studentId, briefingId);
        addActivity(studentId, entry);
      });
    },

    noteFailed(studentId, briefingId, entry) {
      inTransaction(() => {
        updateToldFailed.run(studentId, briefingId);
        addActivity(studentId, entry);
      });
    },

    savePushToken(studentId, deviceKeyHash, token) {
      inTransaction(() => {
        deleteTokenOnOtherDevices.run(token, deviceKeyHash);
        // A phone registering now has no call on a Briefing that's already gone out. It gets the next one.
        upsertToken.run(deviceKeyHash, studentId, token, latest(studentId)?.id ?? 0);
      });
    },

    pushTokens(studentId) {
      return selectTokens.all(studentId).map((row: any) => ({ token: row.token, lastBriefingId: row.last_briefing_id }));
    },

    markTokenSent(token, briefingId) {
      updateTokenSent.run(briefingId, token);
    },

    deleteToken(token) {
      deleteTokenRow.run(token);
    },
  };
}
