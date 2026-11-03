import { todayInPhiladelphia, type Clock } from "./clock.ts";
import { isShownToStudent } from "./conversation.ts";
import { AUDIT_OLD_AFTER_DAYS, auditSeenIn, darsDataOf, daysOld } from "./dars.ts";
import { DARS_ID, DARS_SOURCE, type StatedStatus } from "./dars-rules.ts";
import { comparable } from "./extraction.ts";
import { planCalendar, type TermTarget } from "./plan-calendar.ts";
import type { FactFromConnection, Profile } from "./profile.ts";
import type { AuditChange, MilestoneFields, StoredRoadmapCard, StoredRoadmapMilestone } from "./roadmap-store.ts";
import { THE_STUDENT, type Store } from "./store.ts";

/**
 * Compares the Student's audit with their Roadmap, and shows a card when they differ. There's no model in
 * this, and nothing changes until the Student taps Accept on the card. It runs after each read that worked,
 * and after a revoke.
 *
 * - A missing requirement that nothing on the Roadmap covers: a card adds a Milestone for it.
 * - A complete requirement with a Milestone still open for it: a card takes that off.
 * - In progress and planned are neither, so they make no card. A Suggested Academic Plan's terms and the
 *   Standard Milestones are never taken off, because each stands for more than one requirement.
 *
 * Each change is shown once. A change the last card about that requirement already showed isn't shown again,
 * whatever the Student did with it, so Not now stays not now until the audit says something else.
 */

/** A first-year's audit has dozens missing, and a card of dozens isn't one anyone can tap Accept on. */
const MOST_CHANGES_ON_A_CARD = 5;
/** Only the Student's own, Buddy's for a Goal, and those a card from an audit added. A plan's term or a Standard Milestone stands for more. */
const MILESTONES_FOR_ONE_REQUIREMENT: StoredRoadmapMilestone["kind"][] = ["added", "goal", "audit_requirement"];

interface Requirement {
  key: string;
  title: string;
  status: StatedStatus;
  courses: string[];
  detail: string | null;
}

type Change = { kind: "add"; requirement: Requirement } | { kind: "remove"; requirement: Requirement; milestone: StoredRoadmapMilestone };

function requirementsIn(facts: FactFromConnection[]): Requirement[] {
  return facts.flatMap((fact) => {
    const data = darsDataOf(fact);
    return data?.kind === "requirement" ? [{ key: fact.key, title: data.title, status: data.status, courses: data.courses, detail: fact.detail }] : [];
  });
}

/**
 * Whether a Milestone's name says this requirement, in all the words of its title. A title reads as
 * "CODE --- WORDS" in Temple's guides, and a Student wouldn't write the code. One word alone proves nothing:
 * a requirement called MAJOR isn't what "Declare a major" is about.
 */
function namesTheRequirement(name: string, title: string): boolean {
  const plain = (words: string) => comparable(words).replace(/[^\p{L}\p{N}.]+/gu, " ").trim();
  const words = plain(title.split("---").at(-1) ?? title);
  return words.includes(" ") && ` ${plain(name)} `.includes(` ${words} `);
}

const isForThisRequirement = (milestone: StoredRoadmapMilestone, { key, title }: Requirement) =>
  milestone.auditRequirement === key || (MILESTONES_FOR_ONE_REQUIREMENT.includes(milestone.kind) && namesTheRequirement(milestone.name, title));

const namesACourseOf = (milestone: StoredRoadmapMilestone, { courses }: Requirement) => {
  const words = comparable(`${milestone.name} ${milestone.detail ?? ""}`);
  return milestone.doneAt === null && courses.some((course) => words.includes(comparable(course)));
};

function changesBetween(requirements: Requirement[], milestones: StoredRoadmapMilestone[]): Change[] {
  const removals = requirements
    .filter(({ status }) => status === "complete")
    .flatMap((requirement) =>
      milestones.filter((milestone) => milestone.doneAt === null && isForThisRequirement(milestone, requirement)).map((milestone): Change => ({ kind: "remove", requirement, milestone })),
    );
  const adds = requirements
    .filter(({ status }) => status === "missing")
    .filter((requirement) => !milestones.some((milestone) => isForThisRequirement(milestone, requirement) || namesACourseOf(milestone, requirement)))
    .map((requirement): Change => ({ kind: "add", requirement }));
  return [...removals, ...adds];
}

/** What the latest card the Student decided on said about each requirement, by its fact. */
function lastDecidedChanges(cards: StoredRoadmapCard[]): Map<string, AuditChange["kind"]> {
  const lastAbout = new Map<string, AuditChange["kind"]>();
  for (const card of cards) {
    if (card.status !== "accepted" && card.status !== "not_now") continue;
    for (const { kind, requirement } of card.content.fromAudit?.changes ?? []) lastAbout.set(requirement, kind);
  }
  return lastAbout;
}

/** The term after this one, because this one's classes are already chosen. Over the summer, that's the coming fall. */
function targetTerm(today: string): TermTarget {
  const calendar = planCalendar(1, today);
  const terms = [calendar.endOfPlanTerm(1, "Fall"), calendar.endOfPlanTerm(1, "Spring"), calendar.endOfPlanTerm(2, "Fall")].filter((term) => term !== null);
  const month = Number(today.slice(5, 7));
  return (month === 6 || month === 7 ? terms[0] : terms[1])!;
}

export interface DarsCards {
  /** Shows a card for any new difference, and stops a waiting card that no longer fits. Throws only for what storage does. */
  compareWithRoadmap(): void;
}

export function createDarsCards({ store, clock, profile }: { store: Store; clock: Clock; profile: Profile }): DarsCards {
  const data = store.roadmap;

  function milestoneFor({ key, title, detail }: Requirement, target: TermTarget, now: Date): MilestoneFields {
    return {
      kind: "audit_requirement",
      goalId: null,
      goalText: null,
      name: `Meet this DARS requirement: ${title}`,
      detail,
      startDate: null,
      ...target,
      standardMilestoneId: null,
      sources: [{ ...DARS_SOURCE, lastSeenAt: now.toISOString() }],
      sourceNote: null,
      auditRequirement: key,
    };
  }

  function latestShownMessage(): number | null {
    return store.listMessages(THE_STUDENT).filter(isShownToStudent).at(-1)?.id ?? null;
  }

  return {
    compareWithRoadmap() {
      const now = clock.now();
      const facts = profile.factsFromConnection(DARS_ID);
      const audit = auditSeenIn(facts);
      const cards = data.listCards(THE_STUDENT);
      const waiting = cards.findLast((card) => card.status === "waiting");
      const waitingFromAudit = waiting?.content.fromAudit ? waiting : null;

      const stopWaitingCard = () => {
        if (waitingFromAudit) data.retireCard(THE_STUDENT, waitingFromAudit.id, now);
      };
      // No audit to go by, because the Read Permission has gone or DARS has none, or one too old to go by.
      if (!audit || daysOld(audit.day, now) > AUDIT_OLD_AFTER_DAYS) return stopWaitingCard();

      const milestones = data.listMilestones(THE_STUDENT);
      const afterMessageId = latestShownMessage();
      // The Roadmap is what's being compared with, and a card shows in the conversation.
      if (milestones.length === 0 || afterMessageId === null) return;
      // The Student is deciding about something else, and a new card would take that one away. The next read tries again.
      if (waiting && !waitingFromAudit) return;

      const lastDecided = lastDecidedChanges(cards);
      const changes = changesBetween(requirementsIn(facts), milestones).filter((change) => lastDecided.get(change.requirement.key) !== change.kind);
      if (changes.length === 0) return stopWaitingCard();

      // By requirement, because one can have more than one Milestone, and what's left out at the cut has to be able to come back.
      const requirementsChanged = [...new Set(changes.map(({ requirement }) => requirement.key))];
      const firstFew = new Set(requirementsChanged.slice(0, MOST_CHANGES_ON_A_CARD));
      const onCard = changes.filter(({ requirement }) => firstFew.has(requirement.key));
      const fromAudit = { changes: [...firstFew].map((key) => ({ kind: onCard.find(({ requirement }) => requirement.key === key)!.kind, requirement: key })) };
      if (waitingFromAudit && JSON.stringify(waitingFromAudit.content.fromAudit) === JSON.stringify(fromAudit)) return;

      const target = targetTerm(todayInPhiladelphia(now));
      const adds = onCard.flatMap((change) => (change.kind === "add" ? [milestoneFor(change.requirement, target, now)] : []));
      const removes = onCard.flatMap((change) => (change.kind === "remove" ? [{ id: change.milestone.id, name: change.milestone.name }] : []));
      const more = requirementsChanged.length - firstFew.size;
      const summary = [...adds.map(({ name }) => `Add: ${name}`), ...removes.map(({ name }) => `Remove: ${name}`)].join("\n");

      data.addCard(
        THE_STUDENT,
        {
          kind: "change",
          why: `Your DARS audit from ${audit.created} doesn't match your Roadmap.`,
          note: [
            "Nothing changes unless you tap Accept.",
            adds.length > 0 ? "Any date here is Buddy's target for you, not a Temple deadline." : null,
            "An audit isn't the final word on graduating, so check anything that matters with your academic advisor.",
            more > 0 ? `There ${more === 1 ? "is 1 more" : `are ${more} more`}, which Buddy will show you once you've decided on this one, the next time it reads DARS.` : null,
          ]
            .filter((line) => line !== null)
            .join(" "),
          adds,
          removes,
          fromAudit,
        },
        afterMessageId,
        now,
        { kind: "roadmap_change_proposed", title: "Buddy suggested a change to your Roadmap, from your DARS audit", at: now, detail: summary },
      );
    },
  };
}
