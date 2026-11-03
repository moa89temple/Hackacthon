import { beforeEach, describe, expect, it } from "vitest";
import { EXIT_LOGIN_NEEDED, EXIT_NO_READ_PERMISSION, EXIT_OK, EXIT_OLD_LOGIN_REMAINS, EXIT_TAKEOVER_UNDER_WAY } from "../src/canvas-check.ts";
import { handshake } from "../src/handshake.ts";
import { runHandshakeCheck } from "../src/handshake-check.ts";
import { EXIT_READ_PROBLEM } from "../src/navigate360-check.ts";
import { settings } from "../src/settings.ts";
import { EVENTS_LIST, eventPage, expireHandshakeLogin, FAIR, INTERNSHIP, JOBS_LIST, jobPage, saveHandshakePages } from "./support/handshake-pages.ts";
import { RecordingBrowser } from "./support/recording-browser.ts";

/** Everything here is made up. Any of these reaching the output is a leak. */
const MARKERS = {
  student: "MARKERSTUDENT",
  employer: "markeremployer",
  title: "MARKERTITLE",
  text: "MARKERTEXT",
  html: "MARKERHTML",
  ariaName: "MARKERARIANAME",
  query: "MARKERQUERY",
  slug: "markerslug",
  body: "MARKERBODY",
  host: "markerhostname",
  className: "MARKERCLASS",
};

const LEAKY_SNAPSHOT = `- main:
  - heading "${MARKERS.ariaName}" [level=1]
  - link "${MARKERS.student}":
    - /url: /stu/users/${MARKERS.student}
  - paragraph: ${MARKERS.text}`;

function leakyHtml(links: string): string {
  return `<html><head><title>${MARKERS.title}</title></head><body>
    <header>${MARKERS.student}</header>
    <main class="ok ${MARKERS.text}" title="${MARKERS.html}"><h1>${MARKERS.html}</h1><p>${MARKERS.text} ${MARKERS.employer} ${MARKERS.slug}</p>${links}
      <a href="/e/${MARKERS.employer}?who=${MARKERS.query}">${MARKERS.employer}</a>
      <a href="/stu/jobs/${MARKERS.slug}">${MARKERS.slug}</a>
      <a href="mailto:${MARKERS.student}@temple.edu">${MARKERS.student}</a>
      <p>${"Enough words to count as a listing. ".repeat(3)}</p>
    </main></body></html>`;
}

let browser: RecordingBrowser;
let lines: string[];
let student: { hasReadPermission: boolean; takeoverUnderWay: boolean; oldLoginRemains: boolean };

beforeEach(() => {
  browser = new RecordingBrowser();
  lines = [];
  student = { hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: false };
  saveHandshakePages(browser);
});

const check = () =>
  runHandshakeCheck({
    browser,
    connection: handshake,
    sites: { handshake: settings.sites.handshake },
    student: () => student,
    print: (line) => lines.push(line),
  });
const output = () => lines.join("\n");
const pagesOpened = () => browser.actions.filter((action) => action.type === "read").map((action: any) => action.url);

function makePagesLeaky(): void {
  const lists = [`<a href="/stu/jobs/${INTERNSHIP.id}">${MARKERS.title}</a>`, `<a href="/stu/events/${FAIR.id}">${MARKERS.title}</a>`];
  const pages: [string, string][] = [
    [JOBS_LIST, lists[0]!],
    [EVENTS_LIST, lists[1]!],
    [jobPage(INTERNSHIP.id), ""],
    [eventPage(FAIR.id), ""],
  ];
  for (const [url, links] of pages) {
    browser.savedPages.set(url, {
      ...browser.savedPages.get(url)!,
      title: MARKERS.title,
      text: `${MARKERS.text} ${MARKERS.employer} ${MARKERS.slug}`,
      accessibilitySnapshot: LEAKY_SNAPSHOT,
      html: leakyHtml(links),
      alsoRequests: [
        { url: `https://app.joinhandshake.com/stu/users/${MARKERS.student}?q=${MARKERS.query}`, method: "GET" },
        { url: "https://app.joinhandshake.com/hs/graphql", method: "POST", body: `{"operationName":"${MARKERS.body}"}`, contentType: "application/json" },
        { url: `https://${MARKERS.host}.${MARKERS.employer}.test/x`, method: "POST" },
      ],
    });
  }
}

function expectNoLeak(): void {
  for (const marker of Object.values(MARKERS)) {
    expect(output().toLowerCase()).not.toContain(marker.toLowerCase());
  }
}

describe("before it opens anything", () => {
  it.each([
    ["there's no Read Permission", { hasReadPermission: false }, EXIT_NO_READ_PERMISSION, /no Read Permission/],
    ["the Student is in control", { takeoverUnderWay: true }, EXIT_TAKEOVER_UNDER_WAY, /Takeover/],
    ["an old login still has to go", { oldLoginRemains: true }, EXIT_OLD_LOGIN_REMAINS, /old login/],
  ])("stops when %s", async (_, state, exitCode, words) => {
    Object.assign(student, state);

    expect(await check()).toBe(exitCode);

    expect(pagesOpened()).toEqual([]);
    expect(output()).toMatch(words);
  });
});

describe("against a working login", () => {
  it("says what it found, in counts", async () => {
    expect(await check()).toBe(EXIT_OK);

    expect(output()).toMatch(/Login: works/);
    expect(output()).toMatch(/jobs listed: 1/);
    expect(output()).toMatch(/events listed: 1/);
    expect(output()).toMatch(/listings opened as a sample: 2/);
    expect(output()).toMatch(/of those, read as a listing: 2/);
  });

  it("says where each page ended up, and how many links of each shape the lists have", async () => {
    await check();

    expect(output()).toMatch(/\/stu\/postings {2}\(ended up at app\.joinhandshake\.com \/stu\/postings\)/);
    expect(output()).toMatch(/\/stu\/jobs\/:id/);
    expect(output()).toMatch(/\/stu\/events\/:id/);
  });

  it("opens only a few listings, because it's only looking at their shape", async () => {
    const jobs = Array.from({ length: 10 }, (_, index) => ({ ...INTERNSHIP, id: index + 1 }));
    saveHandshakePages(browser, { jobs });

    await check();

    expect(pagesOpened().filter((url) => url.includes("/stu/jobs/"))).toHaveLength(2);
  });

  it("shows a refused POST, which is what would stop a page that needs one from drawing", async () => {
    makePagesLeaky();

    await check();

    const refused = output().slice(output().indexOf("Refused by the guard:"));
    expect(refused).toMatch(/POST app\.joinhandshake\.com \/hs\/graphql/);
  });

  it("shows the shape of each kind of page, whatever came of it", async () => {
    makePagesLeaky();

    await check();

    expect(output()).toMatch(/Shape of a list: \/stu\/postings/);
    expect(output()).toMatch(/Shape of a listing: \/stu\/jobs\/:id/);
    expect(output()).toMatch(/heading/);
    expect(output()).toMatch(/main/);
  });

  it("never prints what a page said, or who the Student is", async () => {
    makePagesLeaky();

    await check();

    expectNoLeak();
  });

  it("says it sends nothing to Claude and saves nothing", async () => {
    await check();

    expect(output()).toMatch(/nothing was saved/);
    expect(output()).toMatch(/nothing went to Claude/);
  });
});

describe("when the reader doesn't get what it came for", () => {
  it("says the Student must log in, and shows why", async () => {
    expireHandshakeLogin(browser);

    expect(await check()).toBe(EXIT_LOGIN_NEEDED);

    expect(output()).toMatch(/not logged in/);
    expect(output()).toMatch(/Log in to Handshake/);
    expect(output()).toMatch(/ended up at temple\.joinhandshake\.com \/login/);
  });

  it("says which part it missed, and still shows the shape to correct the reader by", async () => {
    browser.savedPages.set(EVENTS_LIST, { title: "Handshake", text: "", accessibilitySnapshot: "- main", html: "<main class='new'>Something new</main>" });

    expect(await check()).toBe(EXIT_READ_PROBLEM);

    expect(output()).toMatch(/events listed: couldn't tell/);
    expect(output()).toMatch(/Problem: Buddy couldn't read part of Handshake/);
    expect(output()).toMatch(/Shape of a list: \/stu\/events/);
  });

  it("says a listing wasn't understood", async () => {
    browser.savedPages.set(jobPage(INTERNSHIP.id), { title: "Handshake", text: "", accessibilitySnapshot: "", html: "<div class='no-main'></div>" });

    expect(await check()).toBe(EXIT_READ_PROBLEM);

    expect(output()).toMatch(/of those, read as a listing: 1/);
  });

  it("stops if the Read Permission goes during the check", async () => {
    let looks = 0;
    const state = () => {
      looks++;
      return { ...student, hasReadPermission: looks < 3 };
    };

    const exitCode = await runHandshakeCheck({ browser, connection: handshake, sites: { handshake: settings.sites.handshake }, student: state, print: (line) => lines.push(line) });

    expect(exitCode).toBe(EXIT_NO_READ_PERMISSION);
    expect(output()).toMatch(/revoked during the check/);
  });
});
