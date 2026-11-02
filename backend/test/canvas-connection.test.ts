import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageBlocked } from "../src/buddys-browser.ts";
import { canvas } from "../src/canvas.ts";
import { settings } from "../src/settings.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { toolUseBlock } from "./support/scripted-claude.ts";
import {
  CANVAS_HOME,
  changeSavedPage,
  coursePage,
  COURSES_PAGE,
  expireCanvasLogin,
  saveCanvasPages,
} from "./support/canvas-pages.ts";

const CANVAS = canvas.id;
/** Canvas's own address as well as the hosts holding its login, so that its own storage goes too. */
const LOGIN_HOSTS = ["templeu.instructure.com", ...settings.sites.canvas.loginHosts];
let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start({ sites: { canvas: settings.sites.canvas }, extraConnectionTypes: [canvas] });
  saveCanvasPages(backend.browser);
});

afterEach(async () => {
  await backend.stop();
});

const statusOf = async () => (await backend.connections()).find((connection) => connection.id === CANVAS);
const factsFromCanvas = async () => (await backend.profileFacts()).filter((fact) => fact.origin.connection === CANVAS);
const fact = async (textPart: string) => (await factsFromCanvas()).find((candidate) => candidate.text.includes(textPart));
const pagesOpened = () => backend.browser.actions.filter((action) => action.type === "read").map((action: any) => action.url);
const connectCanvas = async () => {
  const response = await backend.giveReadPermission(CANVAS, undefined);
  expect(response.status).toBe(200);
};

describe("the Read Permission card", () => {
  it("says exactly what will be read", async () => {
    const { card } = await statusOf();

    expect(card.reads.join(" ")).toMatch(/courses/);
    expect(card.reads.join(" ")).toMatch(/assignments/);
    expect(card.reads.join(" ")).toMatch(/due dates/);
    expect(card.reads.join(" ")).toMatch(/grades/);
    expect(card.reads.join(" ")).toMatch(/announcements/);
  });

  it("warns that Instructure's own rules forbid this, naming them", async () => {
    const { card } = await statusOf();

    expect(card.warning).toMatch(/Acceptable Use Policy/);
    expect(card.warning).toMatch(/scraping/);
    expect(card.warning).toMatch(/API Policy/);
    expect(card.warning).toMatch(/account/);
  });

  it("says what Buddy never opens, and that the Student logs in themselves", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/rosters/);
    expect(notes).toMatch(/discussion boards/);
    expect(notes).toMatch(/quizzes or exams/);
    expect(notes).toMatch(/never submits graded work/);
    expect(notes).toMatch(/Takeover/);
    expect(notes).toMatch(/password/);
  });

  it("has no address to paste", async () => {
    expect((await statusOf()).card.address).toBeNull();
  });
});

describe("without a Read Permission", () => {
  it("opens nothing on Canvas", async () => {
    await expect(backend.browserAccess.read(COURSES_PAGE)).rejects.toThrow(PageBlocked);

    expect(pagesOpened()).toEqual([]);
  });

  it("refuses Read now", async () => {
    expect((await backend.readNow(CANVAS)).status).toBe(403);
    expect(pagesOpened()).toEqual([]);
  });

  it("the schedule leaves it alone", async () => {
    await backend.readDueConnections();

    expect(pagesOpened()).toEqual([]);
  });

  it("refuses a Takeover, because the Read Permission comes first", async () => {
    const response = await backend.startTakeover(CANVAS);

    expect(response.status).toBe(403);
    expect(backend.browser.actions).toEqual([]);
    expect(await backend.currentTakeover()).toBeNull();
  });
});

describe("reading Canvas", () => {
  it("turns the pages into facts, each recording that it came from Canvas", async () => {
    await connectCanvas();

    const facts = await factsFromCanvas();
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((candidate) => candidate.origin.name === "Canvas")).toBe(true);
    expect(await fact("Course: Made-Up Biology 1111")).toMatchObject({ detail: "2026 Fall" });
    expect(await fact("Made-Up Biology 1111: Made-Up Lab Report 3")).toMatchObject({
      detail: expect.stringContaining("Thursday, November 5"),
    });
    expect((await fact("Made-Up Lab Report 3"))!.detail).toMatch(/not submitted/i);
    expect(await fact("Made-Up Lab Report 2 in Made-Up Biology 1111: 18 out of 20")).toBeDefined();
    expect(await fact("Current grade in Made-Up Biology 1111: 91.2%")).toBeDefined();
    expect(await fact("Announcement in Made-Up Biology 1111: Made-Up Lab Moved To Beury 160")).toMatchObject({
      detail: expect.stringContaining("bring your goggles"),
    });
    expect(await statusOf()).toMatchObject({ on: true, needsLogin: false, lastReadProblem: null });
  });

  it("takes an assignment found only on the grades page too", async () => {
    await connectCanvas();

    expect(await fact("Made-Up Worksheet Only On Grades")).toMatchObject({ detail: expect.stringMatching(/missing/i) });
  });

  it("opens only the pages on its list, in the courses the Student takes", async () => {
    await connectCanvas();

    expect(pagesOpened()).toEqual([
      COURSES_PAGE,
      coursePage("101", "assignments"),
      coursePage("101", "grades"),
      coursePage("101", "announcements"),
      coursePage("102", "assignments"),
      coursePage("102", "grades"),
      coursePage("102", "announcements"),
    ]);
  });

  it("records a course they help teach without opening anything in it", async () => {
    await connectCanvas();

    expect(await fact("Course: Made-Up Peer Tutoring")).toBeDefined();
    expect(pagesOpened().some((url) => url.includes("/courses/103"))).toBe(false);
  });

  it("keeps out what's about other people", async () => {
    await connectCanvas();

    const everything = JSON.stringify(await factsFromCanvas());
    expect(everything).not.toMatch(/77\.77|19\.99|11\.11/);
    expect(everything).not.toContain("Made Up Professor");
    expect(everything).not.toContain("Made-Up Study Group");
    expect(everything).not.toContain("Made-Up Old Course");
  });

  it("hides a secret in anything it saves", async () => {
    changeSavedPage(backend.browser, coursePage("101", "announcements"), (html) =>
      html.replace("bring your goggles", "password: hunter2 bring your goggles"),
    );

    await connectCanvas();

    expect(JSON.stringify(await factsFromCanvas())).not.toContain("hunter2");
    expect(backend.storageContains("hunter2")).toBe(false);
  });

  it("shows in Activity, whether on request or on schedule", async () => {
    await connectCanvas();
    await backend.readNow(CANVAS);
    backend.clock.moveForward(6 * 3_600_000);
    await backend.readDueConnections();

    const reads = (await backend.activity()).filter((entry) => entry.title === "Buddy read Canvas");
    expect(reads.map((entry) => entry.detail)).toEqual([
      "It was one of Buddy's regular read times.",
      "You tapped Read now.",
      "You had just given its Read Permission.",
    ]);
  });

  it("reads three times a day, and not again until the next time comes", async () => {
    // The harness starts at 9 a.m. in Philadelphia.
    await connectCanvas();
    const reads = async () => (await backend.activity()).filter((entry) => entry.title === "Buddy read Canvas").length;

    await backend.readDueConnections();
    expect(await reads()).toBe(1);

    backend.clock.moveForward(4 * 3_600_000); // 1 p.m.
    await backend.readDueConnections();
    await backend.readDueConnections();
    expect(await reads()).toBe(2);

    backend.clock.moveForward(6 * 3_600_000); // 7 p.m.
    await backend.readDueConnections();
    expect(await reads()).toBe(3);

    backend.clock.moveForward(3 * 3_600_000); // 10 p.m.
    await backend.readDueConnections();
    expect(await reads()).toBe(3);

    backend.clock.moveForward(9 * 3_600_000); // 7 a.m.
    await backend.readDueConnections();
    expect(await reads()).toBe(4);
  });

  it("keeps what it had, and says so, when a page can't be understood", async () => {
    await connectCanvas();
    changeSavedPage(backend.browser, coursePage("101", "grades"), () => "<h1>Something changed</h1>");

    await backend.readNow(CANVAS);

    expect(await fact("Made-Up Lab Report 2 in Made-Up Biology 1111: 18 out of 20")).toBeDefined();
    expect(await fact("Current grade in Made-Up Biology 1111: 91.2%")).toBeDefined();
    expect((await statusOf()).lastReadProblem).toMatch(/part of Canvas/);
    expect((await statusOf()).needsLogin).toBe(false);
  });

  it("keeps what it had when a course list it can't read would otherwise look like no courses", async () => {
    await connectCanvas();
    const before = (await factsFromCanvas()).length;
    changeSavedPage(backend.browser, COURSES_PAGE, (html) => html.replaceAll("course-list-table-row", "new-row-style"));

    await backend.readNow(CANVAS);

    expect((await factsFromCanvas()).length).toBe(before);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense/);
  });

  it("keeps a course's facts, and says so, when it can't tell whether they're still a student in it", async () => {
    await connectCanvas();
    changeSavedPage(backend.browser, COURSES_PAGE, (html) => html.replaceAll("course-list-enrolled-as-column", "new-role-column"));
    backend.browser.actions.length = 0;

    await backend.readNow(CANVAS);

    expect(await fact("Made-Up Biology 1111: Made-Up Lab Report 3")).toBeDefined();
    expect((await statusOf()).lastReadProblem).toMatch(/part of Canvas/);
    expect(pagesOpened()).toEqual([COURSES_PAGE]);
  });

  it("still gets grades from the assignments list when the grades page can't be understood", async () => {
    changeSavedPage(backend.browser, coursePage("101", "grades"), () => '<div id="grade-summary-react"></div>');

    await connectCanvas();

    expect(await fact("Made-Up Lab Report 2 in Made-Up Biology 1111: 18 out of 20")).toBeDefined();
  });

  it("keeps everything when the course list can't be understood", async () => {
    await connectCanvas();
    const before = (await factsFromCanvas()).length;
    changeSavedPage(backend.browser, COURSES_PAGE, () => "<h1>Something changed</h1>");

    await backend.readNow(CANVAS);

    expect((await factsFromCanvas()).length).toBe(before);
    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense/);
  });

  it("treats a page Canvas sends elsewhere as nothing to read, without opening where it sends it", async () => {
    await connectCanvas();
    backend.browser.savedPages.get(coursePage("101", "grades"))!.finalUrl = `${CANVAS_HOME}/courses/101`;

    await backend.readNow(CANVAS);

    expect(await fact("Current grade in Made-Up Biology 1111: 91.2%")).toBeDefined();
    expect((await statusOf()).lastReadProblem).toBeNull();
  });

  it("leaves a course's facts behind once it's gone from the list", async () => {
    await connectCanvas();
    changeSavedPage(backend.browser, COURSES_PAGE, (html) => html.replace('href="/courses/101"', ""));

    await backend.readNow(CANVAS);

    expect(await fact("Made-Up Biology 1111")).toBeUndefined();
  });

  it("keeps the Student's edits and deletions through later reads", async () => {
    await connectCanvas();
    const edited = (await fact("Course: Made-Up Writing 0802"))!;
    await backend.editFact(edited.id, "My writing class");
    const deleted = (await fact("Course: Made-Up Biology 1111"))!;
    await backend.deleteFact(deleted.id);

    await backend.readNow(CANVAS);

    expect(await fact("My writing class")).toBeDefined();
    expect(await fact("Course: Made-Up Biology 1111")).toBeUndefined();
  });
});

describe("what's new since the last read", () => {
  const events = () => backend.connectionEvents(CANVAS);

  it("makes no events from the first read, when everything looks new", async () => {
    await connectCanvas();

    expect(await events()).toEqual([]);
  });

  it("makes an event for a new assignment, which records that it came from Canvas", async () => {
    await connectCanvas();
    changeSavedPage(backend.browser, coursePage("102", "assignments"), () =>
      `<ul><li class="assignment" id="assignment_600"><a class="ig-title" href="/courses/102/assignments/600">Made-Up Essay</a>
       <div class="assignment-date-due"><time datetime="2026-11-04T04:59:00Z">Nov 3</time></div></li></ul>`,
    );

    await backend.readNow(CANVAS);

    expect(await events()).toEqual([
      expect.objectContaining({
        connection: CANVAS,
        kind: "new_assignment",
        text: "Made-Up Writing 0802: Made-Up Essay",
      }),
    ]);
  });

  it("makes an event for a new grade and a grade change, including the change to the total", async () => {
    await connectCanvas();
    changeSavedPage(backend.browser, coursePage("101", "grades"), (html) =>
      html.replace(/18\.0/g, "12.0").replace(/(\n *)18(\r?\n)/, "$112$2").replace(/91\.2%/g, "84%"),
    );
    changeSavedPage(backend.browser, coursePage("101", "assignments"), (html) => html.replace("<b>18</b>", "<b>12</b>"));

    await backend.readNow(CANVAS);

    expect(await events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "grade_changed",
          text: expect.stringContaining("12 out of 20"),
          data: expect.objectContaining({ from: "18", to: "12" }),
        }),
        expect.objectContaining({ kind: "course_grade_changed", data: expect.objectContaining({ from: "91.2%", to: "84%" }) }),
      ]),
    );
  });

  it("makes an event when a due date moves, and for a new announcement", async () => {
    await connectCanvas();
    changeSavedPage(backend.browser, coursePage("101", "assignments"), (html) =>
      html.replace("2026-11-06T04:59:00Z", "2026-11-09T04:59:00Z"),
    );
    changeSavedPage(backend.browser, coursePage("101", "grades"), (html) => html.replace("Nov 5 by 11:59pm", "Nov 8 by 11:59pm"));
    changeSavedPage(backend.browser, coursePage("102", "announcements"), () =>
      `<div class="ic-announcement-row"><a class="ic-item-row__content-link" href="/courses/102/discussion_topics/950"><h3>Made-Up Class Canceled</h3></a></div>`,
    );

    await backend.readNow(CANVAS);

    const kinds = (await events()).map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(["due_date_changed", "new_announcement"]));
  });

  it("makes no events when nothing changed", async () => {
    await connectCanvas();

    await backend.readNow(CANVAS);

    expect(await events()).toEqual([]);
  });

  it("makes no event for a fact the Student deleted", async () => {
    await connectCanvas();
    await backend.deleteFact((await fact("Made-Up Lab Report 2 in"))!.id);

    await backend.readNow(CANVAS);

    expect(await events()).toEqual([]);
  });

  it("forgets the events about a fact the Student deletes or rewrites, because the Profile is theirs", async () => {
    await connectCanvas();
    changeSavedPage(backend.browser, coursePage("101", "grades"), (html) =>
      html.replace(/18\.0/g, "12.0").replace(/(\n *)18(\r?\n)/, "$112$2").replace(/91\.2%/g, "84%"),
    );
    changeSavedPage(backend.browser, coursePage("101", "assignments"), (html) => html.replace("<b>18</b>", "<b>12</b>"));
    await backend.readNow(CANVAS);
    expect((await events()).map((event) => event.kind)).toEqual(expect.arrayContaining(["grade_changed", "course_grade_changed"]));

    await backend.deleteFact((await fact("Made-Up Lab Report 2 in"))!.id);
    await backend.editFact((await fact("Current grade in"))!.id, "My grade, in my own words");

    expect((await events()).map((event) => event.kind)).toEqual([]);
    backend.claude.willReply(
      { content: [toolUseBlock("check_canvas", { read_again: false })], stopReason: "tool_use" },
      { chunks: ["Okay."] },
    );
    await backend.sendAndCollect("How am I doing?");
    expect(JSON.stringify(backend.claude.requests.at(-1)!.messages)).not.toContain("12 out of 20");
  });

  it("says how many in Activity, without any of the records", async () => {
    await connectCanvas();
    changeSavedPage(backend.browser, coursePage("102", "announcements"), () =>
      `<div class="ic-announcement-row"><a class="ic-item-row__content-link" href="/courses/102/discussion_topics/950"><h3>Made-Up Class Canceled</h3></a></div>`,
    );

    await backend.readNow(CANVAS);

    const [latest] = await backend.activity();
    expect(latest.detail).toContain("1 new announcement");
    expect(JSON.stringify(latest)).not.toContain("Made-Up Class Canceled");
  });
});

describe("when the login has expired", () => {
  it("asks for a Takeover, keeps what it had, and shows it in Activity", async () => {
    await connectCanvas();
    const before = (await factsFromCanvas()).length;
    expireCanvasLogin(backend.browser);
    backend.browser.actions.length = 0;

    await backend.readNow(CANVAS);

    const status = await statusOf();
    expect(status).toMatchObject({ on: true, needsLogin: true });
    expect(status.lastReadProblem).toMatch(/log in to Canvas/i);
    expect(pagesOpened()).toEqual([COURSES_PAGE]);
    expect((await factsFromCanvas()).length).toBe(before);
    expect((await backend.activity())[0]).toMatchObject({
      kind: "connection_read_failed",
      detail: expect.stringMatching(/log in to Canvas/i),
    });
  });

  it("asks straight away when the Student has never logged in", async () => {
    expireCanvasLogin(backend.browser);

    await connectCanvas();

    expect(await statusOf()).toMatchObject({ on: true, needsLogin: true, lastReadAt: null });
  });

  it("asks when Canvas's own login page comes back", async () => {
    await connectCanvas();
    backend.browser.savedPages.get(COURSES_PAGE)!.finalUrl = `${CANVAS_HOME}/login/canvas`;

    await backend.readNow(CANVAS);

    expect((await statusOf()).needsLogin).toBe(true);
  });

  it("stops asking once a read works again, by itself or after a Takeover", async () => {
    await connectCanvas();
    expireCanvasLogin(backend.browser);
    await backend.readNow(CANVAS);
    saveCanvasPages(backend.browser);

    await backend.startTakeover(CANVAS);
    expect((await backend.finishTakeover()).status).toBe(200);
    await backend.untilReadsFinish(CANVAS);

    expect(await statusOf()).toMatchObject({ needsLogin: false, lastReadProblem: null });
    expect((await backend.activity()).some((entry) => entry.detail === "You had just logged in.")).toBe(true);
  });

  it("doesn't read after a Takeover that didn't end in a login", async () => {
    await connectCanvas();
    expireCanvasLogin(backend.browser);
    await backend.readNow(CANVAS);
    backend.browser.savedPages.set(`${CANVAS_HOME}/`, {
      title: "Log in",
      text: "",
      accessibilitySnapshot: "",
      finalUrl: `${CANVAS_HOME}/login/canvas`,
    });
    await backend.startTakeover(CANVAS);
    backend.browser.actions.length = 0;

    const finished = (await (await backend.finishTakeover()).json()) as any;
    await backend.untilReadsFinish(CANVAS);

    expect(finished.signedIn).toBe(false);
    expect(pagesOpened()).toEqual([`${CANVAS_HOME}/`]);
    expect((await statusOf()).needsLogin).toBe(true);
  });
});

describe("while the Student is in control", () => {
  it("reads nothing, and says why", async () => {
    await connectCanvas();
    await backend.startTakeover(CANVAS);
    backend.browser.actions.length = 0;

    await backend.readNow(CANVAS);

    expect(pagesOpened()).toEqual([]);
    expect((await statusOf()).lastReadProblem).toMatch(/You're in control/);
    expect((await statusOf()).needsLogin).toBe(false);
  });
});

describe("the login check at Done", () => {
  it("happens with the Read Permission", async () => {
    await connectCanvas();
    await backend.startTakeover(CANVAS);

    const finished = (await (await backend.finishTakeover()).json()) as any;

    expect(finished).toMatchObject({ siteName: "Canvas", signedIn: true });
  });

  it("doesn't read Canvas if the Read Permission was revoked during the Takeover, and the login goes", async () => {
    await connectCanvas();
    await backend.startTakeover(CANVAS);
    await backend.revokeReadPermission(CANVAS);
    backend.browser.actions.length = 0;

    const finished = (await (await backend.finishTakeover()).json()) as any;

    expect(finished.signedIn).toBe(false);
    expect(pagesOpened()).toEqual([]);
    expect(backend.browser.actions.at(-1)).toEqual({ type: "forget-login", hosts: LOGIN_HOSTS });
  });

  it("is refused directly too, without a Read Permission", async () => {
    await expect(backend.browserAccess.readToCheckLogin(CANVAS)).rejects.toThrow(PageBlocked);
    expect(pagesOpened()).toEqual([]);
  });
});

describe("revoking the Read Permission", () => {
  it("deletes the Canvas facts, the events and the Canvas login", async () => {
    await connectCanvas();
    changeSavedPage(backend.browser, coursePage("102", "announcements"), () =>
      `<div class="ic-announcement-row"><a class="ic-item-row__content-link" href="/courses/102/discussion_topics/950"><h3>Made-Up Class Canceled</h3></a></div>`,
    );
    await backend.readNow(CANVAS);
    expect((await backend.connectionEvents(CANVAS)).length).toBe(1);
    backend.browser.actions.length = 0;

    const response = await backend.revokeReadPermission(CANVAS);

    expect(response.status).toBe(200);
    expect(await factsFromCanvas()).toEqual([]);
    expect(await backend.connectionEvents(CANVAS)).toEqual([]);
    expect(backend.browser.actions).toEqual([
      { type: "clear-screen" },
      { type: "forget-login", hosts: LOGIN_HOSTS },
    ]);
    expect(await statusOf()).toMatchObject({ on: false, loginNotDeletedYet: false });
    expect(backend.storageContains("Made-Up Lab Report")).toBe(false);
    expect(backend.storageContains("Made-Up Class Canceled")).toBe(false);
    const titles = (await backend.activity()).map((entry) => entry.title);
    expect(titles).toEqual(expect.arrayContaining(["You revoked the Read Permission for Canvas", "Buddy deleted your Canvas login"]));
  });

  it("leaves the Student's own facts alone", async () => {
    backend.claude.willReply(
      { content: [toolUseBlock("remember", { fact: "Commutes from Made-Up Town" })], stopReason: "tool_use" },
      { chunks: ["Noted."] },
    );
    await backend.sendAndCollect("I commute from Made-Up Town.");
    await connectCanvas();

    await backend.revokeReadPermission(CANVAS);

    expect((await backend.profileFacts()).map((remembered) => remembered.text)).toEqual(["Commutes from Made-Up Town"]);
  });

  it("stops everything: no more reads, and no way back in without a new Read Permission", async () => {
    await connectCanvas();
    await backend.revokeReadPermission(CANVAS);
    backend.browser.actions.length = 0;

    await backend.readDueConnections();

    expect(pagesOpened()).toEqual([]);
    await expect(backend.browserAccess.read(COURSES_PAGE)).rejects.toThrow(PageBlocked);
    expect((await backend.startTakeover(CANVAS)).status).toBe(403);
  });

  it("keeps trying to delete the login when the browser can't be reached", async () => {
    await connectCanvas();
    backend.browser.unreachable = true;

    const response = await backend.revokeReadPermission(CANVAS);

    expect(response.status).toBe(200);
    expect(await factsFromCanvas()).toEqual([]);
    expect(await statusOf()).toMatchObject({ on: false, loginNotDeletedYet: true });
    expect((await backend.activity()).map((entry) => entry.title)).toContain("Buddy couldn't delete your Canvas login yet");

    await backend.readDueConnections();
    expect(await statusOf()).toMatchObject({ loginNotDeletedYet: true });

    backend.browser.unreachable = false;
    await backend.readDueConnections();

    expect(await statusOf()).toMatchObject({ loginNotDeletedYet: false });
    expect(backend.browser.actions.at(-1)).toEqual({ type: "forget-login", hosts: LOGIN_HOSTS });
  });

  it("remembers that across a restart", async () => {
    await connectCanvas();
    backend.browser.unreachable = true;
    await backend.revokeReadPermission(CANVAS);

    await backend.restart();
    backend.browser.unreachable = false;
    await backend.readDueConnections();

    expect(backend.browser.actions.at(-1)).toEqual({ type: "forget-login", hosts: LOGIN_HOSTS });
    expect(await statusOf()).toMatchObject({ loginNotDeletedYet: false });
  });

  it("won't let an old login carry on when the Student connects again before it could be deleted", async () => {
    await connectCanvas();
    backend.browser.unreachable = true;
    await backend.revokeReadPermission(CANVAS);
    backend.browser.unreachable = false;
    backend.browser.actions.length = 0;

    await connectCanvas();

    const types = backend.browser.actions.map((action) => action.type);
    expect(types.indexOf("forget-login")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("forget-login")).toBeLessThan(types.indexOf("read"));
    expect(pagesOpened()[0]).toBe(COURSES_PAGE);
  });
});
