import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanPath, readStudentState, runCanvasCheck, structureOf } from "../src/canvas-check.ts";
import { canvas } from "../src/canvas.ts";
import { settings } from "../src/settings.ts";
import { THE_STUDENT, openStore } from "../src/store.ts";
import { canvasPage, CANVAS_HOME, coursePage, COURSES_PAGE, expireCanvasLogin, saveCanvasPages, savedCanvasHtml } from "./support/canvas-pages.ts";
import { RecordingBrowser } from "./support/recording-browser.ts";

/** Everything here is made up. Any of these reaching the output is a leak. */
const MARKERS = {
  course: "MARKERCOURSENAME",
  assignment: "MARKERASSIGNMENT",
  grade: "MARKERGRADE",
  announcement: "MARKERANNOUNCEMENT",
  student: "MARKERSTUDENTNAME",
  classmate: "MARKERCLASSMATE",
  title: "MARKERPAGETITLE",
  attribute: "MARKERATTRIBUTE",
  script: "MARKERSCRIPT",
  comment: "MARKERCOMMENT",
  query: "MARKERQUERY",
  slug: "markerslug",
  error: "MARKERERROR",
  richClass: "MARKERRICHCLASS",
  richData: "markerrichdata",
  textClass: "MARKERTEXTCLASS",
  host: "markerhostname",
  role: "markerrole",
  id: "MARKERID",
  style: "MARKERSTYLE",
  rawDigits: "867530912",
};

/** A page with no recognizable content, carrying a marker in each place a page can carry words. */
const LEAKY_HTML = `<!doctype html>
<html lang="${MARKERS.attribute}">
<head>
  <title>${MARKERS.title}</title>
  <meta name="description" content="${MARKERS.attribute}">
  <script>window.ENV = {name: "${MARKERS.script}", grade: "${MARKERS.grade}"};</script>
  <style>.x::after { content: "${MARKERS.style}"; }</style>
</head>
<body class="ic-app" data-student="${MARKERS.student}">
  <!-- ${MARKERS.comment} -->
  <div id="${MARKERS.id}" class="real-class" role="${MARKERS.role}" title="${MARKERS.attribute}" aria-label="${MARKERS.course}"
       data-course-name="${MARKERS.course}" data-grade="${MARKERS.grade}" style="content:'${MARKERS.style}'">
    <h1 class="heading">${MARKERS.course}</h1>
    <a href="/courses/101/assignments/501?secret=${MARKERS.query}" class="link" data-tooltip="${MARKERS.assignment}">${MARKERS.assignment}</a>
    <img src="/pictures/${MARKERS.student}.png" alt="${MARKERS.student}" class="avatar">
    <input value="${MARKERS.grade}" placeholder="${MARKERS.classmate}" name="${MARKERS.attribute}" class="field">
    <span class="grade">${MARKERS.grade}</span>
    <svg class="chart"><title>${MARKERS.grade}</title><text>${MARKERS.grade}</text></svg>
    <template><div class="${MARKERS.attribute}">${MARKERS.attribute}</div></template>
    <noscript>${MARKERS.announcement}</noscript>
    <iframe src="/frame?who=${MARKERS.student}" srcdoc="${MARKERS.student}" class="frame"></iframe>
    <div class="user_content enhanced">
      <p class="${MARKERS.richClass}" data-${MARKERS.richData}="1">${MARKERS.announcement}</p>
      <div class="made-up rich ${MARKERS.richClass}">${MARKERS.classmate}</div>
    </div>
    <div class="ic-announcement-row__content user_content">${MARKERS.announcement}</div>
    <div class="${MARKERS.textClass}">words mentioning ${MARKERS.textClass} too</div>
    <div class="MARKERCOURSE name with spaces split ${MARKERS.course}"></div>
    <table class="ic-Table"><tr data-assignment-${MARKERS.rawDigits}="yes"><td class="submission_${MARKERS.rawDigits}">${MARKERS.grade}</td></tr></table>
  </div>
</body>
</html>`;

const browserWithAllPages = (): RecordingBrowser => {
  const browser = new RecordingBrowser();
  saveCanvasPages(browser);
  return browser;
};

async function check(browser: RecordingBrowser, more: Partial<Parameters<typeof runCanvasCheck>[0]> = {}) {
  const lines: string[] = [];
  const exitCode = await runCanvasCheck({
    browser,
    connection: canvas,
    sites: settings.sites,
    student: () => ({ hasReadPermission: true, takeoverUnderWay: false }),
    print: (line) => lines.push(line),
    ...more,
  });
  return { exitCode, output: lines.join("\n"), lines };
}

function expectNoMarkers(output: string): void {
  for (const [name, marker] of Object.entries(MARKERS)) {
    expect(output.toLowerCase().includes(marker.toLowerCase()), `the ${name} marker leaked`).toBe(false);
  }
  expect(output).not.toMatch(/marker/i);
}

describe("what the check prints", () => {
  it("gives the counts per kind, from the real reader", async () => {
    const { output, exitCode } = await check(browserWithAllPages());

    expect(exitCode).toBe(0);
    expect(output).toMatch(/courses: 3\b/);
    expect(output).toMatch(/assignments: 6\b/);
    expect(output).toMatch(/due dates: 5\b/);
    expect(output).toMatch(/grades: 2\b/);
    expect(output).toMatch(/announcements: 2\b/);
  });

  it("lists each page opened, with ids replaced", async () => {
    const { output } = await check(browserWithAllPages());

    expect(output).toContain("/courses\n");
    expect(output).toMatch(/\/courses\/:id\/assignments +×2/);
    expect(output).toMatch(/\/courses\/:id\/grades +×2/);
    expect(output).toMatch(/\/courses\/:id\/announcements +×2/);
    expect(output).not.toMatch(/\/courses\/10[123]/);
  });

  it("lists each thing the guard refused, with its host, method and cleaned path", async () => {
    const browser = browserWithAllPages();
    browser.savedPages.set(COURSES_PAGE, {
      ...browser.savedPages.get(COURSES_PAGE)!,
      alsoRequests: [
        { url: `${CANVAS_HOME}/api/graphql`, method: "POST" },
        { url: `${CANVAS_HOME}/api/graphql`, method: "POST" },
        { url: `${CANVAS_HOME}/courses/101/quizzes/30/take?secret=${MARKERS.query}`, method: "GET" },
        { url: "https://events.example.test/collect", method: "POST" },
        { url: `${CANVAS_HOME}/api/v1/courses/101/assignment_groups`, method: "GET" },
      ],
    });

    const { output } = await check(browser);

    expect(output).toMatch(/POST templeu\.instructure\.com \/api\/graphql +×2/);
    expect(output).toContain("GET templeu.instructure.com /courses/:id/quizzes/:id/take");
    expect(output).toContain("POST events.example.test /:text");
    expect(output).not.toContain("assignment_groups");
  });

  it("names a host an open page uses, even though its address is on the page and its name is an ordinary word", async () => {
    const browser = browserWithAllPages();
    browser.savedPages.set(
      COURSES_PAGE,
      canvasPage(
        savedCanvasHtml("courses").replace(
          "</head>",
          '<script src="https://cloudfront.example.test/app.js"></script></head>',
        ).replace("All Courses", "All Courses and upcoming events"),
        {
          alsoRequests: [
            { url: "https://cloudfront.example.test/collect", method: "POST" },
            { url: "https://events.example.test/collect", method: "POST" },
          ],
        },
      ),
    );

    const { output } = await check(browser);

    expect(output).toContain("POST cloudfront.example.test /:text");
    expect(output).toContain("POST events.example.test /:text");
  });

  it("gives a page's structure when the reader finds nothing there, and only then", async () => {
    const browser = browserWithAllPages();
    browser.savedPages.set(coursePage("101", "grades"), canvasPage(LEAKY_HTML));

    const { output } = await check(browser);

    const summary = output.slice(output.indexOf("Structure"));
    expect(summary).toContain("/courses/:id/grades");
    expect(summary).toContain("the reader couldn't recognize this page");
    expect(summary).toContain("div.real-class");
    expect(summary).toContain("span.grade");
    expect(summary).toContain("data-course-name");
    // The second course's empty lists are real pages with nothing on them.
    expect(summary).toContain("/courses/:id/announcements");
    expect(summary).not.toContain("<");
  });

  it("uses a throwaway database, leaving nothing behind", async () => {
    const { output } = await check(browserWithAllPages());

    expect(output).toContain("nothing was saved");
  });

  it("never touches the login or anything else that changes the browser", async () => {
    const browser = browserWithAllPages();

    await check(browser);

    expect(browser.actions.every((action) => action.type === "read")).toBe(true);
  });
});

describe("what the check can't leak", () => {
  it("keeps every marker out of a course list that can't be recognized", async () => {
    const browser = browserWithAllPages();
    browser.savedPages.set(COURSES_PAGE, canvasPage(LEAKY_HTML));

    const { output, exitCode } = await check(browser);

    expect(exitCode).toBe(0);
    expect(output).toMatch(/Problem:/);
    expect(output).toContain("/courses");
    expect(output).toContain("the reader couldn't recognize this page");
    expectNoMarkers(output);
  });

  it("keeps every marker out, when the reader finds things", async () => {
    const browser = new RecordingBrowser();
    const swap = (html: string) =>
      html
        .replaceAll("Made-Up Biology 1111", MARKERS.course)
        .replaceAll("Made-Up Lab Report 3", MARKERS.assignment)
        .replaceAll("Made-Up Lab Report 2", MARKERS.assignment)
        .replaceAll("91.2%", MARKERS.grade)
        .replaceAll("Made-Up Lab Moved To Beury 160", MARKERS.announcement)
        .replaceAll("Made Up Student", MARKERS.student)
        .replaceAll("Made Up Professor", MARKERS.classmate);
    browser.savedPages.set(COURSES_PAGE, canvasPage(swap(savedCanvasHtml("courses"))));
    browser.savedPages.set(coursePage("101", "assignments"), canvasPage(swap(savedCanvasHtml("assignments"))));
    browser.savedPages.set(coursePage("101", "grades"), canvasPage(swap(savedCanvasHtml("grades"))));
    browser.savedPages.set(coursePage("101", "announcements"), canvasPage(swap(savedCanvasHtml("announcements"))));
    for (const page of ["assignments", "grades", "announcements"]) {
      browser.savedPages.set(coursePage("102", page), canvasPage(LEAKY_HTML));
    }

    const { output, exitCode } = await check(browser);

    expect(exitCode).toBe(0);
    expect(output).toMatch(/courses: 3\b/);
    expectNoMarkers(output);
  });

  it("keeps every marker out of the structure of a page where it found nothing", async () => {
    const browser = browserWithAllPages();
    for (const url of [...browser.savedPages.keys()]) {
      browser.savedPages.set(url, canvasPage(LEAKY_HTML, { title: MARKERS.title, text: MARKERS.grade, accessibilitySnapshot: MARKERS.grade }));
    }

    const { output } = await check(browser);

    expect(output).toContain("div.real-class");
    expectNoMarkers(output);
  });

  it("keeps markers out of addresses, whether opened, redirected to or refused", async () => {
    const browser = browserWithAllPages();
    const refused = [
      `${CANVAS_HOME}/courses/101/pages/${MARKERS.slug}?q=${MARKERS.query}`,
      `${CANVAS_HOME}/courses/101/quizzes/30/${MARKERS.slug}`,
      `${CANVAS_HOME}/courses/101/users/${MARKERS.rawDigits}?name=${MARKERS.student}`,
      `https://cdn.${MARKERS.host}.example.test/${MARKERS.slug}/${encodeURIComponent(MARKERS.student)}`,
    ];
    browser.savedPages.set(
      COURSES_PAGE,
      canvasPage(savedCanvasHtml("courses").replace("All Courses", `All Courses ${MARKERS.host}`), {
        alsoRequests: refused.map((url) => ({ url, method: "POST" })),
      }),
    );
    browser.savedPages.get(coursePage("101", "grades"))!.finalUrl =
      `${CANVAS_HOME}/courses/101/grades/${MARKERS.slug}?who=${MARKERS.student}#${MARKERS.query}`;

    const { output } = await check(browser);

    expect(output).toContain(":text");
    expect(output).toContain("Refused");
    expectNoMarkers(output);
  });

  it("keeps markers out when the browser fails, whatever its error says", async () => {
    const browser = browserWithAllPages();
    const original = browser.read.bind(browser);
    browser.read = async (url, guard) => {
      if (url.endsWith("/grades")) throw new Error(`Timed out on ${url}?who=${MARKERS.error} ${MARKERS.grade}`);
      return original(url, guard);
    };

    const { output } = await check(browser);

    expect(output).toContain("/courses/:id/grades");
    expectNoMarkers(output);
  });

  it("keeps markers out even when something unexpected goes wrong in the check itself", async () => {
    const { output, exitCode } = await check(browserWithAllPages(), {
      student: () => {
        throw new TypeError(`Unexpected ${MARKERS.error}`);
      },
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("TypeError");
    expectNoMarkers(output);
  });

  it("keeps markers out of an expired login's output", async () => {
    const browser = browserWithAllPages();
    expireCanvasLogin(browser);
    const page = browser.savedPages.get(COURSES_PAGE)!;
    browser.savedPages.set(COURSES_PAGE, {
      ...page,
      finalUrl: `https://fim.temple.edu/idp/${MARKERS.slug}?user=${MARKERS.student}`,
      html: LEAKY_HTML,
    });

    const { output, exitCode } = await check(browser);

    expect(exitCode).toBe(4);
    expect(output).toMatch(/log in/i);
    expect(output).toContain("fim.temple.edu");
    expectNoMarkers(output);
  });
});

describe("the structure summary", () => {
  it("shows tags, roles, classes, data- names and the ids the reader looks for", () => {
    const summary = structureOf(
      `<body><table id="grades_summary" class="ic-Table"><tr class="student_assignment" data-muted="true" role="row"><td>x</td></tr></table></body>`,
    ).join("\n");

    expect(summary).toContain("table#grades_summary.ic-Table");
    expect(summary).toContain('tr.student_assignment role=row [data-muted]');
    expect(summary).toContain("td");
    expect(summary).not.toContain("true");
    expect(summary).not.toContain("x");
  });

  it("replaces numbers in a name, so that an id can't get through", () => {
    const summary = structureOf(`<body><div class="submission_123 css-4f5a6b-view" data-item-99="x"></div></body>`).join("\n");

    expect(summary).toContain("submission_:id");
    expect(summary).toContain("css-:idf:ida:idb-view");
    expect(summary).toContain("data-item-:id");
    expect(summary).not.toMatch(/\d/);
  });

  it("doesn't look inside what a teacher wrote", () => {
    const summary = structureOf(`<body><div class="user_content"><p class="made-up-rich">words</p></div></body>`).join("\n");

    expect(summary).toContain("div.user_content (not looked inside)");
    expect(summary).not.toContain("made-up-rich");
  });

  it("drops a name that's also words on the page", () => {
    const summary = structureOf(`<body><p>Made Up Biology Course</p><div class="made-up-biology-course keep"></div></body>`).join("\n");

    expect(summary).not.toContain("biology");
    expect(summary).toContain("div.keep");
  });

  it("gives a role only from the list of real roles", () => {
    const summary = structureOf(`<body><div role="row"></div><div role="anything else"></div></body>`).join("\n");

    expect(summary).toContain("div role=row");
    expect(summary).toContain("div role=:other");
    expect(summary).not.toContain("anything");
  });

  it("folds repeated rows into one line and keeps to a limit", () => {
    const rows = '<tr class="row"><td class="cell"></td></tr>'.repeat(50);
    const summary = structureOf(`<body><table><tbody>${rows}</tbody></table></body>`);

    expect(summary.filter((line) => line.includes("tr.row"))).toEqual([expect.stringContaining("×50")]);

    const many = Array.from({ length: 2000 }, (_, index) => `<div class="k${"a".repeat(index % 40)}"><span class="s${"b".repeat(index % 37)}"></span></div>`).join("");
    expect(structureOf(`<body>${many}</body>`).length).toBeLessThanOrEqual(401);
  });
});

describe("cleaning an address", () => {
  it.each([
    ["https://templeu.instructure.com/courses/101/grades", "/courses/:id/grades"],
    ["https://templeu.instructure.com/courses/101/assignments?include=x#y", "/courses/:id/assignments"],
    ["https://templeu.instructure.com/api/v1/courses/101/discussion_topics/9/view", "/api/v1/courses/:id/discussion_topics/:id/view"],
    ["https://templeu.instructure.com/courses/101/pages/my-study-notes", "/courses/:id/pages/:text"],
    ["https://templeu.instructure.com/courses/1~2/users", "/courses/:id/users"],
    ["https://templeu.instructure.com/courses/sis_course_id:ABC/users", "/courses/:text/users"],
    ["https://cdn.example.test/dist/webpack-prod/main-abc123.js", "/dist/:text/:id.js"],
    ["https://templeu.instructure.com/", "/"],
    ["not an address", ":text"],
  ])("%s", (address, cleaned) => {
    expect(cleanPath(address)).toBe(cleaned);
  });
});

describe("when the Student isn't ready", () => {
  it("opens nothing without a Read Permission, and says what to do", async () => {
    const browser = browserWithAllPages();

    const { output, exitCode } = await check(browser, {
      student: () => ({ hasReadPermission: false, takeoverUnderWay: false }),
    });

    expect(exitCode).toBe(2);
    expect(output).toMatch(/Read Permission/);
    expect(output).toMatch(/Give Read Permission/);
    expect(browser.actions).toEqual([]);
  });

  it("opens nothing while the Student is in control of the browser", async () => {
    const browser = browserWithAllPages();

    const { output, exitCode } = await check(browser, {
      student: () => ({ hasReadPermission: true, takeoverUnderWay: true }),
    });

    expect(exitCode).toBe(3);
    expect(output).toMatch(/Takeover/);
    expect(browser.actions).toEqual([]);
  });

  it("stops opening pages if the Student takes control partway through", async () => {
    const browser = browserWithAllPages();
    let asked = 0;

    const { output } = await check(browser, {
      student: () => ({ hasReadPermission: true, takeoverUnderWay: ++asked > 2 }),
    });

    expect(browser.actions.length).toBeLessThanOrEqual(1);
    expect(output).toMatch(/in control/i);
  });

  it("says plainly when the login has expired", async () => {
    const browser = browserWithAllPages();
    expireCanvasLogin(browser);

    const { output, exitCode, lines } = await check(browser);

    expect(exitCode).toBe(4);
    expect(lines.some((line) => /Login: .*Takeover/.test(line))).toBe(true);
    expect(output).toMatch(/courses: 0\b/);
    expect(output).not.toContain("Structure");
  });
});

describe("reading the Student's state from the real database", () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "buddy-check-"));
    path = join(directory, "buddy.sqlite");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const newEntry = { kind: "x", title: "x", at: new Date("2026-11-02T14:00:00Z") };

  it("finds no Read Permission in a database that isn't there, and creates nothing", () => {
    expect(readStudentState(path, canvas.id)).toEqual({ hasReadPermission: false, takeoverUnderWay: false });
    expect(() => readFileSync(path)).toThrow();
  });

  it("finds nothing in a database with no Read Permission", () => {
    openStore(path).close();

    expect(readStudentState(path, canvas.id)).toEqual({ hasReadPermission: false, takeoverUnderWay: false });
  });

  it("finds the Student's tap, without changing the file, while the backend has it open", () => {
    const store = openStore(path);
    store.giveReadPermission(THE_STUDENT, canvas.id, { address: null, givenAt: newEntry.at }, newEntry);
    store.beginTakeover(THE_STUDENT, { site: canvas.id, liveViewToken: "made-up", startedAt: newEntry.at });

    expect(readStudentState(path, canvas.id)).toEqual({ hasReadPermission: true, takeoverUnderWay: true });

    store.close();
    const before = readFileSync(path);
    expect(readStudentState(path, canvas.id)).toEqual({ hasReadPermission: true, takeoverUnderWay: true });
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("doesn't count another Connection's Read Permission", () => {
    const store = openStore(path);
    store.giveReadPermission(THE_STUDENT, "google-calendar", { address: null, givenAt: newEntry.at }, newEntry);
    store.close();

    expect(readStudentState(path, canvas.id).hasReadPermission).toBe(false);
  });
});
