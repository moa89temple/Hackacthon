import type { DatabaseSync } from "node:sqlite";
import type { DecisionFact, DecisionSource, NewActivityEntry } from "./store.ts";

/** Tasks, in their own file. Store.tasks is how the rest of the backend reaches them. */

// `work` holds the Task's own exchange with Claude while it isn't over, so that a Task can wait a day for a tap. It goes
// when the Task ends, because it holds whatever pages and records the Task read. Which Task a Claude call was for goes on
// claude_calls, so that what a Task has cost is always just the sum of what it was charged.
export const TASK_MIGRATION = `CREATE TABLE tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     title TEXT NOT NULL,
     request TEXT NOT NULL,
     state TEXT NOT NULL,
     after_message_id INTEGER NOT NULL,
     steps TEXT NOT NULL,
     waits TEXT NOT NULL,
     result TEXT,
     sources TEXT NOT NULL,
     problem TEXT,
     allowance_nanodollars INTEGER NOT NULL,
     work TEXT,
     notice TEXT,
     notice_failure_told INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     finished_at TEXT
   );
   CREATE INDEX tasks_by_student ON tasks (student_id, id);
   ALTER TABLE claude_calls ADD COLUMN task_id INTEGER;
   CREATE INDEX claude_calls_by_task ON claude_calls (task_id);`;

export type TaskState = "queued" | "working" | "needs_student" | "done" | "failed" | "cancelled";

/** What a Task is waiting for the Student to do. It goes on when all of them are settled. */
export type TaskWait =
  | { kind: "action_card"; cardId: number; title: string }
  | { kind: "login"; connection: string; name: string }
  | { kind: "spending" };

/** Which phone notification a Task still owes. */
export type TaskNotice = "done" | "needs_student" | "failed";

export interface TaskWork {
  /** The exchange with Claude so far, as the API takes it. What was read from email or a service isn't kept here. */
  messages: unknown[];
  /** The only pages this Task may read, because a search gave them. */
  addressesFound: string[];
  /** Each of those pages' titles, as the search gave them. */
  pageTitles: Record<string, string>;
  /** Links on the pages of Connections it has read, which are the only other pages of theirs it may open. */
  connectionLinks: string[];
  /** Past this point the Task has seen the Student's records, so what it asks a search engine could carry them. */
  sawPrivateRecords: boolean;
  /** What other people wrote that the Task has read, which stops anything that could outlast the Task. */
  read: "mail" | "service" | null;
  record: { tools: string[]; sources: DecisionSource[]; facts: [number, DecisionFact][] };
}

export interface StoredTask {
  id: number;
  title: string;
  request: string;
  state: TaskState;
  afterMessageId: number;
  /** What Buddy has done so far, in words from Buddy's code around what it searched for and any card's title. */
  steps: string[];
  waits: TaskWait[];
  result: string | null;
  sources: DecisionSource[];
  /** Why it failed, in words from Buddy's code. */
  problem: string | null;
  /** What it may cost before it has to ask again. */
  allowance: number;
  work: TaskWork | null;
  notice: TaskNotice | null;
  noticeFailureTold: boolean;
  createdAt: Date;
  finishedAt: Date | null;
}

export type TaskChange = Partial<
  Pick<StoredTask, "state" | "afterMessageId" | "steps" | "waits" | "result" | "sources" | "problem" | "allowance" | "work" | "notice" | "noticeFailureTold" | "finishedAt">
>;

export interface TaskStore {
  add(studentId: string, task: { title: string; request: string; afterMessageId: number; allowance: number; createdAt: Date }, entry: NewActivityEntry): StoredTask;
  get(studentId: string, id: number): StoredTask | null;
  /** Oldest first. */
  list(studentId: string): StoredTask[];
  /**
   * Makes the change and saves the entries together, only if the Task is still in one of these states. Null otherwise.
   * That's what stops a Task the Student has just cancelled from being marked done by the work still finishing.
   */
  change(studentId: string, id: number, from: TaskState[], change: TaskChange, entries?: NewActivityEntry[]): StoredTask | null;
}

function toTask(row: any): StoredTask {
  return {
    id: row.id,
    title: row.title,
    request: row.request,
    state: row.state,
    afterMessageId: row.after_message_id,
    steps: JSON.parse(row.steps),
    waits: JSON.parse(row.waits),
    result: row.result,
    sources: JSON.parse(row.sources),
    problem: row.problem,
    allowance: row.allowance_nanodollars,
    work: row.work ? JSON.parse(row.work) : null,
    notice: row.notice,
    noticeFailureTold: row.notice_failure_told === 1,
    createdAt: new Date(row.created_at),
    finishedAt: row.finished_at ? new Date(row.finished_at) : null,
  };
}

export function createTaskStore(
  db: DatabaseSync,
  inTransaction: <T>(work: () => T) => T,
  addActivity: (studentId: string, entry: NewActivityEntry) => void,
): TaskStore {
  const insert = db.prepare(
    `INSERT INTO tasks (student_id, title, request, state, after_message_id, steps, waits, sources, allowance_nanodollars, created_at)
     VALUES (?, ?, ?, 'queued', ?, '[]', '[]', '[]', ?, ?)`,
  );
  const selectOne = db.prepare(`SELECT * FROM tasks WHERE student_id = ? AND id = ?`);
  const selectAll = db.prepare(`SELECT * FROM tasks WHERE student_id = ? ORDER BY id`);
  const update = db.prepare(
    `UPDATE tasks SET state = ?, after_message_id = ?, steps = ?, waits = ?, result = ?, sources = ?, problem = ?, allowance_nanodollars = ?, work = ?, notice = ?, notice_failure_told = ?, finished_at = ?
     WHERE student_id = ? AND id = ?`,
  );

  const get = (studentId: string, id: number) => {
    const row = selectOne.get(studentId, id);
    return row ? toTask(row) : null;
  };

  return {
    add(studentId, task, entry) {
      return inTransaction(() => {
        const { lastInsertRowid } = insert.run(studentId, task.title, task.request, task.afterMessageId, task.allowance, task.createdAt.toISOString());
        addActivity(studentId, entry);
        return get(studentId, Number(lastInsertRowid))!;
      });
    },

    get,
    list: (studentId) => selectAll.all(studentId).map(toTask),

    change(studentId, id, from, change, entries = []) {
      return inTransaction(() => {
        const task = get(studentId, id);
        if (!task || !from.includes(task.state)) return null;
        const next = { ...task, ...change };
        update.run(
          next.state,
          next.afterMessageId,
          JSON.stringify(next.steps),
          JSON.stringify(next.waits),
          next.result,
          JSON.stringify(next.sources),
          next.problem,
          next.allowance,
          next.work ? JSON.stringify(next.work) : null,
          next.notice,
          next.noticeFailureTold ? 1 : 0,
          next.finishedAt?.toISOString() ?? null,
          studentId,
          id,
        );
        for (const entry of entries) addActivity(studentId, entry);
        return next;
      });
    },
  };
}
