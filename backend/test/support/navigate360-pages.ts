import { readFileSync } from "node:fs";
import type { RecordingBrowser, SavedPage } from "./recording-browser.ts";

const ORIGIN = "https://temple.navigate.eab.com";
export const LANDING_PAGE = `${ORIGIN}/app/`;
export const TEAM_PAGE = `${ORIGIN}/app/v2/#/native/my/features/resources/people/categories`;
export const HOME_PAGE = `${ORIGIN}/app/v2/#/native/my/home/`;
export const V1_LANDED = `${ORIGIN}/app/v1/#/my/feed/`;
export const V1_TEAM_PAGE = `${ORIGIN}/app/v1/#/my/resources/people/`;
export const V1_APPOINTMENTS_PAGE = `${ORIGIN}/app/v1/#/my/schedule/`;
export const LOGGED_OUT = `${ORIGIN}/app/v1/#/authentication/`;
export const TEAM_ANSWER_ADDRESS = "https://temple.campus.eab.com/api/students/7/support_team";
export const APPOINTMENTS_ANSWER_ADDRESS = `${ORIGIN}/api/v2/scheduling/current_user?slim=%27true%27`;

export const savedAnswer = (name: string) => readFileSync(new URL(`../fixtures/navigate360-pages/${name}.json`, import.meta.url), "utf8");
export const teamAnswer = (...people: unknown[]) => JSON.stringify({ data: { team: people } });
export const appointmentsAnswer = (...list: unknown[]) => JSON.stringify({ data: { user: { upcoming_appointments: list } } });

export const person = (more: object = {}) => ({
  first_name: "Riley",
  last_name: "Madeup",
  email: "riley.madeup@temple.edu",
  relationship: "Primary Advisor",
  ...more,
});

const page = (more: Partial<SavedPage>): SavedPage => ({ title: "Navigate360", text: "", accessibilitySnapshot: "", ...more });

/** The app as v2 serves it to a Student with a working login. Everything in it is made up. */
export function saveNavigate360Pages(browser: RecordingBrowser, answers: { team?: string; appointments?: string } = {}): void {
  const team = answers.team ?? savedAnswer("support-team");
  const appointments = answers.appointments ?? savedAnswer("current-user");
  const home = page({ finalUrl: HOME_PAGE, answers: [{ url: APPOINTMENTS_ANSWER_ADDRESS, status: 200, body: appointments }] });
  browser.savedPages.set(LANDING_PAGE, home);
  browser.savedPages.set(HOME_PAGE, home);
  browser.savedPages.set(TEAM_PAGE, page({ answers: [{ url: TEAM_ANSWER_ADDRESS, status: 200, body: team }] }));
}

/** The app with a working login, but with neither of its answers showing up on any page. */
export function saveNavigate360PagesWithoutAnswers(browser: RecordingBrowser): void {
  browser.savedPages.set(LANDING_PAGE, page({ finalUrl: HOME_PAGE, html: "<main id='app'></main>" }));
  browser.savedPages.set(HOME_PAGE, page({ html: "<main id='app'></main>" }));
  browser.savedPages.set(TEAM_PAGE, page({ html: "<main id='app'></main>" }));
}

/** The app as it is for a browser with no login: every page ends up at its login page. */
export function expireNavigate360Login(browser: RecordingBrowser): void {
  for (const url of [LANDING_PAGE, HOME_PAGE, TEAM_PAGE]) {
    browser.savedPages.set(url, page({ finalUrl: LOGGED_OUT }));
  }
}
