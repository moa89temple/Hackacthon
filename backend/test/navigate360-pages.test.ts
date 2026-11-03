import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appVersionOf, isNavigate360LoginPage, readAppointmentsAnswer, readTeamAnswer, usableAdvisorEmail } from "../src/navigate360-pages.ts";

const NOW = new Date("2026-11-02T14:00:00Z");
const saved = (name: string) => readFileSync(new URL(`./fixtures/navigate360-pages/${name}.json`, import.meta.url), "utf8");
const team = (...people: unknown[]) => JSON.stringify({ data: { team: people } });
const person = (more: object = {}) => ({
  first_name: "Riley",
  last_name: "Madeup",
  email: "riley.madeup@temple.edu",
  relationship: "Primary Advisor",
  ...more,
});
const appointments = (...list: unknown[]) => JSON.stringify({ data: { user: { upcoming_appointments: list } } });

describe("reading the Student's team", () => {
  it("finds the advisor, and keeps no one else on the team", () => {
    const found = readTeamAnswer(saved("support-team"))!;

    expect(found.advisors).toEqual([
      { name: "Riley Madeup", email: "riley.madeup@temple.edu", phone: "215-555-0142", role: "Primary Advisor" },
    ]);
    expect(found.othersOnTeam).toBe(1);
    expect(found.unusable).toBe(0);
  });

  it("finds every advisor when there are several, and one person listed twice is one advisor", () => {
    const found = readTeamAnswer(
      team(
        person(),
        person({ relationship: "Advisor" }),
        person({ first_name: "Alex", email: "ALEX.madeup@temple.edu", relationship: "Honors Advisor" }),
      ),
    )!;

    expect(found.advisors.map((advisor) => [advisor.name, advisor.email])).toEqual([
      ["Riley Madeup", "riley.madeup@temple.edu"],
      ["Alex Madeup", "alex.madeup@temple.edu"],
    ]);
  });

  it("an answer with an empty team is a Student with no advisor", () => {
    expect(readTeamAnswer(team())).toEqual({ advisors: [], othersOnTeam: 0, unknownRoles: 0, unusable: 0 });
  });

  it("a team with no advisor on it is a Student with no advisor", () => {
    expect(readTeamAnswer(team(person({ relationship: "Instructor" })))).toMatchObject({ advisors: [], othersOnTeam: 1, unusable: 0 });
  });

  it("reads a team as a real login gets it, with nothing around it, the same as one inside data", () => {
    expect(readTeamAnswer(JSON.stringify({ team: [person()] }))).toEqual(readTeamAnswer(JSON.stringify({ data: { team: [person()] } })));
    expect(readTeamAnswer(JSON.stringify({ team: [person()] }))?.advisors).toHaveLength(1);
  });

  it.each([
    ["isn't JSON", "<html>Sign in</html>"],
    ["is empty", ""],
    ["has no team in it", JSON.stringify({ data: {} })],
    ["has its team somewhere else", JSON.stringify({ people: { team: [person()] } })],
    ["has a team that isn't a list", JSON.stringify({ data: { team: "nobody" } })],
    ["has something on its team that isn't a person", team("Riley Madeup")],
  ])("an answer that %s couldn't be understood, which isn't the same as no advisor", (_, body) => {
    expect(readTeamAnswer(body)).toBeNull();
  });

  it("a team where nobody says what they are has changed shape, so it couldn't be understood", () => {
    expect(readTeamAnswer(team(person({ relationship: undefined }), person({ relationship: "" })))).toBeNull();
  });

  it("counts someone whose title it doesn't know, which can't be taken to mean they aren't an advisor", () => {
    expect(readTeamAnswer(team(person({ relationship: "Success Coach" })))).toMatchObject({ advisors: [], othersOnTeam: 0, unknownRoles: 1 });
  });

  it.each(["Instructor", "Professor", "Teaching Assistant", "Course Instructor"])("knows that %s isn't an advisor", (relationship) => {
    expect(readTeamAnswer(team(person({ relationship })))).toMatchObject({ othersOnTeam: 1, unknownRoles: 0 });
  });

  it("someone hidden from the Student isn't kept", () => {
    expect(readTeamAnswer(team(person({ visible_to_student: false })))!.advisors).toEqual([]);
  });

  it("an advisor with no address is still an advisor, with no address", () => {
    const found = readTeamAnswer(team(person({ email: "" })))!;

    expect(found.advisors).toEqual([{ name: "Riley Madeup", email: null, phone: null, role: "Primary Advisor" }]);
    expect(found.unusable).toBe(0);
  });

  it.each([
    ["isn't an address", "not an address"],
    ["has two addresses", "riley@temple.edu, someone@example.test"],
    ["has more on the end", "riley@temple.edu?bcc=someone@example.test"],
    ["isn't Temple's", "riley@example.test"],
    ["only looks like Temple's", "riley@temple.edu.example.test"],
  ])("an advisor whose address %s doesn't become an advisor, and says so", (_, email) => {
    const found = readTeamAnswer(team(person({ email })))!;

    expect(found.advisors).toEqual([]);
    expect(found.unusable).toBe(1);
  });

  it("an advisor with no name can't be used, and says so", () => {
    expect(readTeamAnswer(team(person({ first_name: "", last_name: "" })))).toMatchObject({ advisors: [], unusable: 1 });
  });

  it("hides a secret that has got into someone's name, as everything from a Connection is", () => {
    const found = readTeamAnswer(team(person({ first_name: "password: hunter2" })))!;

    expect(JSON.stringify(found)).not.toContain("hunter2");
  });
});

describe("what counts as an advisor's address", () => {
  it.each([
    ["riley.madeup@temple.edu", "riley.madeup@temple.edu"],
    ["  Riley.Madeup@TEMPLE.edu ", "riley.madeup@temple.edu"],
    ["tuj01234@tuj.temple.edu", "tuj01234@tuj.temple.edu"],
    ["r_madeup+advising@temple.edu", "r_madeup+advising@temple.edu"],
  ])("%s is one", (raw, expected) => {
    expect(usableAdvisorEmail(raw)).toBe(expected);
  });

  it.each([
    "riley",
    "@temple.edu",
    "riley@",
    "riley@@temple.edu",
    "ri ley@temple.edu",
    "riley..madeup@temple.edu",
    ".riley@temple.edu",
    "riley@temple..edu",
    "riley@nottemple.edu",
    "riley@temple.edu.evil.test",
    "riley@temple.edu\nbcc:someone@example.test",
    "mailto:riley@temple.edu",
    "Riley <riley@temple.edu>",
    "riléy@temple.edu",
    `${"a".repeat(250)}@temple.edu`,
  ])("%s isn't", (raw) => {
    expect(usableAdvisorEmail(raw)).toBeNull();
  });
});

describe("reading upcoming appointments", () => {
  it("finds what's still to come, and not what's past or what someone wrote about it", () => {
    const found = readAppointmentsAnswer(saved("current-user"), NOW)!;

    expect(found.appointments).toEqual([
      {
        id: "9001",
        startsAt: "2026-11-10T15:30:00.000Z",
        what: "Made-up Advising Visit",
        where: "Made-up Hall 100",
        withWhom: "Riley Madeup",
      },
    ]);
    expect(JSON.stringify(found)).not.toContain("staff member wrote");
    expect(JSON.stringify(found)).not.toContain("meeting.example.test");
  });

  it("an empty list is a Student with no appointments", () => {
    expect(readAppointmentsAnswer(appointments(), NOW)).toEqual({ appointments: [], unusable: 0 });
  });

  it.each([
    ["isn't JSON", "<html></html>"],
    ["has no list in it", JSON.stringify({ data: { user: {} } })],
    ["has no user in it", JSON.stringify({ data: {} })],
    ["has something in the list that isn't an appointment", appointments("Tuesday")],
  ])("an answer that %s couldn't be understood, which isn't the same as no appointments", (_, body) => {
    expect(readAppointmentsAnswer(body, NOW)).toBeNull();
  });

  it("an appointment with no time Buddy can read can't be used, and says so", () => {
    expect(readAppointmentsAnswer(appointments({ id: 1, start: "soon" }, { id: 2 }), NOW)).toEqual({ appointments: [], unusable: 2 });
  });

  it("takes a location written as plain words, and leaves out what isn't there", () => {
    const found = readAppointmentsAnswer(appointments({ start: "2026-11-10T15:30:00Z", location: "Made-up Hall" }), NOW)!;

    expect(found.appointments).toEqual([
      { id: null, startsAt: "2026-11-10T15:30:00.000Z", what: null, where: "Made-up Hall", withWhom: null },
    ]);
  });

  it("the placeholder the app shows for a missing value is nothing", () => {
    const found = readAppointmentsAnswer(appointments({ start: "2026-11-10T15:30:00Z", location: "--", name: "--" }), NOW)!;

    expect(found.appointments[0]).toMatchObject({ what: null, where: null });
  });
});

describe("where a page ended up", () => {
  it.each([
    ["https://temple.navigate.eab.com/app/v1/#/my/feed/", "v1"],
    ["https://temple.navigate.eab.com/app/v2/", "v2"],
    ["https://temple.navigate.eab.com/app/v2/#/native/my/home/", "v2"],
    ["https://temple.navigate.eab.com/app/", null],
    ["https://temple.navigate.eab.com/somewhere", null],
  ])("%s is the app's version %s", (address, version) => {
    expect(appVersionOf(address)).toBe(version);
  });

  it.each([
    "https://temple.navigate.eab.com/app/#/authentication/remote/",
    "https://temple.navigate.eab.com/app/v1/#/authentication/",
    "https://temple.navigate.eab.com/app/v1/#/authentication/remote/failure",
    "https://temple.navigate.eab.com/app/v1/#/login/",
    "https://temple.navigate.eab.com/app/v2/#/native/login",
    "https://fim.temple.edu/idp/profile/SAML2/POST/SSO",
    "https://api-1.duosecurity.com/frame",
  ])("%s is somewhere to log in", (address) => {
    expect(isNavigate360LoginPage(address)).toBe(true);
  });

  it.each([
    "https://temple.navigate.eab.com/app/v2/",
    "https://temple.navigate.eab.com/app/v2/#/native/my/home/",
    "https://temple.navigate.eab.com/app/v1/#/my/feed/",
  ])("%s isn't", (address) => {
    expect(isNavigate360LoginPage(address)).toBe(false);
  });
});
