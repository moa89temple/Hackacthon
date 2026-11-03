import type { DatabaseSync } from "node:sqlite";
import type { NewActivityEntry } from "./store.ts";

/** Opportunity storage, in its own file. Store.opportunities is how the rest of the backend reaches it. */

// Not keyed by Student, like the rest of the Guidebook: an Opportunity and a Report on it are for every
// Student. What's saved, what's on a card and which Goals matched are the Student's own.
export const OPPORTUNITY_MIGRATION = `CREATE TABLE opportunities (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     item_key TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     reported_at TEXT
   );
   CREATE TABLE opportunity_pages (
     url TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     text_hash TEXT NOT NULL
   );
   CREATE TABLE opportunity_mentions (
     opportunity_id INTEGER NOT NULL REFERENCES opportunities (id),
     url TEXT NOT NULL REFERENCES opportunity_pages (url),
     fields TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     PRIMARY KEY (opportunity_id, url)
   );
   CREATE TABLE opportunity_goals (
     student_id TEXT NOT NULL,
     opportunity_id INTEGER NOT NULL REFERENCES opportunities (id),
     goal_key TEXT NOT NULL,
     goal_text TEXT NOT NULL,
     PRIMARY KEY (student_id, opportunity_id, goal_key)
   );
   CREATE TABLE saved_opportunities (
     student_id TEXT NOT NULL,
     opportunity_id INTEGER NOT NULL REFERENCES opportunities (id),
     saved_at TEXT NOT NULL,
     PRIMARY KEY (student_id, opportunity_id)
   );
   CREATE TABLE opportunity_cards (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     opportunity_id INTEGER NOT NULL,
     after_message_id INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX opportunity_cards_by_student ON opportunity_cards (student_id, id);
   CREATE TABLE opportunity_runs (
     what TEXT PRIMARY KEY,
     done_at TEXT,
     failed_at TEXT
   );`;

/** What one page says about an Opportunity, as Discovery checked it. Read by opportunities.ts. */
export interface OpportunityToStore {
  key: string;
  name: string;
  fields: unknown;
}

export interface StoredOpportunity {
  id: number;
  mentions: { url: string; pageTitle: string; fields: unknown; lastSeenAt: Date }[];
  goals: { key: string; text: string }[];
}

export interface GoalMatch {
  studentId: string;
  key: string;
  text: string;
}

export interface StoredOpportunityCard {
  opportunityId: number;
  afterMessageId: number;
  createdAt: Date;
}

export interface OpportunityStore {
  pageHash(url: string): string | null;
  /** What this reading of the page says replaces what the last one said. */
  savePage(page: { url: string; title: string; textHash: string }, items: OpportunityToStore[], readAt: Date, goal: GoalMatch | null): void;
  /** The page's words haven't changed, so what it says is still there. */
  confirmPage(url: string, title: string, readAt: Date, goal: GoalMatch | null): void;
  /** Pages with something on them that hasn't been seen there since then. */
  pagesLastSeenBefore(before: Date): string[];
  /** Takes out what hasn't been seen on its page since then. What's left with no page leaves, unless it was reported. */
  removeMissing(before: Date): void;
  /** Everything that's still on a page, apart from what was reported. */
  list(studentId: string): StoredOpportunity[];
  isKnown(id: number): boolean;
  report(studentId: string, id: number, at: Date, entry: NewActivityEntry): void;
  reportedIds(): number[];
  savedIds(studentId: string): number[];
  save(studentId: string, id: number, at: Date): void;
  unsave(studentId: string, id: number): void;
  addCard(studentId: string, card: StoredOpportunityCard): void;
  listCards(studentId: string): StoredOpportunityCard[];
  /** When this was last done and when it last failed. See opportunity-discovery.ts. */
  run(what: string): { doneAt: Date | null; failedAt: Date | null };
  recordRunDone(studentId: string, what: string, at: Date, entry: NewActivityEntry): void;
  recordRunFailed(studentId: string, what: string, at: Date, entry: NewActivityEntry | null): void;
}

const dateOrNull = (value: string | null | undefined) => (value ? new Date(value) : null);

export function createOpportunityStore(
  db: DatabaseSync,
  inTransaction: <T>(work: () => T) => T,
  addActivity: (studentId: string, entry: NewActivityEntry) => void,
): OpportunityStore {
  const selectPage = db.prepare(`SELECT text_hash FROM opportunity_pages WHERE url = ?`);
  const upsertPage = db.prepare(
    `INSERT INTO opportunity_pages (url, title, text_hash) VALUES (?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET title = excluded.title, text_hash = excluded.text_hash`,
  );
  const updateTitle = db.prepare(`UPDATE opportunity_pages SET title = ? WHERE url = ?`);
  const upsertOpportunity = db.prepare(
    `INSERT INTO opportunities (item_key, name) VALUES (?, ?) ON CONFLICT (item_key) DO UPDATE SET name = excluded.name`,
  );
  const selectId = db.prepare(`SELECT id FROM opportunities WHERE item_key = ?`);
  const deletePageMentions = db.prepare(`DELETE FROM opportunity_mentions WHERE url = ?`);
  const insertMention = db.prepare(`INSERT INTO opportunity_mentions (opportunity_id, url, fields, last_seen_at) VALUES (?, ?, ?, ?)`);
  const confirmMentions = db.prepare(`UPDATE opportunity_mentions SET last_seen_at = ? WHERE url = ?`);
  const insertGoalsOfPage = db.prepare(
    `INSERT OR IGNORE INTO opportunity_goals (student_id, opportunity_id, goal_key, goal_text)
     SELECT ?, opportunity_id, ?, ? FROM opportunity_mentions WHERE url = ?`,
  );
  const selectPagesLastSeenBefore = db.prepare(`SELECT DISTINCT url FROM opportunity_mentions WHERE last_seen_at <= ?`);
  const deleteMissingMentions = db.prepare(`DELETE FROM opportunity_mentions WHERE last_seen_at <= ?`);
  const deletePagesLeftEmpty = db.prepare(`DELETE FROM opportunity_pages WHERE url NOT IN (SELECT url FROM opportunity_mentions)`);
  // The two below only ever follow a page's mentions going, because a page can stop listing something at any reading.
  const notOnAnyPage = `opportunity_id NOT IN (SELECT opportunity_id FROM opportunity_mentions)`;
  const deleteOrphanSaves = db.prepare(`DELETE FROM saved_opportunities WHERE ${notOnAnyPage}`);
  const deleteOrphanGoals = db.prepare(`DELETE FROM opportunity_goals WHERE ${notOnAnyPage}`);
  const deleteOrphans = db.prepare(
    `DELETE FROM opportunities WHERE reported_at IS NULL AND id NOT IN (SELECT opportunity_id FROM opportunity_mentions)`,
  );
  const selectMentions = db.prepare(
    `SELECT opportunity.id, mention.url, page.title, mention.fields, mention.last_seen_at
     FROM opportunities opportunity
     JOIN opportunity_mentions mention ON mention.opportunity_id = opportunity.id
     JOIN opportunity_pages page ON page.url = mention.url
     WHERE opportunity.reported_at IS NULL
     ORDER BY opportunity.id, mention.url`,
  );
  const selectGoals = db.prepare(`SELECT opportunity_id, goal_key, goal_text FROM opportunity_goals WHERE student_id = ?`);
  const selectKnown = db.prepare(`SELECT 1 FROM opportunities WHERE id = ?`);
  const reportOne = db.prepare(`UPDATE opportunities SET reported_at = ? WHERE id = ? AND reported_at IS NULL`);
  const selectReported = db.prepare(`SELECT id FROM opportunities WHERE reported_at IS NOT NULL ORDER BY id`);
  const selectSaved = db.prepare(`SELECT opportunity_id FROM saved_opportunities WHERE student_id = ? ORDER BY saved_at`);
  const insertSaved = db.prepare(`INSERT OR IGNORE INTO saved_opportunities (student_id, opportunity_id, saved_at) VALUES (?, ?, ?)`);
  const deleteSaved = db.prepare(`DELETE FROM saved_opportunities WHERE student_id = ? AND opportunity_id = ?`);
  const insertCard = db.prepare(`INSERT INTO opportunity_cards (student_id, opportunity_id, after_message_id, created_at) VALUES (?, ?, ?, ?)`);
  const selectCards = db.prepare(`SELECT opportunity_id, after_message_id, created_at FROM opportunity_cards WHERE student_id = ? ORDER BY id`);
  const selectRun = db.prepare(`SELECT done_at, failed_at FROM opportunity_runs WHERE what = ?`);
  const upsertRunDone = db.prepare(
    `INSERT INTO opportunity_runs (what, done_at) VALUES (?1, ?2) ON CONFLICT (what) DO UPDATE SET done_at = ?2, failed_at = NULL`,
  );
  const upsertRunFailed = db.prepare(
    `INSERT INTO opportunity_runs (what, failed_at) VALUES (?1, ?2) ON CONFLICT (what) DO UPDATE SET failed_at = ?2`,
  );

  function clearOrphans(): void {
    deleteOrphanSaves.run();
    deleteOrphanGoals.run();
    deleteOrphans.run();
  }

  function linkGoal(url: string, goal: GoalMatch | null): void {
    if (goal) insertGoalsOfPage.run(goal.studentId, goal.key, goal.text, url);
  }

  return {
    pageHash: (url) => (selectPage.get(url) as any)?.text_hash ?? null,

    savePage(page, items, readAt, goal) {
      inTransaction(() => {
        upsertPage.run(page.url, page.title, page.textHash);
        deletePageMentions.run(page.url);
        for (const item of items) {
          upsertOpportunity.run(item.key, item.name);
          const { id } = selectId.get(item.key) as any;
          insertMention.run(id, page.url, JSON.stringify(item.fields), readAt.toISOString());
        }
        linkGoal(page.url, goal);
        clearOrphans();
      });
    },

    confirmPage(url, title, readAt, goal) {
      inTransaction(() => {
        updateTitle.run(title, url);
        confirmMentions.run(readAt.toISOString(), url);
        linkGoal(url, goal);
      });
    },

    pagesLastSeenBefore: (before) => (selectPagesLastSeenBefore.all(before.toISOString()) as any[]).map((row) => row.url),

    removeMissing(before) {
      inTransaction(() => {
        deleteMissingMentions.run(before.toISOString());
        deletePagesLeftEmpty.run();
        clearOrphans();
      });
    },

    list(studentId) {
      const goals = selectGoals.all(studentId) as any[];
      const items = new Map<number, StoredOpportunity>();
      for (const row of selectMentions.all() as any[]) {
        const item: StoredOpportunity = items.get(row.id) ?? {
          id: row.id,
          mentions: [],
          goals: goals.filter((goal) => goal.opportunity_id === row.id).map((goal) => ({ key: goal.goal_key, text: goal.goal_text })),
        };
        item.mentions.push({ url: row.url, pageTitle: row.title, fields: JSON.parse(row.fields), lastSeenAt: new Date(row.last_seen_at) });
        items.set(row.id, item);
      }
      return [...items.values()];
    },

    isKnown: (id) => selectKnown.get(id) !== undefined,

    report(studentId, id, at, entry) {
      inTransaction(() => {
        const { changes } = reportOne.run(at.toISOString(), id);
        if (changes > 0) addActivity(studentId, entry);
      });
    },

    reportedIds: () => (selectReported.all() as any[]).map((row) => row.id),
    savedIds: (studentId) => (selectSaved.all(studentId) as any[]).map((row) => row.opportunity_id),

    save(studentId, id, at) {
      insertSaved.run(studentId, id, at.toISOString());
    },

    unsave(studentId, id) {
      deleteSaved.run(studentId, id);
    },

    addCard(studentId, card) {
      insertCard.run(studentId, card.opportunityId, card.afterMessageId, card.createdAt.toISOString());
    },

    listCards: (studentId) =>
      (selectCards.all(studentId) as any[]).map((row) => ({
        opportunityId: row.opportunity_id,
        afterMessageId: row.after_message_id,
        createdAt: new Date(row.created_at),
      })),

    run(what) {
      const row = selectRun.get(what) as any;
      return { doneAt: dateOrNull(row?.done_at), failedAt: dateOrNull(row?.failed_at) };
    },

    recordRunDone(studentId, what, at, entry) {
      inTransaction(() => {
        upsertRunDone.run(what, at.toISOString());
        addActivity(studentId, entry);
      });
    },

    recordRunFailed(studentId, what, at, entry) {
      inTransaction(() => {
        upsertRunFailed.run(what, at.toISOString());
        if (entry) addActivity(studentId, entry);
      });
    },
  };
}
