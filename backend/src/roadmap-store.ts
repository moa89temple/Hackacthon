import type { DatabaseSync } from "node:sqlite";
import type { GuidebookSource } from "./guidebook.ts";
import type { NewActivityEntry } from "./store.ts";

/** Goal and Roadmap storage, in its own file. Store.roadmap is how the rest of the backend reaches it. */

export const ROADMAP_MIGRATION = `CREATE TABLE goals (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     text TEXT NOT NULL,
     created_at TEXT NOT NULL,
     edited_at TEXT
   );
   CREATE INDEX goals_by_student ON goals (student_id, id);
   CREATE TABLE academic_plans (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     url TEXT NOT NULL UNIQUE,
     program TEXT NOT NULL,
     title TEXT NOT NULL,
     plans TEXT NOT NULL,
     last_seen_at TEXT NOT NULL
   );
   CREATE TABLE roadmap_cards (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     content TEXT NOT NULL,
     status TEXT NOT NULL,
     after_message_id INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     decided_at TEXT
   );
   CREATE INDEX roadmap_cards_by_student ON roadmap_cards (student_id, id);
   CREATE TABLE roadmap_milestones (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id TEXT NOT NULL,
     position INTEGER NOT NULL,
     goal_id INTEGER,
     content TEXT NOT NULL,
     done_at TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX roadmap_milestones_by_student ON roadmap_milestones (student_id, position);`;

export interface StoredGoal {
  id: number;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
}

export interface StoredPlanPage {
  id: number;
  url: string;
  program: string;
  title: string;
  /** As bulletin-plan.ts read them. */
  plans: unknown;
  lastSeenAt: Date;
}

export type MilestoneKind = "standard_date" | "plan" | "goal" | "unwritten_rule" | "added" | "audit_requirement";

/** One Milestone on a card or on the Roadmap. A Goal of null means it's a Standard Milestone. */
export interface MilestoneFields {
  kind: MilestoneKind;
  goalId: number | null;
  /** Kept with a card's Milestone, so that a card can still say who it was for after the Goal has gone. */
  goalText: string | null;
  name: string;
  detail: string | null;
  /** Its last day. */
  dueDate: string;
  /** A range's first day, otherwise null. */
  startDate: string | null;
  when: string;
  standardMilestoneId: number | null;
  sources: GuidebookSource[];
  sourceNote: string | null;
  /** The fact of the DARS requirement this came from, once a card from an audit has added it. */
  auditRequirement?: string;
}

export interface StoredRoadmapMilestone extends MilestoneFields {
  id: number;
  doneAt: Date | null;
}

export type CardStatus = "waiting" | "accepted" | "not_now" | "replaced" | "out_of_date";

export interface RoadmapCardContent {
  kind: "first" | "change";
  why: string;
  note: string | null;
  adds: MilestoneFields[];
  removes: { id: number; name: string }[];
  /** On a card from comparing the audit with the Roadmap: what it shows, so that nothing's shown twice. See dars-roadmap.ts. */
  fromAudit?: { changes: string[] };
}

export interface StoredRoadmapCard {
  id: number;
  content: RoadmapCardContent;
  status: CardStatus;
  afterMessageId: number;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface RoadmapStore {
  addGoal(studentId: string, text: string, at: Date): StoredGoal;
  listGoals(studentId: string): StoredGoal[];
  /** Null if this Student has no such Goal. */
  editGoal(studentId: string, id: number, text: string, at: Date): StoredGoal | null;
  /** Takes the Goal's Milestones with it, and any waiting card that adds to it can no longer be accepted. */
  removeGoal(studentId: string, id: number, at: Date): boolean;

  /** The same page is kept once. */
  savePlanPage(page: Omit<StoredPlanPage, "id">): StoredPlanPage;
  planPage(id: number): StoredPlanPage | null;
  listPlanPages(): StoredPlanPage[];

  /** Saves the card and its Activity entry together, and any earlier waiting card stops working. */
  addCard(studentId: string, content: RoadmapCardContent, afterMessageId: number, at: Date, entry: NewActivityEntry): StoredRoadmapCard;
  listCards(studentId: string): StoredRoadmapCard[];
  /**
   * Only a waiting card can be decided, however many times it's tapped. Accepting puts its Milestones on the
   * Roadmap and takes off what it removes, all at once, with its Activity entry.
   */
  decideCard(studentId: string, id: number, status: "accepted" | "not_now", at: Date, entry: NewActivityEntry): StoredRoadmapCard | null;
  /** Stops a waiting card working, because what it says is no longer true. Any other card stays as it is. */
  retireCard(studentId: string, id: number, at: Date): void;

  listMilestones(studentId: string): StoredRoadmapMilestone[];
  addMilestone(studentId: string, fields: MilestoneFields, at: Date): void;
  /** Whether there was such a Milestone. */
  setMilestoneDone(studentId: string, id: number, doneAt: Date | null): boolean;
  removeMilestone(studentId: string, id: number): boolean;
  /** Puts them in this order, as long as it holds each of the Student's Milestones once. */
  reorderMilestones(studentId: string, ids: number[]): boolean;
}

export function createRoadmapStore(
  db: DatabaseSync,
  inTransaction: <T>(work: () => T) => T,
  addActivity: (studentId: string, entry: NewActivityEntry) => void,
): RoadmapStore {
  const toGoal = (row: any): StoredGoal => ({
    id: row.id,
    text: row.text,
    createdAt: new Date(row.created_at),
    editedAt: row.edited_at ? new Date(row.edited_at) : null,
  });
  const toPlanPage = (row: any): StoredPlanPage => ({
    id: row.id,
    url: row.url,
    program: row.program,
    title: row.title,
    plans: JSON.parse(row.plans),
    lastSeenAt: new Date(row.last_seen_at),
  });
  const toCard = (row: any): StoredRoadmapCard => ({
    id: row.id,
    content: JSON.parse(row.content),
    status: row.status,
    afterMessageId: row.after_message_id,
    createdAt: new Date(row.created_at),
    decidedAt: row.decided_at ? new Date(row.decided_at) : null,
  });
  const toMilestone = (row: any): StoredRoadmapMilestone => ({
    ...(JSON.parse(row.content) as MilestoneFields),
    id: row.id,
    goalId: row.goal_id,
    doneAt: row.done_at ? new Date(row.done_at) : null,
  });

  const selectGoals = db.prepare(`SELECT id, text, created_at, edited_at FROM goals WHERE student_id = ? ORDER BY id`);
  const selectCards = db.prepare(`SELECT id, content, status, after_message_id, created_at, decided_at FROM roadmap_cards WHERE student_id = ? ORDER BY id`);
  const selectMilestones = db.prepare(`SELECT id, goal_id, content, done_at FROM roadmap_milestones WHERE student_id = ? ORDER BY position, id`);
  const setCardStatus = db.prepare(`UPDATE roadmap_cards SET status = ?, decided_at = ? WHERE student_id = ? AND id = ?`);
  const setPosition = db.prepare(`UPDATE roadmap_milestones SET position = ? WHERE student_id = ? AND id = ?`);
  const deleteMilestone = db.prepare(`DELETE FROM roadmap_milestones WHERE student_id = ? AND id = ?`);
  const insertMilestone = db.prepare(
    `INSERT INTO roadmap_milestones (student_id, position, goal_id, content, created_at) VALUES (?, ?, ?, ?, ?)`,
  );

  const listGoals = (studentId: string) => selectGoals.all(studentId).map(toGoal);
  const listCards = (studentId: string) => selectCards.all(studentId).map(toCard);
  const listMilestones = (studentId: string) => selectMilestones.all(studentId).map(toMilestone);
  const findCard = (studentId: string, id: number) => listCards(studentId).find((card) => card.id === id) ?? null;

  function putInOrder(studentId: string, ids: number[]): void {
    ids.forEach((id, index) => setPosition.run(index, studentId, id));
  }

  /** Before the first Milestone due later, so that a new one lands by its date and the Student's order stays. */
  function insertByDate(studentId: string, fields: MilestoneFields, at: Date): void {
    const existing = listMilestones(studentId);
    const later = existing.findIndex((milestone) => milestone.dueDate > fields.dueDate);
    const place = later === -1 ? existing.length : later;
    const { lastInsertRowid } = insertMilestone.run(studentId, place, fields.goalId, JSON.stringify(fields), at.toISOString());
    const ids = existing.map((milestone) => milestone.id);
    ids.splice(place, 0, Number(lastInsertRowid));
    putInOrder(studentId, ids);
  }

  return {
    addGoal(studentId, text, at) {
      const { lastInsertRowid } = db
        .prepare(`INSERT INTO goals (student_id, text, created_at) VALUES (?, ?, ?)`)
        .run(studentId, text, at.toISOString());
      return listGoals(studentId).find((goal) => goal.id === Number(lastInsertRowid))!;
    },

    listGoals,

    editGoal(studentId, id, text, at) {
      const { changes } = db.prepare(`UPDATE goals SET text = ?, edited_at = ? WHERE student_id = ? AND id = ?`).run(text, at.toISOString(), studentId, id);
      return changes === 0 ? null : (listGoals(studentId).find((goal) => goal.id === id) ?? null);
    },

    removeGoal(studentId, id, at) {
      return inTransaction(() => {
        const { changes } = db.prepare(`DELETE FROM goals WHERE student_id = ? AND id = ?`).run(studentId, id);
        if (changes === 0) return false;
        db.prepare(`DELETE FROM roadmap_milestones WHERE student_id = ? AND goal_id = ?`).run(studentId, id);
        for (const card of listCards(studentId)) {
          if (card.status === "waiting" && card.content.adds.some((milestone) => milestone.goalId === id)) {
            setCardStatus.run("out_of_date", at.toISOString(), studentId, card.id);
          }
        }
        return true;
      });
    },

    savePlanPage(page) {
      const row = db
        .prepare(
          `INSERT INTO academic_plans (url, program, title, plans, last_seen_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (url) DO UPDATE SET program = excluded.program, title = excluded.title, plans = excluded.plans, last_seen_at = excluded.last_seen_at
           RETURNING *`,
        )
        .get(page.url, page.program, page.title, JSON.stringify(page.plans), page.lastSeenAt.toISOString());
      return toPlanPage(row);
    },

    planPage(id) {
      const row = db.prepare(`SELECT * FROM academic_plans WHERE id = ?`).get(id);
      return row ? toPlanPage(row) : null;
    },

    listPlanPages() {
      return db.prepare(`SELECT * FROM academic_plans ORDER BY id`).all().map(toPlanPage);
    },

    addCard(studentId, content, afterMessageId, at, entry) {
      return inTransaction(() => {
        for (const card of listCards(studentId)) {
          if (card.status === "waiting") setCardStatus.run("replaced", at.toISOString(), studentId, card.id);
        }
        const { lastInsertRowid } = db
          .prepare(`INSERT INTO roadmap_cards (student_id, content, status, after_message_id, created_at) VALUES (?, ?, 'waiting', ?, ?)`)
          .run(studentId, JSON.stringify(content), afterMessageId, at.toISOString());
        addActivity(studentId, entry);
        return findCard(studentId, Number(lastInsertRowid))!;
      });
    },

    listCards,

    decideCard(studentId, id, status, at, entry) {
      return inTransaction(() => {
        const card = findCard(studentId, id);
        if (!card || card.status !== "waiting") return card;
        setCardStatus.run(status, at.toISOString(), studentId, id);
        if (status === "accepted") {
          for (const { id: removed } of card.content.removes) deleteMilestone.run(studentId, removed);
          for (const milestone of card.content.adds) insertByDate(studentId, milestone, at);
        }
        addActivity(studentId, entry);
        return findCard(studentId, id);
      });
    },

    retireCard(studentId, id, at) {
      if (findCard(studentId, id)?.status === "waiting") setCardStatus.run("out_of_date", at.toISOString(), studentId, id);
    },

    listMilestones,

    addMilestone(studentId, fields, at) {
      inTransaction(() => insertByDate(studentId, fields, at));
    },

    setMilestoneDone(studentId, id, doneAt) {
      const { changes } = db
        .prepare(`UPDATE roadmap_milestones SET done_at = ? WHERE student_id = ? AND id = ?`)
        .run(doneAt?.toISOString() ?? null, studentId, id);
      return changes > 0;
    },

    removeMilestone(studentId, id) {
      return deleteMilestone.run(studentId, id).changes > 0;
    },

    reorderMilestones(studentId, ids) {
      return inTransaction(() => {
        const existing = listMilestones(studentId).map((milestone) => milestone.id);
        const sameOnes = ids.length === existing.length && new Set(ids).size === ids.length && ids.every((id) => existing.includes(id));
        if (sameOnes) putInOrder(studentId, ids);
        return sameOnes;
      });
    },
  };
}
