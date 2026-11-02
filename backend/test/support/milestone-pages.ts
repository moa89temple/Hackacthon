import type { Office } from "../../src/office-pages.ts";
import { textBlock, type ScriptedReply } from "./scripted-claude.ts";

export const CALENDAR_PAGE = "https://registrar.temple.edu/academic-calendar/2026-2027-academic-calendar";
export const AID_DEADLINES_PAGE = "https://sfs.temple.edu/policies/financial-aid-deadlines";
export const CALENDAR_TITLE = "2026-2027 Academic Calendar | Office of the University Registrar | Temple University";
export const AID_DEADLINES_TITLE = "Financial Aid Deadlines | Student Financial Services";

/** Two real pages, so that a test can script Haiku's answer to each. */
export const TEST_MILESTONE_OFFICES: Office[] = [
  { name: "Office of the University Registrar", pages: [CALENDAR_PAGE] },
  { name: "Student Financial Services", pages: [AID_DEADLINES_PAGE] },
];

export type DateFromHaiku = {
  name: string;
  term?: string | null;
  date: string;
  end_date?: string | null;
  date_quote: string;
  what_quote: string;
  search_terms?: string[];
};

/** Haiku's answer for one page. */
export function haikuFindsDates(...items: DateFromHaiku[]): ScriptedReply {
  const complete = items.map((item) => ({ term: null, end_date: null, search_terms: [], ...item }));
  return { content: [textBlock(JSON.stringify({ items: complete }))] };
}

/** Each of these is what the saved 2026-27 calendar really says. */
export const WITHDRAW_16_WEEK: DateFromHaiku = {
  name: "Last day to withdraw from a Full Term 16-week course",
  term: "Fall 2026",
  date: "2026-12-07",
  date_quote: "Monday, December 7",
  what_quote: "Last day to withdraw from a Full Term 16-week course",
  search_terms: ["withdraw", "leave a class", "fall"],
};
export const WITHDRAW_7B: DateFromHaiku = {
  name: "Last day to withdraw from a 7-week (7B) course",
  term: "Fall 2026",
  date: "2026-11-30",
  date_quote: "Monday, November 30",
  what_quote: "Last day to withdraw from a 7-week (7B) course",
  search_terms: ["withdraw"],
};
export const ADD_DROP_16_WEEK: DateFromHaiku = {
  name: "Last day to add with instructor permission or drop a Full Term 16-week course",
  term: "Fall 2026",
  date: "2026-09-08",
  date_quote: "Tuesday, September 8",
  what_quote: "Last day to add with instructor permission or drop a Full Term 16-week (1) course",
  search_terms: ["drop", "add"],
};
export const FINALS_FIRST_DAYS: DateFromHaiku = {
  name: "Days 1-3 of Final Exams for Full Term 16-week Courses",
  term: "Fall 2026",
  date: "2026-12-09",
  end_date: "2026-12-11",
  date_quote: "Wednesday, December 9 - Friday, December 11",
  what_quote: "Days 1-3 of Final Exams for Full Term 16-week Courses (1)",
  search_terms: ["finals", "exams"],
};
export const PRIORITY_REGISTRATION_FALL: DateFromHaiku = {
  name: "Priority registration for Fall 2027 begins",
  term: "Spring 2027",
  date: "2027-03-29",
  date_quote: "Monday, March 29",
  what_quote: "Priority registration for Fall 2027 begins",
  search_terms: ["register", "sign up for classes"],
};

/** And these are what the saved Financial Aid Deadlines page really says. */
export const FAFSA_PRIORITY: DateFromHaiku = {
  name: "FAFSA priority filing deadline",
  date: "2027-02-01",
  date_quote: "February 1",
  what_quote: "The FAFSA priority filing deadline",
  search_terms: ["fafsa", "financial aid", "renew"],
};
export const LOAN_CHANGE_FINAL: DateFromHaiku = {
  name: "Final deadline to submit a loan change form",
  term: "Fall 2026",
  date: "2026-11-30",
  date_quote: "November 30, 2026",
  what_quote: "Final deadline to submit a loan change form",
  search_terms: ["loan"],
};
