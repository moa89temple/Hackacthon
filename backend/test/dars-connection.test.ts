import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dars } from "../src/dars.ts";
import { DARS_ID } from "../src/dars-rules.ts";
import { settings } from "../src/settings.ts";
import { tuportal } from "../src/tuportal.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { auditWith, darsPage, expireDarsLogin, LIST_PAGE, NEWEST_AUDIT, OLDER_AUDIT, saveDarsPages, savedDarsHtml, WHAT_IF_AUDIT } from "./support/dars-pages.ts";

/** Every page these read is made up. Nobody has seen the real DARS, so none of this proves the reader fits it. */
let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start({
    sites: { dars: settings.sites.dars!, tuportal: settings.sites.tuportal! },
    extraConnectionTypes: [dars, tuportal],
  });
  saveDarsPages(backend.browser);
});

afterEach(async () => {
  await backend.stop();
});

const statusOf = async () => (await backend.connections()).find((connection) => connection.id === DARS_ID);
const facts = async () => (await backend.profileFacts()).filter((fact) => fact.origin.connection === DARS_ID);
const pagesOpened = () => backend.browser.actions.filter((action) => action.type === "read").map((action: any) => action.url);
const forgotten = () => backend.browser.actions.filter((action) => action.type === "forget-login").flatMap((action: any) => action.hosts as string[]);
const connect = async () => expect((await backend.giveReadPermission(DARS_ID, undefined)).status).toBe(200);
const texts = async () => (await facts()).map((fact) => fact.text);

describe("the Read Permission card", () => {
  it("says what will be read, and that the Student logs in through a Takeover", async () => {
    const { card, logsIn } = await statusOf();

    expect(logsIn).toBe(true);
    expect(card.address).toBeNull();
    expect(card.reads.join(" ")).toMatch(/complete/);
    expect(card.reads.join(" ")).toMatch(/missing/);
    expect(card.notes.join(" ")).toMatch(/Takeover/);
    expect(card.notes.join(" ")).toMatch(/password/);
  });

  it("says what Buddy leaves alone, and that it won't run an audit", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/grades/);
    expect(notes).toMatch(/never runs a new audit/);
    expect(notes).toMatch(/What-If/);
  });

  it("says a change to the Roadmap only comes as a card, and what revoking does", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/Accept/);
    expect(notes).toMatch(/revoke/);
    expect(notes).toMatch(/Temple's sign-on stays/);
  });

  it("warns that Temple hasn't approved this", async () => {
    expect((await statusOf()).card.warning).toMatch(/Chief Information Security Officer/);
  });
});

describe("logging in", () => {
  it("won't start a Takeover before the Read Permission", async () => {
    expect((await backend.startTakeover(DARS_ID)).status).not.toBe(200);
  });

  it("logs in through a Takeover, which reads the audit once it's done", async () => {
    await backend.browser.savedPages.delete(LIST_PAGE);
    await connect();
    expect((await statusOf()).lastReadProblem).not.toBeNull();

    saveDarsPages(backend.browser);
    expect((await backend.startTakeover(DARS_ID)).status).toBe(200);
    expect(backend.browser.actions).toContainEqual({ type: "show", url: LIST_PAGE });
    const finished = (await (await backend.finishTakeover()).json()) as any;
    expect(finished.signedIn).toBe(true);
    await backend.untilReadsFinish(DARS_ID);

    expect(await texts()).toContainEqual(expect.stringMatching(/Requirement complete/));
  });

  it("asks the Student to log in when the login has expired, and keeps what it has", async () => {
    await connect();
    const before = await texts();

    expireDarsLogin(backend.browser);
    const status = (await (await backend.readNow(DARS_ID)).json()).connection;

    expect(status.needsLogin).toBe(true);
    expect(status.lastReadProblem).toMatch(/log in to DARS/i);
    expect(await texts()).toEqual(before);
  });

  it("takes a password field for somewhere to log in, wherever it turned up", async () => {
    backend.browser.savedPages.set(LIST_PAGE, darsPage('<form><input type="password"></form>'));
    await connect();

    expect((await statusOf()).needsLogin).toBe(true);
  });

  it("takes being sent somewhere off DARS that the guard won't go for a lost login", async () => {
    backend.browser.savedPages.set(LIST_PAGE, darsPage("<h1>Made up</h1>", { finalUrl: "https://sign-on.elsewhere.example/" }));
    await connect();

    expect((await statusOf()).needsLogin).toBe(true);
  });

  it("doesn't ask for a login when DARS has moved the list to a page Buddy doesn't open, which logging in wouldn't fix", async () => {
    backend.browser.savedPages.set(LIST_PAGE, darsPage("<h1>Made up</h1>", { finalUrl: "https://prd-dars.temple.edu/selfservice/general/somewhere-new.html" }));
    await connect();

    expect((await statusOf()).needsLogin).toBe(false);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense/);
  });

  it("says a Takeover may still be needed when Temple's sign-on doesn't ask for a password", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/may not ask for your password/);
    expect(notes).toMatch(/tap Done/);
    expect(notes).not.toMatch(/without asking you to log in again/);
  });

  it("says an old audit makes no card", async () => {
    expect((await statusOf()).card.notes.join(" ")).toMatch(/older than 30 days/);
  });
});

describe("what a read keeps", () => {
  it("turns complete and missing requirements into facts that each say they came from DARS", async () => {
    await connect();

    const all = await facts();
    expect(all.map((fact) => fact.text)).toEqual(
      expect.arrayContaining([
        "Requirement complete: GENED-GU --- GENED REQUIREMENT FOR U.S. SOCIETY",
        "Requirement missing: GENED-GS2 --- GENED REQUIREMENT FOR SCIENCE & TECHNOLOGY",
        "Requirement in progress: MAJOR CORE COURSES",
        "Requirement planned: MAJOR ELECTIVES",
      ]),
    );
    for (const fact of all) expect(fact.origin).toEqual({ type: "connection", connection: DARS_ID, name: "DARS" });
  });

  it("says which audit it read, and how many of each there were", async () => {
    await connect();

    const summary = (await facts()).find((fact) => /audit/i.test(fact.text) && !fact.text.startsWith("Requirement"));
    expect(summary.text).toBe("DARS audit from 10/30/2026 3:52 PM for MADE-UP-BS: 1 complete, 1 missing, 1 in progress, 1 planned");
  });

  it("says what's still missing of a missing requirement", async () => {
    await connect();

    const missing = (await facts()).find((fact) => fact.text.startsWith("Requirement missing"));
    expect(missing.detail).toMatch(/1\) HUMAN BEHAVIOR COURSE/);
  });

  it("makes no fact of a line with no state, and in progress or planned never counts as complete", async () => {
    await connect();

    const words = (await texts()).join("\n");
    expect(words).not.toMatch(/NOTES ON THIS PROGRAM/);
    expect(words).not.toMatch(/complete: MAJOR/);
  });

  it("keeps no name, ID, GPA or grade", async () => {
    await connect();

    expect(JSON.stringify(await backend.profileFacts())).not.toMatch(/MARKER/);
    expect(JSON.stringify(await backend.activity())).not.toMatch(/MARKER/);
  });

  it("hides what looks like a secret in anything it keeps", async () => {
    saveDarsPages(backend.browser, { audit: auditWith({ "My password is hunter2 for this": "Status_OK" }) });
    await connect();

    expect((await texts()).join(" ")).not.toContain("hunter2");
  });

  it("keeps a fact the Student deleted out of later reads", async () => {
    await connect();
    const fact = (await facts()).find((candidate) => candidate.text.startsWith("Requirement planned"));
    await backend.deleteFact(fact.id);

    await backend.readNow(DARS_ID);

    expect(await texts()).not.toContainEqual(expect.stringMatching(/Requirement planned/));
  });
});

describe("what a read opens", () => {
  it("opens only the list and the newest audit", async () => {
    await connect();

    expect(pagesOpened()).toEqual([LIST_PAGE, NEWEST_AUDIT]);
  });

  it("never opens a What-If audit, even when it's the newest on the list", async () => {
    await connect();

    expect(pagesOpened()).not.toContain(WHAT_IF_AUDIT);
  });

  it("doesn't go by the order of the list", async () => {
    const backwards = savedDarsHtml("audit-list").replace(/(<tr><td>9000.*?<\/tr>)(\s*)(<tr><td>8000.*?<\/tr>)/s, "$3$2$1");
    expect(backwards).not.toBe(savedDarsHtml("audit-list"));
    saveDarsPages(backend.browser, { list: backwards });
    await connect();

    expect(pagesOpened()).toEqual([LIST_PAGE, NEWEST_AUDIT]);
    expect(pagesOpened()).not.toContain(OLDER_AUDIT);
  });

  it.each([
    ["to run an audit", "/selfservice/audit/create.html"],
    ["to another host", "https://elsewhere.example/selfservice/audit/read.html?id=made-up-newest"],
    ["to some other page", "/selfservice/general/somewhere.html"],
  ])("doesn't follow a View Audit link that goes %s", async (_, address) => {
    saveDarsPages(backend.browser, { list: savedDarsHtml("audit-list").replace("/selfservice/audit/read.html?id=made-up-newest", address) });
    await connect();

    expect(pagesOpened()).toEqual([LIST_PAGE]);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense/);
    expect(await facts()).toEqual([]);
  });

  it("tells the Student when there's an audit for another program that it didn't read", async () => {
    const twoPrograms = savedDarsHtml("audit-list").replace("<td>MADE-UP-BS</td><td>202636</td><td>08/07/2026 10:45 AM</td>", "<td>MADE-UP-MINOR</td><td>202636</td><td>10/30/2026 3:53 PM</td>");
    backend.browser.savedPages.set(OLDER_AUDIT, darsPage(auditWith({ "A SECOND PROGRAM'S REQUIREMENT": "Status_NO" })));
    saveDarsPages(backend.browser, { list: twoPrograms });
    await connect();

    expect((await statusOf()).lastReadProblem).toMatch(/another program/);
    expect(pagesOpened()).toEqual([LIST_PAGE, OLDER_AUDIT]);
  });
});

describe("when Buddy can't read it", () => {
  it.each([
    ["a list it doesn't recognize", { list: "<h2>Something new</h2>" }],
    ["an audit it doesn't recognize", { audit: "<h1>Something new</h1>" }],
    ["a requirement with a mark it doesn't know", { audit: auditWith({ ONE: "Status_OK", TWO: "Status_MAYBE" }) }],
  ])("says so, saves nothing and claims nothing, for %s", async (_, pages) => {
    saveDarsPages(backend.browser, pages);
    await connect();

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense/);
    expect((await statusOf()).lastReadProblem).toMatch(/doesn't mean/);
    expect(await facts()).toEqual([]);
  });

  it("keeps what it had from an earlier read as it was", async () => {
    await connect();
    const before = await texts();

    saveDarsPages(backend.browser, { audit: "<h1>Something new</h1>" });
    await backend.readNow(DARS_ID);

    expect(await texts()).toEqual(before);
    expect((await statusOf()).lastReadProblem).toMatch(/kept what it already had/);
  });

  it("says no audit's there only when the page says so, and that doesn't mean nothing's missing", async () => {
    saveDarsPages(backend.browser, { list: savedDarsHtml("audit-list-empty") });
    await connect();

    expect(await texts()).toEqual(["DARS has no audit of yours to read yet"]);
    expect((await statusOf()).lastReadProblem).toBeNull();
    expect(pagesOpened()).toEqual([LIST_PAGE]);
  });

  it("counts a list of nothing but What-If audits as having none of the Student's own", async () => {
    const onlyWhatIf = savedDarsHtml("audit-list").replace(/<tr><td>9000.*?<\/tr>/s, "").replace(/<tr><td>8000.*?<\/tr>/s, "");
    saveDarsPages(backend.browser, { list: onlyWhatIf });
    await connect();

    expect(await texts()).toEqual(["DARS has no audit of yours to read yet"]);
    expect(pagesOpened()).toEqual([LIST_PAGE]);
  });
});

describe("Activity", () => {
  it("shows each read, and how many changed, without repeating what they are", async () => {
    saveDarsPages(backend.browser, { audit: auditWith({ ONE: "Status_NO", TWO: "Status_OK" }) });
    await connect();
    const newest = async () => (await backend.activity()).find((entry) => entry.kind === "connection_read");

    expect((await newest()).title).toBe("Buddy read DARS");

    saveDarsPages(backend.browser, { audit: auditWith({ ONE: "Status_OK", TWO: "Status_OK" }) });
    await backend.readNow(DARS_ID);

    expect((await newest()).detail).toMatch(/1 requirement now complete/);
    expect((await newest()).detail).not.toMatch(/ONE/);
  });

  it("shows a read that failed", async () => {
    saveDarsPages(backend.browser, { audit: "<h1>Something new</h1>" });
    await connect();

    expect((await backend.activity()).find((entry) => entry.kind === "connection_read_failed").title).toBe("Buddy couldn't read DARS");
  });
});

describe("revoking the Read Permission", () => {
  it("deletes every fact and the login", async () => {
    await connect();
    expect(await facts()).not.toEqual([]);

    await backend.revokeReadPermission(DARS_ID);

    expect(await facts()).toEqual([]);
    expect(forgotten()).toEqual(expect.arrayContaining(["prd-dars.temple.edu", "dars.temple.edu"]));
  });

  it("clears Temple's shared sign-on when it was the last Temple Connection", async () => {
    await connect();

    await backend.revokeReadPermission(DARS_ID);

    expect(forgotten()).toEqual(expect.arrayContaining(["fim.temple.edu", "duosecurity.com"]));
  });

  it("keeps Temple's shared sign-on while another Temple Connection is on", async () => {
    await connect();
    await backend.giveReadPermission(tuportal.id, undefined);

    await backend.revokeReadPermission(DARS_ID);

    expect(forgotten()).toContain("prd-dars.temple.edu");
    expect(forgotten()).not.toContain("fim.temple.edu");
  });

  it("can't reach DARS once it's revoked", async () => {
    await connect();
    await backend.revokeReadPermission(DARS_ID);

    await expect(backend.browserAccess.read(LIST_PAGE)).rejects.toThrow(/Read Permission/);
  });
});
