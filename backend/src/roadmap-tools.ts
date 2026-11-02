/** What Claude can do about Goals and the Roadmap, and what it's told about them. Nothing here can accept a card. */

export const SAVE_GOAL_TOOL = {
  name: "save_goal",
  description:
    "Saves one Goal, something the Student wants to achieve, such as 'Get into PA school' or 'Graduate in four years'. They can have several, and they see and change them on the You tab. Use it only for a Goal they've said is theirs, not for one you suggested and they haven't chosen. Make one call per Goal.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      goal: { type: "string", description: "The Goal as a few plain words, in the language the Student wrote in." },
    },
    required: ["goal"],
    additionalProperties: false,
  },
};

export const READ_PLAN_TOOL = {
  name: "read_academic_plan",
  description:
    "Reads the Suggested Academic Plan for the Student's major from Temple's Bulletin, with its Source, for undergraduate degrees. It only works for a major that's in their Profile.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      major: { type: "string", description: "The major in English, as the Bulletin would name it, with the degree if you know it, such as 'Biology BS'." },
      major_fact: { type: "string", description: "The fact from the Student's Profile that says their major, copied word for word." },
    },
    required: ["major", "major_fact"],
    additionalProperties: false,
  },
};

const GOAL_MILESTONE = {
  type: "object",
  properties: {
    goal_id: { type: "integer", description: "The id of the one Goal this belongs to." },
    name: { type: "string", description: "What the Student decides or does, as a short plain instruction, in the language they write in. No date." },
    detail: { type: ["string", "null"], description: "A sentence on why it helps, or null." },
    due_date: { type: "string", description: "A target date you suggest, as YYYY-MM-DD, after today." },
    guidebook_item_id: {
      type: ["integer", "null"],
      description: "The id of the Guidebook item this relies on, whose Source then shows. Null if it's general advice with nothing specific to Temple in it.",
    },
  },
  required: ["goal_id", "name", "detail", "due_date", "guidebook_item_id"],
  additionalProperties: false,
};

/**
 * This and SUGGEST_CHANGE_TOOL aren't strict, unlike every other tool. With all of them strict, the API refuses
 * every request in a conversation: "The compiled grammar is too large". They have the biggest schemas, and
 * roadmap.ts checks all of their input before any card is shown, so strict adds least here.
 */
export const PROPOSE_ROADMAP_TOOL = {
  name: "propose_roadmap",
  description:
    "Shows the Student a card proposing their first Roadmap. You write only the Milestones for each Goal. Buddy adds the terms of the Suggested Academic Plan, the Standard Milestones and the unwritten-rules Milestones itself. Nothing changes unless the Student taps Accept.",
  input_schema: {
    type: "object" as const,
    properties: {
      why: { type: "string", description: "One short sentence to the Student on how this fits their Goals, in the language they write in." },
      plan_id: { type: ["integer", "null"], description: `The plan_id that ${READ_PLAN_TOOL.name} gave you. Null only if the Student has no major yet.` },
      plan_option: { type: ["integer", "null"], description: "Which of the page's plans fits the Student, by its option number. Null if plan_id is null." },
      plan_goal_id: { type: ["integer", "null"], description: "The id of the one Goal that following the plan serves best. Null if plan_id is null." },
      current_plan_year: { type: "integer", description: "Which year of study the Student is in now, or in the summer the one they're about to start: 1 for a first-year student, 2 for a sophomore, and so on." },
      year_fact: { type: "string", description: "The fact from the Student's Profile that says their year, copied word for word." },
      goal_milestones: { type: "array", items: GOAL_MILESTONE, description: "Two to four Milestones for each Goal, each belonging to exactly one Goal." },
    },
    required: ["why", "plan_id", "plan_option", "plan_goal_id", "current_plan_year", "year_fact", "goal_milestones"],
    additionalProperties: false,
  },
};

/** The same for both, but a change's are all null unless it adds a plan. */
const PLAN_FOR_A_CHANGE = {
  plan_id: { type: ["integer", "null"], description: `The plan_id that ${READ_PLAN_TOOL.name} gave you, to add the plan's terms, such as once the Student has chosen a major. Otherwise null.` },
  plan_option: { type: ["integer", "null"], description: "Which of the page's plans fits the Student, by its option number. Null if plan_id is null." },
  plan_goal_id: { type: ["integer", "null"], description: "The id of the one Goal that following the plan serves best. Null if plan_id is null." },
  current_plan_year: { type: ["integer", "null"], description: "Which year of study the Student is in now, or in the summer the one they're about to start. Null if plan_id is null." },
  year_fact: { type: ["string", "null"], description: "The fact from the Student's Profile that says their year, copied word for word. Null if plan_id is null." },
};

export const SUGGEST_CHANGE_TOOL = {
  name: "suggest_roadmap_change",
  description:
    "Shows the Student a card suggesting a change to the Roadmap they have, such as a new Milestone after a new Goal. Nothing changes unless the Student taps Accept.",
  input_schema: {
    type: "object" as const,
    properties: {
      why: { type: "string", description: "One short sentence to the Student on why, in the language they write in." },
      ...PLAN_FOR_A_CHANGE,
      goal_milestones: { type: "array", items: GOAL_MILESTONE, description: "New Milestones that each belong to one Goal." },
      standard_milestone_ids: { type: "array", items: { type: "integer" }, description: "Standard Milestones to add, by the ids the search gave you." },
      remove_milestone_ids: { type: "array", items: { type: "integer" }, description: "Milestones to take off the Roadmap, by the ids in the note with this turn." },
    },
    required: ["why", ...Object.keys(PLAN_FOR_A_CHANGE), "goal_milestones", "standard_milestone_ids", "remove_milestone_ids"],
    additionalProperties: false,
  },
};

export const ROADMAP_TOOLS = [SAVE_GOAL_TOOL, READ_PLAN_TOOL, PROPOSE_ROADMAP_TOOL, SUGGEST_CHANGE_TOOL];

/** Part of the frozen system prompt, so nothing here varies by Student or turn. */
export const ROADMAP_PROMPT = `A Goal is something the Student wants to achieve, and they can have several. When they say what they want to achieve, call ${SAVE_GOAL_TOOL.name}, and when they mention a new one later, call it again. The note with each turn lists their Goals. If they have no Goal yet and aren't sure, or they ask for a Roadmap before they have one, help them choose one: ask a question or two about what they care about or picture doing after Temple, suggest two or three Goals that fit, and let them pick. Save only one they've chosen, and it's fine if they want to think about it.

A Roadmap is the Student's own ordered list of Milestones, on the Roadmap tab. Once they have a Goal, offer to make them one, and go ahead when they say yes or ask. You need their major and their year: if the Profile doesn't say, ask, say it's so that you can read the right plan, and save the answers with remember. They can skip those questions, but tell them the Roadmap has to wait for their year. If they haven't chosen a major yet, you can go without a plan. Otherwise call ${READ_PLAN_TOOL.name} first. If it says more than one degree fits, or a degree has more than one plan, ask them which one. If it can't find their major, say plainly that you couldn't find a Source for it, and offer a Handoff. Then call ${PROPOSE_ROADMAP_TOOL.name} once.

For ${PROPOSE_ROADMAP_TOOL.name}, write two to four Milestones for each Goal: real decisions or things to get done for it, with target dates that fit where they are now. Buddy adds the plan's terms, the Standard Milestones and the unwritten-rules Milestones itself, so don't write those. Anything specific to Temple needs a Guidebook item behind it, and never name a course unless it's in the plan.

The card is on the Student's screen with everything on it, so don't recite it. Reply in a sentence or two, and say that nothing changes until they tap Accept, which takes one tap and which they can change afterward on the Roadmap tab. It isn't a Permission, so never call it one. Only that tap accepts it: if they type yes, tell them to tap Accept on the card. You can't add, remove or mark anything on the Roadmap yourself. To suggest a change later, such as Milestones for a new Goal, or the plan's terms once they've chosen a major, use ${SUGGEST_CHANGE_TOOL.name}, which also shows a card. Say only what the note with each turn says became of a card. The Add to Google Calendar link on each Milestone is for the Student to tap: you can't put anything on their calendar yourself.`;
