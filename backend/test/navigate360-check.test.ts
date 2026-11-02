import { beforeEach, describe, expect, it } from "vitest";
import { EXIT_LOGIN_NEEDED, EXIT_NO_READ_PERMISSION, EXIT_OK, EXIT_OLD_LOGIN_REMAINS, EXIT_TAKEOVER_UNDER_WAY } from "../src/canvas-check.ts";
import { navigate360 } from "../src/navigate360.ts";
import { cleanAddress, runNavigate360Check, shapeOfAccessibility, shapeOfAnswer } from "../src/navigate360-check.ts";
import { settings } from "../src/settings.ts";
import {
  appointmentsAnswer,
  expireNavigate360Login,
  HOME_PAGE,
  LANDING_PAGE,
  person,
  saveNavigate360Pages,
  saveNavigate360PagesWithoutAnswers,
  TEAM_PAGE,
  teamAnswer,
} from "./support/navigate360-pages.ts";
import { RecordingBrowser } from "./support/recording-browser.ts";

/** Everything here is made up. Any of these reaching the output is a leak. */
const MARKERS = {
  advisor: "MARKERADVISOR",
  surname: "MARKERSURNAME",
  email: "markeremail",
  phone: "2155550199",
  role: "MARKERROLE",
  place: "MARKERPLACE",
  what: "MARKERVISIT",
  attendee: "MARKERATTENDEE",
  comment: "MARKERCOMMENT",
  key: "MARKERKEYNAME",
  slug: "markerslug",
  title: "MARKERTITLE",
  ariaName: "MARKERARIANAME",
  ariaUrl: "markerarialink",
  text: "MARKERTEXT",
  html: "MARKERHTML",
  query: "MARKERQUERY",
  error: "MARKERERROR",
  host: "markerhostname",
  unread: "MARKERUNREADABLE",
};

const LEAKY_TEAM = teamAnswer(
  person({
    first_name: MARKERS.advisor,
    last_name: MARKERS.surname,
    email: `${MARKERS.email}@temple.edu`,
    work_phone: MARKERS.phone,
    relationship: `${MARKERS.role} Advisor`,
    [MARKERS.key]: MARKERS.key,
  }),
);
const LEAKY_APPOINTMENTS = appointmentsAnswer({
  id: 9,
  start: "2099-01-01T15:00:00Z",
  name: MARKERS.what,
  location: { name: MARKERS.place },
  attendees: [{ name: MARKERS.attendee }],
  staff_comment: MARKERS.comment,
});
const LEAKY_SNAPSHOT = `- main:
  - heading "${MARKERS.ariaName}" [level=1]
  - link "${MARKERS.advisor} ${MARKERS.surname}":
    - /url: mailto:${MARKERS.email}@temple.edu
  - text: ${MARKERS.text}
  - paragraph: ${MARKERS.text}
  - ${MARKERS.key} "${MARKERS.ariaName}"`;
const LEAKY_HTML = `<body><main id="${MARKERS.key}" class="suh-content" title="${MARKERS.html}"><h1>${MARKERS.html}</h1><a href="mailto:${MARKERS.email}@temple.edu">${MARKERS.advisor}</a></main></body>`;

let browser: RecordingBrowser;
let lines: string[];
let student: { hasReadPermission: boolean; takeoverUnderWay: boolean; oldLoginRemains: boolean };

beforeEach(() => {
  browser = new RecordingBrowser();
  lines = [];
  student = { hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: false };
  saveNavigate360Pages(browser, { team: LEAKY_TEAM, appointments: LEAKY_APPOINTMENTS });
});

const check = () =>
  runNavigate360Check({
    browser,
    connection: navigate360,
    sites: { navigate360: settings.sites.navigate360 },
    student: () => student,
    print: (line) => lines.push(line),
  });
const output = () => lines.join("\n");
const pagesOpened = () => browser.actions.filter((action) => action.type === "read").length;

function expectNoLeak(): void {
  for (const marker of Object.values(MARKERS)) {
    expect(output().toLowerCase()).not.toContain(marker.toLowerCase());
  }
}

function addLeakyDetails(): void {
  for (const url of [LANDING_PAGE, HOME_PAGE, TEAM_PAGE]) {
    const page = browser.savedPages.get(url)!;
    browser.savedPages.set(url, {
      ...page,
      title: MARKERS.title,
      text: MARKERS.text,
      accessibilitySnapshot: LEAKY_SNAPSHOT,
      html: LEAKY_HTML,
      alsoRequests: [
        { url: `https://temple.navigate.eab.com/api/v1/core/appconfig/?who=${MARKERS.query}`, method: "GET" },
        { url: `https://temple.navigate.eab.com/api/students/8675309/${MARKERS.advisor.toLowerCase()}`, method: "GET" },
        { url: `https://temple.campus.eab.com/api/students/${MARKERS.slug}/support_team`, method: "GET" },
        { url: `https://${MARKERS.host}.${MARKERS.ariaName.toLowerCase()}.test/x`, method: "POST" },
        { url: "https://temple.navigate.eab.com/api/v1/some_write/", method: "POST" },
      ],
    });
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

    expect(pagesOpened()).toBe(0);
    expect(output()).toMatch(words);
  });
});

describe("with a login that works", () => {
  it("says what it found, in numbers", async () => {
    expect(await check()).toBe(EXIT_OK);

    expect(output()).toMatch(/Login: works/);
    expect(output()).toMatch(/App version: v2/);
    expect(output()).toMatch(/advisors: 1/);
    expect(output()).toMatch(/advisors with an address: 1/);
    expect(output()).toMatch(/Contacts added: 1/);
    expect(output()).toMatch(/upcoming appointments: 1/);
    expect(output()).toMatch(/advisors left out, with a name or address Buddy can't use: 0/);
  });

  it("says which pages it opened, and what those pages asked for, cleaned", async () => {
    addLeakyDetails();

    await check();

    expect(output()).toContain("/app/  (ended up at temple.navigate.eab.com /app/v2/#/native/my/home/)");
    expect(output()).toContain("/app/v2/#/native/my/features/resources/people/categories");
    expect(output()).toContain("GET temple.navigate.eab.com /api/v1/core/appconfig/");
    expect(output()).toContain("GET temple.campus.eab.com /api/students/:id/support_team");
    expect(output()).toContain("POST temple.navigate.eab.com /api/v1/some_write/");
  });

  it("shows the shape of the answers it kept, as names and kinds with no values", async () => {
    await check();

    expect(output()).toMatch(/first_name: text/);
    expect(output()).toMatch(/team: list of 1/);
    expect(output()).toMatch(/upcoming_appointments: list of 1/);
  });

  it("prints nothing a person wrote or is called, anywhere", async () => {
    addLeakyDetails();

    await check();

    expectNoLeak();
  });

  it("does nothing but read", async () => {
    await check();

    expect(browser.actions.every((action) => action.type === "read")).toBe(true);
  });
});

describe("with a login that's gone", () => {
  it("says so and shows no page, so that the login page's words stay out of it", async () => {
    expireNavigate360Login(browser);

    expect(await check()).toBe(EXIT_LOGIN_NEEDED);

    expect(output()).toMatch(/Log in to Navigate360/);
    expect(output()).not.toMatch(/Shape of/);
  });
});

describe("when the reader can't understand the app", () => {
  it("says it couldn't, and shows the shape of the pages so that the reader can be corrected", async () => {
    saveNavigate360PagesWithoutAnswers(browser);
    addLeakyDetails();

    expect(await check()).toBe(EXIT_OK);

    expect(output()).toMatch(/Problem: Buddy opened Navigate360 but couldn't make sense of it/);
    expect(output()).toMatch(/Shape of the page, where the reader didn't get what it came for/);
    expect(output()).toMatch(/main\.suh-content/);
    expect(output()).toMatch(/heading/);
    expect(output()).toMatch(/advisors: 0/);
    expectNoLeak();
  });

  it("shows an answer it couldn't understand as a shape as well, with no values", async () => {
    saveNavigate360Pages(browser, {
      team: JSON.stringify({ people: [{ who: MARKERS.unread, what: MARKERS.unread }] }),
      appointments: `<html>${MARKERS.unread}</html>`,
    });

    await check();

    expect(output()).toMatch(/isn't what the reader expects/);
    expect(output()).toMatch(/people: list of 1/);
    expect(output()).toMatch(/not JSON, \d+ characters/);
    expectNoLeak();
  });

  it("says how many on the team have a title the reader doesn't know, without saying what it is", async () => {
    saveNavigate360Pages(browser, { team: teamAnswer(person({ first_name: MARKERS.advisor, relationship: MARKERS.role })) });

    await check();

    expect(output()).toMatch(/others on the team with a title the reader doesn't know: 1/);
    expectNoLeak();
  });

  it("says how many it left out when an advisor's address can't be used, without saying whose", async () => {
    saveNavigate360Pages(browser, { team: teamAnswer(person({ first_name: MARKERS.advisor, email: `${MARKERS.email}@example.test` })) });

    await check();

    expect(output()).toMatch(/advisors left out, with a name or address Buddy can't use: 1/);
    expect(output()).toMatch(/advisors: 0/);
    expectNoLeak();
  });
});

describe("if the Student steps in during the check", () => {
  it("stops, and says so", async () => {
    let reads = 0;
    const realRead = browser.read.bind(browser);
    browser.read = (...args) => {
      reads++;
      if (reads === 1) student.hasReadPermission = false;
      return realRead(...args);
    };

    expect(await check()).toBe(EXIT_NO_READ_PERMISSION);

    expect(output()).toMatch(/revoked during the check/);
    expect(reads).toBe(1);
  });
});

describe("cleaning an address", () => {
  it.each([
    ["https://temple.navigate.eab.com/app/v2/#/native/my/home/", "/app/v2/#/native/my/home/"],
    ["https://temple.navigate.eab.com/app/", "/app/"],
    ["https://temple.navigate.eab.com/api/v2/scheduling/current_user?slim=%27true%27", "/api/v2/scheduling/current_user"],
    ["https://temple.campus.eab.com/api/students/8675309/support_team", "/api/students/:id/support_team"],
    ["https://temple.campus.eab.com/api/students/rileymadeup/support_team", "/api/students/:id/support_team"],
    ["https://x.test/api/people/Riley-Madeup/detail", "/api/people/:id/detail"],
    ["https://x.test/app/v2/#/native/my/features/resources/people/person/501-Advisor", "/app/v2/#/native/my/features/resources/people/person/:id"],
    ["not an address", ":text"],
  ])("%s", (address, expected) => {
    expect(cleanAddress(address, "")).toBe(expected);
  });

  it("keeps an unknown word in a path, which is how a real address gets found, unless the page shows it", () => {
    expect(cleanAddress("https://x.test/api/made_up_route/", "")).toBe("/api/made_up_route/");
    expect(cleanAddress("https://x.test/api/rileymadeup/", "hello rileymadeup")).toBe("/api/:text/");
    expect(cleanAddress("https://x.test/api/RileyMadeup/", "")).toBe("/api/:text/");
    expect(cleanAddress(`https://x.test/api/${"a".repeat(50)}/`, "")).toBe("/api/:text/");
  });
});

describe("the shape of an answer", () => {
  it("names the fields and their kinds, and never a value", () => {
    const shape = shapeOfAnswer(JSON.stringify({ data: { team: [{ first_name: "Riley", id: 5, ok: true, gone: null }] } }), "riley").join("\n");

    expect(shape).toContain("data: object");
    expect(shape).toContain("team: list of 1");
    expect(shape).toContain("first_name: text");
    expect(shape).toContain("id: number");
    expect(shape).toContain("ok: yes or no");
    expect(shape).toContain("gone: nothing");
    expect(shape).not.toContain("Riley");
  });

  it("hides a field's name when it's made of what the answer says, or isn't a plain name", () => {
    const shape = shapeOfAnswer(JSON.stringify({ RileyMadeup: "RileyMadeup", "a b": 1, "12345": 2 }), "rileymadeup").join("\n");

    expect(shape).not.toMatch(/riley/i);
    expect(shape).not.toContain("a b");
    expect(shape).not.toContain("12345");
    expect(shape).toContain(":field");
  });

  it("says what it can of something that isn't JSON", () => {
    expect(shapeOfAnswer("<html>Riley</html>", "")).toEqual(["not JSON, 18 characters"]);
  });
});

describe("the shape of an accessibility tree", () => {
  it("keeps only known roles, in order, with one line for identical neighbours", () => {
    const shape = shapeOfAccessibility(`- main:
  - listitem "Riley Madeup"
  - listitem "Alex Madeup"
  - link "x":
    - /url: mailto:riley@temple.edu
  - text: Riley
  - Riley "Madeup"`);

    expect(shape).toEqual(["main", "  listitem ×2", "  link", "  text"]);
  });
});
