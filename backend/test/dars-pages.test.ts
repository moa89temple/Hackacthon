import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAuditList, readAuditPage } from "../src/dars-pages.ts";
import { pageFrom } from "./support/tuportal-pages.ts";

/** Every page here is made up, in the layout of a real audit seen on 2026-11-03: see dars-rules.ts. */
const saved = (name: string) => readFileSync(new URL(`./fixtures/dars-pages/${name}.html`, import.meta.url), "utf8");
const savedPage = (name: string) => pageFrom(saved(name));
const changed = (name: string, from: string | RegExp, to: string) => {
  const before = saved(name);
  const after = before.replace(from, to);
  expect(after).not.toBe(before);
  return pageFrom(after);
};

/** Around a requirement or two, what a whole audit has. */
const wholeAudit = (blocks: string) => `<h2>Audit Result Details</h2>${blocks}<div class="requirement Status_NONE category_ACADEMIC_HISTOR"><div class="reqTitle">ACADEMIC HISTORY</div></div>`;

describe("reading the list of audits", () => {
  it("finds the audits with their program, when they were made and where to view them", () => {
    const list = readAuditList(savedPage("audit-list"));

    expect(list).toEqual([
      { program: "MADE-UP-BS", created: "10/30/2026 3:52 PM", day: "2026-10-30", minute: "2026-10-30T15:52", address: "/selfservice/audit/read.html?id=made-up-newest" },
      { program: "MADE-UP-BS", created: "08/07/2026 10:45 AM", day: "2026-08-07", minute: "2026-08-07T10:45", address: "/selfservice/audit/read.html?id=made-up-older" },
    ]);
  });

  it("leaves What-If audits out, because they're about a major the Student doesn't have", () => {
    const list = readAuditList(savedPage("audit-list"));

    expect(list?.map(({ address }) => address).join(" ")).not.toContain("what-if");
  });

  it("takes an all-nines catalog year for a What-If, whatever its type says", () => {
    const list = readAuditList(changed("audit-list", '<span class="badge">WHAT-IF</span>', ""));

    expect(list?.map(({ program }) => program)).toEqual(["MADE-UP-BS", "MADE-UP-BS"]);
  });

  it("says there are none only when the page says so", () => {
    expect(readAuditList(savedPage("audit-list-empty"))).toEqual([]);
  });

  it("can't read a page with no list and no words saying it's empty", () => {
    expect(readAuditList(pageFrom("<h2>Completed Audit Requests</h2><p>Something else is here now.</p>"))).toBeNull();
  });

  it("doesn't take the words for none from something hidden, while the audits are drawn some other way", () => {
    expect(readAuditList(pageFrom('<p style="display:none">No audits found.</p><div class="made-up-row">An audit</div>'))).toBeNull();
  });

  it("can't read a list if a date is one it doesn't know, so that it can't pick the wrong newest", () => {
    expect(readAuditList(changed("audit-list", "10/30/2026 3:52 PM", "Friday afternoon"))).toBeNull();
  });

  it("can't read a list with a kind of audit it doesn't know, rather than taking it for the real one", () => {
    expect(readAuditList(changed("audit-list", "<td>10/30/2026 3:52 PM</td><td></td>", "<td>10/30/2026 3:52 PM</td><td>SOMETHING NEW</td>"))).toBeNull();
  });

  it("can't read a list if a row has no way to view its audit", () => {
    expect(readAuditList(changed("audit-list", '<a href="/selfservice/audit/read.html?id=made-up-newest">View Audit</a>', ""))).toBeNull();
  });

  it("can't read a list whose rows don't fit its headings", () => {
    expect(readAuditList(changed("audit-list", "<td>9000</td><td>TUB</td>", "<td>9000</td>"))).toBeNull();
  });
});

describe("reading an audit", () => {
  it("says what state each requirement is in, by the page's own mark for it", () => {
    const audit = readAuditPage(savedPage("audit"));

    expect(audit?.requirements.map(({ title, status }) => [title, status])).toEqual([
      ["GENED-GU --- GENED REQUIREMENT FOR U.S. SOCIETY", "complete"],
      ["GENED-GS2 --- GENED REQUIREMENT FOR SCIENCE & TECHNOLOGY", "missing"],
      ["MAJOR CORE COURSES", "in_progress"],
      ["MAJOR ELECTIVES", "planned"],
      ["NOTES ON THIS PROGRAM", "none"],
      ["ACADEMIC HISTORY", "none"],
    ]);
  });

  it("takes a title's first line as its title, and not the words about it", () => {
    expect(readAuditPage(savedPage("audit"))?.requirements[0]?.title).toBe("GENED-GU --- GENED REQUIREMENT FOR U.S. SOCIETY");
  });

  it("reads the real audit's layout, with the words replaced and the requirements shuffled", () => {
    const audit = readAuditPage(savedPage("audit-real-layout"));
    const counted = (state: string) => audit?.requirements.filter(({ status }) => status === state).length;

    // Eight of the 29 are notes with no title.
    expect(audit?.requirements).toHaveLength(21);
    expect([counted("complete"), counted("missing"), counted("in_progress"), counted("planned"), counted("none")]).toEqual([9, 3, 6, 0, 3]);
    const courses = audit?.requirements.flatMap(({ courses }) => courses) ?? [];
    expect(courses.length).toBeGreaterThan(0);
    expect(courses.every((course) => /^MADE \d{4}$/.test(course))).toBe(true);
  });

  it("says which parts of a missing requirement are still missing, and the courses named in it", () => {
    const missing = readAuditPage(savedPage("audit"))?.requirements[1];

    expect(missing?.missingParts).toEqual(["1) HUMAN BEHAVIOR COURSE"]);
    expect(missing?.courses).toEqual(["MADE 0814", "ALSO 0815"]);
  });

  it("doesn't count a course already taken as one that's needed", () => {
    expect(readAuditPage(savedPage("audit"))?.requirements[1]?.courses).not.toContain("TAKE 0900");
  });

  it("isn't stopped by the page's key to its marks, which is outside every requirement", () => {
    expect(readAuditPage(savedPage("audit"))).not.toBeNull();
    expect(saved("audit")).toContain('<span class="statusOK">Complete</span>');
  });

  it("can't read a requirement whose two marks disagree, one drawn and one not", () => {
    expect(readAuditPage(changed("audit", "status statusOK", "status statusNO"))).toBeNull();
  });

  it("can't read a requirement with a drawn mark it doesn't know", () => {
    expect(readAuditPage(changed("audit", "status statusOK", "status statusMAYBE"))).toBeNull();
  });

  it("leaves out a note with no title, which has no state", () => {
    const titles = readAuditPage(savedPage("audit"))?.requirements.map(({ title }) => title);

    expect(titles).not.toContain("");
    expect(titles).toHaveLength(6);
  });

  it("takes nothing of the Student's name, ID, GPA or grades", () => {
    const words = JSON.stringify(readAuditPage(savedPage("audit")));

    expect(words).not.toMatch(/MARKER/);
  });

  it("can't read a requirement with a mark it doesn't know, rather than guess", () => {
    expect(readAuditPage(changed("audit", "requirement Status_OK", "requirement Status_MAYBE"))).toBeNull();
  });

  it("can't read a requirement with no mark at all", () => {
    expect(readAuditPage(changed("audit", "requirement Status_OK", "requirement"))).toBeNull();
  });

  it("can't read a requirement with two marks that disagree", () => {
    expect(readAuditPage(changed("audit", "requirement Status_OK", "requirement Status_OK Status_NO"))).toBeNull();
  });

  it("can't read a part of a requirement with a mark it doesn't know", () => {
    expect(readAuditPage(changed("audit", "status Status_NO", "status Status_MAYBE"))).toBeNull();
  });

  it.each(["Status_NO", "Status_IP", "Status_PL"])("can't read a complete requirement with a part marked %s, because the two disagree", (mark) => {
    const page = wholeAudit(`<div class="requirement Status_OK"><div class="reqTitle">ONE</div><div class="subrequirement"><span class="status ${mark}"></span><div class="subreqTitle">A PART</div></div></div>`);

    expect(readAuditPage(pageFrom(page))).toBeNull();
  });

  it("can't read a page with a mark on something it doesn't know, which could be a requirement drawn another way", () => {
    const page = wholeAudit(`<div class="requirement Status_OK"><div class="reqTitle">ONE</div></div><div class="req-block Status_NO">TWO</div>`);

    expect(readAuditPage(pageFrom(page))).toBeNull();
  });

  it("can't read a page with a part that's in no requirement", () => {
    const page = wholeAudit(`<div class="requirement Status_OK"><div class="reqTitle">ONE</div></div><div class="subrequirement Status_NO"><div class="subreqTitle">A PART</div></div>`);

    expect(readAuditPage(pageFrom(page))).toBeNull();
  });

  it("can't read a page without the heading over the requirements", () => {
    expect(readAuditPage(changed("audit", "Audit Result Details", "Something else"))).toBeNull();
  });

  it("can't read a page that stops before its last block, because what's left out could be what's missing", () => {
    expect(readAuditPage(changed("audit", "category_ACADEMIC_HISTOR", "category_BLANK"))).toBeNull();
  });

  it("can read every requirement complete", () => {
    const page = wholeAudit(`<div class="requirement Status_OK"><div class="reqTitle">ONE</div></div>`);

    expect(readAuditPage(pageFrom(page))?.requirements.map(({ status }) => status)).toEqual(["complete", "none"]);
  });

  it.each([
    ["no title at all", ""],
    ["an empty title", '<div class="reqTitle"></div>'],
  ])("can't read a requirement that has a state and %s", (_, title) => {
    expect(readAuditPage(changed("audit", '<div class="reqTitle">MAJOR ELECTIVES</div>', title))).toBeNull();
  });

  it("can't read a page that has no requirements on it", () => {
    expect(readAuditPage(pageFrom("<h1>Your audit is loading</h1>"))).toBeNull();
  });

  it("doesn't count a requirement that isn't shown", () => {
    expect(readAuditPage(changed("audit", '<div class="reqTitle">MAJOR ELECTIVES</div>', '<div class="reqTitle" style="display:none">MAJOR ELECTIVES</div>'))).toBeNull();
  });

  it("can't read a What-If audit, which is about a major the Student doesn't have", () => {
    expect(readAuditPage(changed("audit", "Catalog Year 202636", "Catalog Year 999999"))).toBeNull();
  });
});
