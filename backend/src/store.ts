import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

export interface Store {
  /** Appends the messages together: either all of them are saved or none are. Messages never change once saved. */
  appendMessages(studentId: string, messages: NewMessage[]): StoredMessage[];
  listMessages(studentId: string): StoredMessage[];
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
