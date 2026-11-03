import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAuditList, readAuditPage } from "../src/dars-pages.ts";
import { pageFrom } from "./support/tuportal-pages.ts";

/** Every page here is made up. Nobody has seen the real DARS: see dars-rules.ts. */
const saved = (name: string) => readFileSync(new URL(`./fixtures/dars-pages/${name}.html`, import.meta.url), "utf8");
const savedPage = (name: string) => pageFrom(saved(name));
const changed = (name: string, from: string | RegExp, to: string) => {
  const before = saved(name);
  const after = before.replace(from, to);
  expect(after).not.toBe(before);
  return pageFrom(after);
};

describe("reading the list of audits", () => {
  it("finds the audits with their program, when they were made and where to view them", () => {
    const list = readAuditList(savedPage("audit-list"));

    expect(list?.audits).toEqual([
      { program: "MADE-UP-BS", created: "10/30/2026 3:52 PM", day: "2026-10-30", minute: "2026-10-30T15:52", address: "/selfservice/audit/read.html?id=made-up-newest" },
      { program: "MADE-UP-BS", created: "08/07/2026 10:45 AM", day: "2026-08-07", minute: "2026-08-07T10:45", address: "/selfservice/audit/read.html?id=made-up-older" },
    ]);
  });

  it("leaves What-If audits out, because they're about a major the Student doesn't have", () => {
    const list = readAuditList(savedPage("audit-list"));

    expect(list?.audits.map(({ address }) => address).join(" ")).not.toContain("what-if");
    expect(list?.whatIfs).toBe(1);
  });

  it("takes an all-nines catalog year for a What-If, whatever its type says", () => {
    const list = readAuditList(changed("audit-list", '<span class="badge">WHAT-IF</span>', ""));

    expect(list?.audits).toHaveLength(2);
    expect(list?.whatIfs).toBe(1);
  });

  it("says there are none only when the page says so", () => {
    expect(readAuditList(savedPage("audit-list-empty"))).toEqual({ audits: [], whatIfs: 0 });
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
    ]);
  });

  it("says which parts of a missing requirement are still missing, and the courses named in it", () => {
    const missing = readAuditPage(savedPage("audit"))?.requirements[1];

    expect(missing?.missingParts).toEqual(["1) HUMAN BEHAVIOR COURSE"]);
    expect(missing?.courses).toEqual(["MADE 0814", "ALSO 0815"]);
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
    expect(readAuditPage(changed("audit", "subrequirement Status_NO", "subrequirement Status_MAYBE"))).toBeNull();
  });

  it("can't read a requirement with no title", () => {
    expect(readAuditPage(changed("audit", '<div class="reqTitle">MAJOR ELECTIVES</div>', ""))).toBeNull();
  });

  it("can't read a page that has no requirements on it", () => {
    expect(readAuditPage(pageFrom("<h1>Your audit is loading</h1>"))).toBeNull();
  });

  it("doesn't count a requirement that isn't shown", () => {
    expect(readAuditPage(changed("audit", '<div class="reqTitle">MAJOR ELECTIVES</div>', '<div class="reqTitle" style="display:none">MAJOR ELECTIVES</div>'))).toBeNull();
  });

  it("can't read a page that says something's unmet when every requirement looks complete", () => {
    const allComplete = `<p>AT LEAST ONE REQUIREMENT HAS NOT BEEN SATISFIED</p><div class="requirement Status_OK"><div class="reqTitle">ONE</div></div>`;

    expect(readAuditPage(pageFrom(allComplete))).toBeNull();
  });

  it("can't read a page that says all's complete when a requirement looks missing", () => {
    const oneMissing = `<p>ALL REQUIREMENTS COMPLETE</p><div class="requirement Status_NO"><div class="reqTitle">ONE</div></div>`;

    expect(readAuditPage(pageFrom(oneMissing))).toBeNull();
  });

  it("can't read a What-If audit, which is about a major the Student doesn't have", () => {
    expect(readAuditPage(changed("audit", "Catalog Year 202636", "Catalog Year 999999"))).toBeNull();
  });
});
