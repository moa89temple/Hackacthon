import { describe, expect, it } from "vitest";
import { createGuardPolicy } from "../src/network-guard.ts";
import {
  NAVIGATE360_CAMPUS_HOST,
  NAVIGATE360_HOME,
  NAVIGATE360_ID,
  NAVIGATE360_ROUTES,
} from "../src/navigate360-rules.ts";
import { keepToReadablePages } from "../src/readable-pages.ts";
import { settings } from "../src/settings.ts";

const APP = "https://temple.navigate.eab.com/app";
const sites = { [NAVIGATE360_ID]: settings.sites[NAVIGATE360_ID]! };
const guards = (hasPermission = true) => createGuardPolicy({ sites, publicHosts: [], hasReadPermission: () => hasPermission });
const opening = (url: string, hasPermission = true) =>
  keepToReadablePages(guards(hasPermission).forReading(), sites).check({ url, method: "GET", opensPage: true });

describe("the pages Buddy opens", () => {
  it.each([
    ["the page that chooses the app's version", NAVIGATE360_HOME],
    ["version 1", `${APP}/v1/`],
    ["version 2", `${APP}/v2/`],
    ...Object.entries(NAVIGATE360_ROUTES).flatMap(([version, routes]) => [
      [`${version}'s team`, `${APP}/${version}/${routes.team}`],
      [`${version}'s appointments`, `${APP}/${version}/${routes.appointments}`],
    ]),
    ["its login page, to see that a login has gone", `${APP}/v1/#/authentication/`],
    ["the sign-on page, for the same reason", "https://fim.temple.edu/idp/profile/SAML2/Redirect/SSO"],
  ])("opens %s", (_, url) => {
    expect(opening(url!)).toEqual({ allowed: true });
  });

  it.each([
    // Named in the public scripts.
    "#/my/host/as3/appointment-dashboard",
    "#/my/host/as3/appointment-dashboard?tab_name=invitations",
    "#/my/host/as3/appointment-dashboard?tab_name=appointments&next=appointment-new",
    "#/my/host/as3/appointment-new",
    "#/native/my/apps/as3/appointment-new",
    "#/native/my/apps/as3/appointment-dashboard",
    "#/native/my/apps/as3/appointment-cancel-details",
    "#/native/my/apps/as3/appointment-results",
    "#/native/my/apps/as3/pre-appointment-questions",
    "#/native/my/features/raise_hand",
    "#/native/my/features/raise_hand_form/",
    "#/native/my/features/study/sections",
    "#/native/my/features/docs/notes",
    "#/native/my/features/surveys/",
    "#/native/my/features/resources/people/person/501-Advisor",
    "#/my/appointment-new/",
    "#/my/conversations/",
    "#/my/studygroups/",
    "#/dl/holds/type/123",
    // A route that merely starts or ends like one Buddy reads.
    "#/native/my/home/extra",
    "#/native/my/features/resources/people/categories/category/x",
    "#/before/native/my/home/",
  ])("doesn't open %s", (route) => {
    expect(opening(`${APP}/v2/${route}`).allowed).toBe(false);
  });

  it("doesn't open anything else on the site, or anywhere on the app's other host", () => {
    expect(opening("https://temple.navigate.eab.com/admin").allowed).toBe(false);
    expect(opening(`https://${NAVIGATE360_CAMPUS_HOST}/`).allowed).toBe(false);
    expect(opening(`${APP}/somewhere/`).allowed).toBe(false);
  });

  it("opens a version of the app it doesn't know yet, so that it can say so instead of asking for a login", () => {
    expect(opening(`${APP}/v3/`)).toEqual({ allowed: true });
  });

  it("opens nothing at all without the Read Permission", () => {
    expect(opening(NAVIGATE360_HOME, false).allowed).toBe(false);
  });
});

describe("what's never opened, even with an approved card", () => {
  it.each([
    `${APP}/v2/#/native/my/apps/as3/appointment-new`,
    `${APP}/v2/#/NATIVE/my/apps/as3/Appointment-New`,
    `${APP}/v2/#/native/my/apps/as3/appointment-cancel-details`,
    `${APP}/v2/#/native/my/features/raise_hand_form/`,
    `${APP}/v2/#/native/my/features/study/sections`,
    `${APP}/v1/#/my/appointment-cancel/1`,
    `${APP}/v1/#/my/conversations/`,
    `${APP}/v1/#/dl/holds/type/123`,
    "https://temple.navigate.eab.com/api/v1/study/sections/",
    "https://temple.navigate.eab.com/api/v1/notification/students/7/messages/1/",
    "https://temple.navigate.eab.com/api/v1/raise_hand/",
  ])("%s", (url) => {
    expect(guards().isBlockedPage(url)).toBe(true);
    expect(guards().forApprovedStep().check({ url, method: "GET", opensPage: true }).allowed).toBe(false);
  });

  it.each([
    `${APP}/`,
    `${APP}/v2/`,
    `${APP}/v2/#/native/my/home/`,
    `${APP}/v2/#/native/my/features/resources/people/categories`,
    "https://temple.navigate.eab.com/api/v2/scheduling/current_user?slim=%27true%27",
    `https://${NAVIGATE360_CAMPUS_HOST}/api/students/7/support_team`,
    "https://temple.navigate.eab.com/api/v1/core/appconfig/",
  ])("%s isn't one of them", (url) => {
    expect(guards().isBlockedPage(url)).toBe(false);
  });
});

describe("what a page loads for itself", () => {
  const loading = (url: string, method = "GET") => keepToReadablePages(guards().forReading(), sites).check({ url, method, opensPage: false });

  it("lets the app ask for the Student's team and appointments", () => {
    expect(loading(`https://${NAVIGATE360_CAMPUS_HOST}/api/students/7/support_team`)).toEqual({ allowed: true });
    expect(loading("https://temple.navigate.eab.com/api/v2/scheduling/current_user?slim=%27true%27")).toEqual({ allowed: true });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses a %s, so nothing can be booked or cancelled or sent", (method) => {
    expect(loading("https://temple.navigate.eab.com/api/v2/scheduling/appointments/", method).allowed).toBe(false);
    expect(loading(`https://${NAVIGATE360_CAMPUS_HOST}/api/students/7/messages`, method).allowed).toBe(false);
  });
});
