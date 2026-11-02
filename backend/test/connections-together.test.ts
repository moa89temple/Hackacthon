import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageBlocked } from "../src/buddys-browser.ts";
import { canvas } from "../src/canvas.ts";
import { navigate360 } from "../src/navigate360.ts";
import { settings } from "../src/settings.ts";
import { tumail } from "../src/tumail.ts";
import { tuportal } from "../src/tuportal.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { saveCanvasPages } from "./support/canvas-pages.ts";
import { person, saveNavigate360Pages, teamAnswer } from "./support/navigate360-pages.ts";
import { saveTumailPages } from "./support/tumail-pages.ts";
import { saveTuportalPages } from "./support/tuportal-pages.ts";

/** The four Temple Connections with the real rules, as they run together. Each one's own tests have it alone. */
const SIGN_ON_HOSTS = ["fim.temple.edu", "duosecurity.com"];
const ALL = [canvas, tuportal, tumail, navigate360];
const ADVISOR_ADDRESS = "made.up.advisor@temple.edu";
let backend: BackendHarness;

beforeEach(async () => {
  const { canvas: canvasSite, tuportal: tuportalSite, tumail: tumailSite, navigate360: navigate360Site } = settings.sites;
  backend = await BackendHarness.start({
    sites: { canvas: canvasSite, tuportal: tuportalSite, tumail: tumailSite, navigate360: navigate360Site },
    extraConnectionTypes: ALL,
  });
  saveCanvasPages(backend.browser);
  saveTuportalPages(backend.browser);
  saveTumailPages(backend.browser);
  saveNavigate360Pages(backend.browser, {
    team: teamAnswer(person({ email: ADVISOR_ADDRESS })),
  });
});

afterEach(async () => {
  await backend.stop();
});

const connectAll = async () => {
  for (const { id } of ALL) expect((await backend.giveReadPermission(id, undefined)).status).toBe(200);
};
const factsFrom = async (id: string) => (await backend.profileFacts()).filter((fact) => fact.origin.connection === id);
const forgotten = () => backend.browser.actions.filter((action) => action.type === "forget-login").flatMap((action: any) => action.hosts as string[]);

describe("Navigate360's advisor and TUmail", () => {
  it("makes the advisor a Contact in the list TUmail goes by, and takes them out of it on revoke", async () => {
    await connectAll();
    expect((await backend.readNow(navigate360.id)).status).toBe(200);
    const addresses = () => backend.guidebook.contacts().map((contact) => contact.email?.toLowerCase());

    expect(addresses()).toContain(ADVISOR_ADDRESS);

    await backend.revokeReadPermission(navigate360.id);

    expect(addresses()).not.toContain(ADVISOR_ADDRESS);
  });
});

describe("revoking one of four Connections", () => {
  it("deletes only its own facts", async () => {
    await connectAll();
    for (const { id } of ALL) await backend.readNow(id);
    for (const { id } of ALL) expect(await factsFrom(id), id).not.toEqual([]);

    await backend.revokeReadPermission(tuportal.id);

    expect(await factsFrom(tuportal.id)).toEqual([]);
    for (const { id } of [canvas, tumail, navigate360]) expect(await factsFrom(id), id).not.toEqual([]);
  });

  it("keeps the shared sign-on until the last Temple Connection goes, and clears each one's own hosts as it goes", async () => {
    await connectAll();

    for (const { id } of [canvas, tuportal, tumail]) await backend.revokeReadPermission(id);

    const hosts = forgotten();
    expect(hosts).toEqual(expect.arrayContaining(["instructure.com", "tuportal6.temple.edu", "outlook.office.com", "login.microsoftonline.com"]));
    for (const host of SIGN_ON_HOSTS) expect(hosts).not.toContain(host);
    expect(hosts).not.toContain("temple.navigate.eab.com");

    await backend.revokeReadPermission(navigate360.id);

    expect(forgotten()).toEqual(expect.arrayContaining([...SIGN_ON_HOSTS, "temple.navigate.eab.com"]));
  });

  it("leaves the others readable, and refuses the revoked one even though the sign-on is still there", async () => {
    await connectAll();

    await backend.revokeReadPermission(tuportal.id);

    await expect(backend.browserAccess.read("https://tuportal6.temple.edu/group/home")).rejects.toThrow(PageBlocked);
    await expect(backend.browserAccess.read("https://outlook.office.com/mail/inbox")).resolves.toBeTruthy();
  });
});
