import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  readAnnouncementsPage,
  readAssignmentsPage,
  readCanvasDate,
  readCoursesPage,
  readGradesPage,
} from "../src/canvas-pages.ts";

const saved = (name: string) =>
  readFileSync(new URL(`./fixtures/canvas-pages/${name}.html`, import.meta.url), "utf8");

describe("reading the course list", () => {
  it("finds this term's courses, and leaves out past ones and groups", () => {
    const courses = readCoursesPage(saved("courses"));

    expect(courses).toEqual([
      { id: "101", name: "Made-Up Biology 1111", term: "2026 Fall", isStudent: true },
      { id: "102", name: "Made-Up Writing 0802", term: "2026 Fall", isStudent: true },
      { id: "103", name: "Made-Up Peer Tutoring", term: "2026 Fall", isStudent: false },
    ]);
  });

  it("finds nothing, and says so, for a Student with no courses", () => {
    expect(readCoursesPage('<div class="header-bar"><h1>All Courses</h1></div><div class="ic-Action-header"></div>')).toEqual([]);
  });

  it("says it couldn't understand a page that isn't the course list", () => {
    expect(readCoursesPage("<html><body><h1>Page Not Found</h1></body></html>")).toBeNull();
  });
});

describe("reading the assignments list", () => {
  const assignments = readAssignmentsPage(saved("assignments"))!;

  it("finds each assignment with its exact due time", () => {
    expect(assignments[0]).toEqual({
      id: "501",
      name: "Made-Up Lab Report 3",
      dueAt: "2026-11-06T04:59:00.000Z",
      points: "20",
      score: null,
    });
  });

  it("keeps a score the page shows", () => {
    expect(assignments[1]).toMatchObject({ id: "502", score: "18", points: "20" });
  });

  it("keeps the name and date of a quiz, without anything from its page", () => {
    expect(assignments[2]).toMatchObject({ id: "503", name: "Made-Up Midterm Exam", dueAt: "2026-11-21T04:59:00.000Z" });
  });

  it("leaves the due date empty when there isn't one", () => {
    expect(assignments[3]).toMatchObject({ id: "504", dueAt: null });
  });

  it("finds nothing, and says so, when a course has no assignments", () => {
    expect(readAssignmentsPage('<div class="ig-row ig-row-empty"><div class="ig-empty-msg">No assignments</div></div>')).toEqual([]);
  });

  it("says it couldn't understand a page whose list never came", () => {
    expect(readAssignmentsPage('<h1 class="assignment_index_header_title">Assignments</h1><div id="ag-list"></div>')).toBeNull();
  });
});

describe("reading the grades page", () => {
  const now = new Date("2026-11-02T14:00:00Z");
  const grades = readGradesPage(saved("grades"), now)!;
  const row = (id: string) => grades.assignments.find((assignment) => assignment.id === id)!;

  it("finds the Student's own score, out of what it's worth", () => {
    expect(row("502")).toMatchObject({ name: "Made-Up Lab Report 2", score: "18", points: "20", submitted: true, missing: false, late: false });
  });

  it("leaves out the class's mean, high and low", () => {
    expect(JSON.stringify(grades)).not.toMatch(/77\.77|19\.99|11\.11/);
  });

  it("reads a due date written in words, on Philadelphia's clock", () => {
    expect(row("501")).toMatchObject({ dueAt: "2026-11-06T04:59:00.000Z", score: null, submitted: false });
  });

  it("says when something is marked missing", () => {
    expect(row("505")).toMatchObject({ missing: true, score: null });
  });

  it("gives no score for a grade that hasn't been released", () => {
    expect(row("506")).toMatchObject({ score: null, submitted: true });
  });

  it("keeps group subtotals out of the assignments, and finds the course's total", () => {
    expect(grades.assignments.map(({ id }) => id)).toEqual(["502", "501", "505", "506"]);
    expect(grades.total).toBe("91.2%");
  });

  it("says it couldn't understand a page with no grades table", () => {
    expect(readGradesPage('<div id="grade-summary-react"></div>', now)).toBeNull();
  });
});

describe("reading the announcements list", () => {
  const now = new Date("2026-11-02T14:00:00Z");
  const announcements = readAnnouncementsPage(saved("announcements"), now)!;

  it("finds each one's title, date and text", () => {
    expect(announcements[0]).toEqual({
      id: "900",
      title: "Made-Up Lab Moved To Beury 160",
      postedAt: "2026-11-01T14:00:00.000Z",
      text: "Made-up body: bring your goggles on Thursday.",
    });
  });

  it("copes with one that has no text", () => {
    expect(announcements[1]).toMatchObject({ id: "899", title: "Made-Up Welcome Note", text: "" });
  });

  it("doesn't keep who wrote it", () => {
    expect(JSON.stringify(announcements)).not.toContain("Professor");
  });

  it("finds nothing, and says so, when there are none", () => {
    expect(readAnnouncementsPage('<div class="announcements-v2__wrapper"><h2>No Announcements</h2></div>', now)).toEqual([]);
  });

  it("says it couldn't understand a page whose list never came", () => {
    expect(readAnnouncementsPage('<div class="announcements-v2__wrapper">Loading Announcements</div>', now)).toBeNull();
  });
});

describe("Canvas's way of writing dates", () => {
  const now = new Date("2026-11-02T14:00:00Z");

  it.each([
    ["Nov 5 by 11:59pm", "2026-11-06T04:59:00.000Z"],
    ["Nov 5 at 11:59pm", "2026-11-06T04:59:00.000Z"],
    ["Nov 5, 2026 at 9:00am", "2026-11-05T14:00:00.000Z"],
    ["Oct 26 by 8am", "2026-10-26T12:00:00.000Z"],
    ["Nov 5", "2026-11-06T04:59:00.000Z"],
  ])("reads %s", (text, moment) => {
    expect(readCanvasDate(text, now)).toBe(moment);
  });

  it("takes a date with no year to be the one nearest to now", () => {
    expect(readCanvasDate("Jan 10 by 11:59pm", now)).toBe("2027-01-11T04:59:00.000Z");
    expect(readCanvasDate("Aug 24 at 8:00am", now)).toBe("2026-08-24T12:00:00.000Z");
  });

  it.each(["", "Multiple Dates", "Soon", "Feb 31"])("gives up on %j rather than guess", (text) => {
    expect(readCanvasDate(text, now)).toBeNull();
  });
});
