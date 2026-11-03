import type { DatabaseSync } from "node:sqlite";
import type { NewActivityEntry } from "./store.ts";

/** Practice mode's storage, in its own file. Store.sending is how the rest of the backend reaches it. */

export const SENDING_MIGRATION = `CREATE TABLE sending_settings (
     student_id TEXT PRIMARY KEY,
     mode TEXT NOT NULL,
     own_address TEXT
   );`;

export type SendingMode = "practice" | "live";

export interface SendingSettings {
  mode: SendingMode;
  /** The Student's own TUmail address. Null until they've said what it is. */
  ownAddress: string | null;
}

export interface SendingStore {
  /** Practice mode with no address, until the Student has changed something. */
  settings(studentId: string): SendingSettings;
  /** Saves the settings and the Activity entry together. */
  save(studentId: string, settings: SendingSettings, entry: NewActivityEntry): void;
}

export function createSendingStore(
  db: DatabaseSync,
  inTransaction: <T>(work: () => T) => T,
  addActivity: (studentId: string, entry: NewActivityEntry) => void,
): SendingStore {
  const select = db.prepare(`SELECT mode, own_address FROM sending_settings WHERE student_id = ?`);
  const upsert = db.prepare(
    `INSERT INTO sending_settings (student_id, mode, own_address) VALUES (?, ?, ?)
     ON CONFLICT (student_id) DO UPDATE SET mode = excluded.mode, own_address = excluded.own_address`,
  );

  return {
    settings(studentId) {
      const row = select.get(studentId) as { mode: string; own_address: string | null } | undefined;
      // Anything but a clear "live" is Practice mode, so that nothing odd in the file can reach a Contact.
      return { mode: row?.mode === "live" ? "live" : "practice", ownAddress: row?.own_address ?? null };
    },

    save(studentId, settings, entry) {
      inTransaction(() => {
        upsert.run(studentId, settings.mode, settings.ownAddress);
        addActivity(studentId, entry);
      });
    },
  };
}
