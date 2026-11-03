import type { DatabaseSync } from "node:sqlite";

/** What Claude calls cost, in its own file. Store.spending is how the rest of the backend reaches it. */

// One row per Claude call, with no words from the call. Whatever a later "Delete everything" does, emptying
// this would lift the day's limit and lose the month's total, and nothing in it is about the Student.
export const SPENDING_MIGRATION = `CREATE TABLE claude_calls (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     day TEXT NOT NULL,
     work TEXT NOT NULL,
     model TEXT NOT NULL,
     input_tokens INTEGER NOT NULL,
     output_tokens INTEGER NOT NULL,
     cache_read_tokens INTEGER NOT NULL,
     cache_write_tokens INTEGER NOT NULL,
     web_searches INTEGER NOT NULL,
     cost_nanodollars INTEGER NOT NULL
   );
   CREATE INDEX claude_calls_by_day ON claude_calls (day);`;

export type ClaudeWork = "chat" | "background" | "task";

export interface ClaudeCallToStore {
  at: Date;
  /** Philadelphia's date as YYYY-MM-DD, kept as it was when the call finished. */
  day: string;
  work: ClaudeWork;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  costNanodollars: number;
  /** The Task this was for, when it was for one. */
  taskId?: number;
}

export interface SpentByWork {
  chat: number;
  background: number;
  task: number;
}

/** In nanodollars. */
export interface SpentOnTask {
  total: number;
  /** The most that one of its calls cost. */
  dearestCall: number;
}

export interface SpendingStore {
  record(call: ClaudeCallToStore): void;
  /** In nanodollars, for this YYYY-MM-DD. */
  spentOn(day: string): SpentByWork;
  /** In nanodollars, for this YYYY-MM. */
  spentInMonth(month: string): SpentByWork;
  spentOnTask(taskId: number): SpentOnTask;
}

function byWork(rows: unknown[]): SpentByWork {
  const spent: SpentByWork = { chat: 0, background: 0, task: 0 };
  for (const row of rows as { work: ClaudeWork; cost: number }[]) spent[row.work] = row.cost;
  return spent;
}

export function createSpendingStore(db: DatabaseSync): SpendingStore {
  const insert = db.prepare(
    `INSERT INTO claude_calls (at, day, work, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost_nanodollars, task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectDay = db.prepare(`SELECT work, SUM(cost_nanodollars) AS cost FROM claude_calls WHERE day = ? GROUP BY work`);
  const selectMonth = db.prepare(`SELECT work, SUM(cost_nanodollars) AS cost FROM claude_calls WHERE day LIKE ? GROUP BY work`);
  const selectTask = db.prepare(`SELECT COALESCE(SUM(cost_nanodollars), 0) AS total, COALESCE(MAX(cost_nanodollars), 0) AS dearest FROM claude_calls WHERE task_id = ?`);

  return {
    record(call) {
      insert.run(
        call.at.toISOString(),
        call.day,
        call.work,
        call.model,
        call.inputTokens,
        call.outputTokens,
        call.cacheReadTokens,
        call.cacheWriteTokens,
        call.webSearches,
        call.costNanodollars,
        call.taskId ?? null,
      );
    },

    spentOn: (day) => byWork(selectDay.all(day)),
    spentInMonth: (month) => byWork(selectMonth.all(`${month}-%`)),

    spentOnTask(taskId) {
      const { total, dearest } = selectTask.get(taskId) as { total: number; dearest: number };
      return { total, dearestCall: dearest };
    },
  };
}
