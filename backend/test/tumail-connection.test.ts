import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import { PageBlocked } from "../src/buddys-browser.ts";
import { settings } from "../src/settings.ts";
import { tumail } from "../src/tumail.ts";
import { TUMAIL_ID, TUMAIL_LOGIN_HOSTS } from "../src/tumail-rules.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { haikuFinds, TUTTLEMAN_CONTACT_PAGE } from "./support/office-pages.ts";
import {
  ADVISOR,
  CLINIC,
  expireTumailLogin,
  INBOX_PAGE,
  inboxHtml,
  LOOKALIKE,
  messageHtml,
  messagePage,
  outlookPage,
  PARTNER,
  rowHtml,
  saveTumailPages,
  STRANGER,
} from "./support/tumail-pages.ts";

const SITE = (settings.sites as Record<string, Site>)[TUMAIL_ID]!;
let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start({ sites: { [TUMAIL_ID]: SITE }, extraConnectionTypes: [tumail] });
  saveTumailPages(backend.browser);
});

afterEach(async () => {
  await backend.stop();
});

const statusOf = async () => (await backend.connections()).find((connection) => connection.id === TUMAIL_ID);
const factsFromTumail = async () => (await backend.profileFacts()).filter((fact) => fact.origin.connection === TUMAIL_ID);
const fact = async (textPart: string) => (await factsFromTumail()).find((candidate) => candidate.text.includes(textPart));
const pagesOpened = () => backend.browser.actions.flatMap((action) => (action.type === "read" ? [action.url] : []));
const connect = async () => {
  const response = await backend.giveReadPermission(TUMAIL_ID, undefined);
  expect(response.status).toBe(200);
};

/** A Contact in the Guidebook, found the way every Contact is, with this address on its Source. */
async function addContact(name: string, email: string): Promise<any> {
  backend.web.save(TUTTLEMAN_CONTACT_PAGE, `<html><head><title>Contact</title></head><body><p>${"Words. ".repeat(50)} Write to ${email}.</p></body></html>`);
  backend.claude.willReply(haikuFinds(), haikuFinds({ name, kind: "contact", summary: "Made-up.", email, search_terms: ["visit"] }), haikuFinds());
  await backend.discovery.run();
  return backend.guidebook.search("visit", { kind: "contact" })[0];
}

describe("the Read Permission card", () => {
  it("says exactly what will be read, and what happens to everything else in the list", async () => {
    const { card } = await statusOf();
    const reads = card.reads.join(" ");

    expect(reads).toMatch(/list of recent messages/);
    expect(reads).toMatch(/temple\.edu addresses/);
    expect(reads).toMatch(/@tuhs\.temple\.edu/);
    expect(reads).toMatch(/Contacts/);
    expect(reads).toMatch(/1,500 characters/);
    expect(reads).toMatch(/keeps only how many/);
    expect(reads).toMatch(/its subject, its first words/);
    expect(reads).toMatch(/up to 30 days/);
  });

  it("says what Buddy never does, and how the login goes", async () => {
    const notes = (await statusOf()).card.notes.join(" ");

    expect(notes).toMatch(/never sends, replies, moves, deletes or marks anything read/);
    expect(notes).toMatch(/Sent or Junk/);
    expect(notes).toMatch(/Takeover/);
    expect(notes).toMatch(/7 a\.m\., 1 p\.m\. and 7 p\.m\./);
    expect(notes).toMatch(/revoke/);
    expect(notes).toMatch(/Temple's sign-on/);
  });

  it("warns that Temple and Microsoft haven't approved it", async () => {
    const { warning, address } = (await statusOf()).card;

    expect(warning).toMatch(/Temple/);
    expect(warning).toMatch(/Microsoft/);
    expect(warning).toMatch(/Chief Information Security Officer/);
    expect(address).toBeNull();
  });

  it("is off until the Student gives its Read Permission, and offers a login", async () => {
    expect(await statusOf()).toMatchObject({ on: false, logsIn: true });
    expect(pagesOpened()).toEqual([]);
  });

  it("is one of the Connections Buddy really has", () => {
    expect(settings.connectionTypes.map((type) => type.id)).toContain(TUMAIL_ID);
  });
});

describe("reading the inbox", () => {
  it("opens only those from temple.edu addresses, subdomains included", async () => {
    await connect();

    expect(pagesOpened()).toEqual([INBOX_PAGE, messagePage(ADVISOR), messagePage(CLINIC)]);
    expect(await statusOf()).toMatchObject({ on: true, lastReadProblem: null, needsLogin: false });
  });

  it("never opens mail from anyone else, or from a lookalike address", async () => {
    await connect();

    expect(pagesOpened()).not.toContain(messagePage(STRANGER));
    expect(pagesOpened()).not.toContain(messagePage(LOOKALIKE));
    expect(pagesOpened()).not.toContain(messagePage(PARTNER));
  });

  it("keeps who it's from, the subject, when it came and the words of those it opens", async () => {
    await connect();

    expect(await fact("Made-Up Advisor")).toMatchObject({
      text: "Email from Made-Up Advisor <made.up.advisor@temple.edu>: Re: Spring plan",
      detail: expect.stringContaining("happy to meet on Thursday"),
      origin: { type: "connection", connection: TUMAIL_ID, name: "TUmail" },
    });
    expect((await fact("Made-Up Advisor")).detail).toContain("Mon 11/2/2026 10:32 AM");
  });

  it("keeps only how many there were of the rest, and nothing about them", async () => {
    await connect();

    const facts = await factsFromTumail();
    const everything = JSON.stringify(facts);
    expect(everything).not.toContain("MARKER");
    expect(everything).not.toContain("stranger@elsewhere.test");
    expect(everything).not.toContain("evil.test");
    expect(backend.storageContains("MARKERNOTOPENEDSUBJECT")).toBe(false);
    expect(backend.storageContains("stranger@elsewhere.test")).toBe(false);
    expect((await fact("Recent TUmail"))?.text).toBe(
      "Recent TUmail: 5 messages in the list. Buddy opens only those from temple.edu addresses and Contacts, and left the other 3 unopened, keeping nothing about them.",
    );
  });

  it("opens mail from a Contact too, from the same list a Handoff uses, whatever the case of the address", async () => {
    await addContact("Made-Up Partner Office", "partner@elsewhere.test");

    await connect();

    expect(pagesOpened()).toContain(messagePage(PARTNER));
    expect(await fact("partner@elsewhere.test")).toBeDefined();
  });

  it("stops opening mail from a Contact once they've been reported, as they can't be handed off to any more", async () => {
    const contact = await addContact("Made-Up Partner Office", "partner@elsewhere.test");
    await backend.report(contact.id);

    await connect();

    expect(pagesOpened()).not.toContain(messagePage(PARTNER));
  });

  it("waits for the app to build each page, since it does that long after loading", async () => {
    const waits: unknown[] = [];
    const read = backend.browser.read.bind(backend.browser);
    backend.browser.read = (url, guard, wait) => {
      waits.push(wait);
      return read(url, guard, wait);
    };

    await connect();

    expect(waits).toEqual([
      { until: expect.stringContaining("data-convid") },
      { until: expect.stringContaining("Message body") },
      { until: expect.stringContaining("Message body") },
    ]);
  });

  it("opens each message on the host the inbox ended up on, rather than being redirected each time", async () => {
    const elsewhere = "https://outlook.cloud.microsoft/mail/inbox";
    backend.browser.savedPages.set(INBOX_PAGE, { ...backend.browser.savedPages.get(INBOX_PAGE)!, finalUrl: elsewhere });
    backend.browser.savedPages.set(`${elsewhere}/id/${encodeURIComponent(ADVISOR)}`, backend.browser.savedPages.get(messagePage(ADVISOR))!);
    backend.browser.savedPages.set(`${elsewhere}/id/${encodeURIComponent(CLINIC)}`, backend.browser.savedPages.get(messagePage(CLINIC))!);

    await connect();

    expect(await statusOf()).toMatchObject({ lastReadProblem: null, needsLogin: false });
    expect(pagesOpened().slice(1).every((url) => url.startsWith(elsewhere))).toBe(true);
  });

  it("hides a password or a number in an email, as for anything else that's kept", async () => {
    backend.browser.savedPages.set(
      messagePage(CLINIC),
      outlookPage(messageHtml({ from: "Clinic &lt;clinic@tuhs.temple.edu&gt;", body: "<p>Your password is hunter2hunter and your SSN is 123-45-6789.</p>" })),
    );

    await connect();

    const { detail } = await fact("clinic@tuhs.temple.edu");
    expect(detail).not.toContain("hunter2hunter");
    expect(detail).not.toContain("123-45-6789");
    expect(detail).toContain("[password hidden]");
  });

  it("keeps only the start of a long email", async () => {
    backend.browser.savedPages.set(
      messagePage(CLINIC),
      outlookPage(messageHtml({ from: "Clinic &lt;clinic@tuhs.temple.edu&gt;", body: `<p>${"long ".repeat(1000)}</p>` })),
    );

    await connect();

    expect((await fact("clinic@tuhs.temple.edu")).detail.length).toBeLessThan(1600);
  });
});

describe("what the message itself says about who sent it", () => {
  it("doesn't keep the words if the message turns out to be from someone it shouldn't read", async () => {
    backend.browser.savedPages.set(
      messagePage(CLINIC),
      outlookPage(messageHtml({ from: "dean@temple.edu &lt;someone@evil.test&gt;", subject: "MARKERSUBJECT", body: "<p>MARKERWORDS</p>" })),
    );

    await connect();

    const { lastReadProblem } = await statusOf();
    expect(lastReadProblem).toMatch(/couldn't read some/);
    expect(JSON.stringify(await factsFromTumail())).not.toContain("MARKER");
    expect((await fact("clinic@tuhs.temple.edu")).detail).toContain("couldn't read the words");
  });

  it.each([
    ["shows no address", messageHtml({ from: "Only A Name", body: "<p>MARKERWORDS</p>" })],
    ["has several messages open", `<div aria-label="Reading Pane"><div aria-label="Message body">MARKERWORDS</div><div aria-label="Message body">MARKERWORDS</div></div>`],
    ["isn't a page the reader knows", "<h1>MARKERWORDS</h1>"],
  ])("says so, and still knows one came, when the message %s", async (_, html) => {
    backend.browser.savedPages.set(messagePage(CLINIC), outlookPage(html));

    await connect();

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't read some/);
    expect(JSON.stringify(await factsFromTumail())).not.toContain("MARKER");
    expect(await fact("clinic@tuhs.temple.edu")).toBeDefined();
    expect(await fact("Made-Up Advisor")).toBeDefined();
  });
});

describe("a conversation whose list shows someone other than who wrote the newest message", () => {
  it("says who the message itself shows", async () => {
    backend.browser.savedPages.set(
      messagePage(ADVISOR),
      outlookPage(messageHtml({ from: "Made-Up Other &lt;other@temple.edu&gt;", subject: "Re: Spring plan", body: "<p>Words.</p>" })),
    );

    await connect();

    expect((await fact("Re: Spring plan")).text).toBe("Email from Made-Up Other <other@temple.edu>: Re: Spring plan");
  });
});

describe("a page that isn't what the reader expects", () => {
  it.each([
    ["nothing it knows", "<h1>Made-up page</h1>"],
    ["an app that never built its list", '<div id="loading"></div>'],
    ["a list with no rows", '<div role="listbox" aria-label="Message list"><p>Something went wrong</p></div>'],
  ])("says so loudly and keeps what it has, rather than calling the inbox empty: %s", async (_, html) => {
    await connect();
    const before = await factsFromTumail();
    backend.browser.savedPages.set(INBOX_PAGE, outlookPage(html));

    await backend.readNow(TUMAIL_ID);

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense of the page/);
    expect(await factsFromTumail()).toEqual(before);
    expect((await backend.activity())[0]).toMatchObject({ kind: "connection_read_failed" });
  });

  it("says so too when it can't see who any message is from", async () => {
    backend.browser.savedPages.set(
      INBOX_PAGE,
      outlookPage(inboxHtml('<div data-convid="a"><span title="A Name">A Name</span></div>', '<div data-convid="b"><span title="B Name">B Name</span></div>')),
    );

    await connect();

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't make sense of the page/);
    expect(pagesOpened()).toEqual([INBOX_PAGE]);
  });

  it("carries on when it can't see who some are from, and says it missed those", async () => {
    backend.browser.savedPages.set(
      INBOX_PAGE,
      outlookPage(inboxHtml('<div data-convid="a"><span title="A Name">A Name</span></div>', rowHtml({ id: ADVISOR, address: "made.up.advisor@temple.edu", words: "Words" }))),
    );

    await connect();

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't see who some/);
    expect(pagesOpened()).toEqual([INBOX_PAGE, messagePage(ADVISOR)]);
  });

  it("reads an inbox the app says is empty", async () => {
    backend.browser.savedPages.set(INBOX_PAGE, outlookPage('<div role="listbox" aria-label="Message list"><p>Nothing in inbox</p></div>'));

    await connect();

    expect(await statusOf()).toMatchObject({ lastReadProblem: null, needsLogin: false });
    expect((await fact("Recent TUmail"))?.text).toContain("0 messages");
  });
});

describe("the login", () => {
  it("asks for a Takeover when Outlook sends the browser to sign in, and goes no further", async () => {
    expireTumailLogin(backend.browser);

    await connect();

    expect(await statusOf()).toMatchObject({ needsLogin: true, lastReadProblem: expect.stringContaining("Log in to TUmail") });
    expect(pagesOpened()).toEqual([INBOX_PAGE]);
  });

  it("doesn't ask for a Takeover that couldn't help when Outlook moves the inbox to a page not on Buddy's list", async () => {
    backend.browser.savedPages.set(INBOX_PAGE, { ...backend.browser.savedPages.get(INBOX_PAGE)!, finalUrl: "https://outlook.office.com/mail/somewhere-new" });

    await connect();

    expect(await statusOf()).toMatchObject({ needsLogin: false, lastReadProblem: expect.stringContaining("couldn't make sense") });
  });

  it("asks for a Takeover when the guard won't go where Outlook sends it", async () => {
    backend.browser.savedPages.set(INBOX_PAGE, { ...backend.browser.savedPages.get(INBOX_PAGE)!, finalUrl: "https://signin.elsewhere.test/" });

    await connect();

    expect(await statusOf()).toMatchObject({ needsLogin: true });
  });

  it("keeps what it has when the login goes in the middle of a read", async () => {
    await connect();
    const before = await factsFromTumail();
    backend.browser.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml(rowHtml({ id: "AAQkNew", address: "new@temple.edu", words: "New" }))));
    backend.browser.savedPages.set(messagePage("AAQkNew"), outlookPage("", { finalUrl: "https://login.microsoftonline.com/common" }));

    await backend.readNow(TUMAIL_ID);

    expect(await statusOf()).toMatchObject({ needsLogin: true });
    expect(await factsFromTumail()).toEqual(before);
  });

  it("is checked after a Takeover even if Outlook moves to another of its hosts", async () => {
    await connect();
    backend.browser.savedPages.set(SITE.homeUrl, outlookPage("<h1>App</h1>", { finalUrl: "https://outlook.cloud.microsoft/mail/" }));
    await backend.startTakeover(TUMAIL_ID);

    const response = await backend.finishTakeover();

    expect(await response.json()).toMatchObject({ signedIn: true });
  });

  it("waits for the app when checking the login, because it may never finish loading", async () => {
    await connect();
    const waits: unknown[] = [];
    const read = backend.browser.read.bind(backend.browser);
    backend.browser.read = (url, guard, wait) => {
      waits.push(wait);
      return read(url, guard, wait);
    };
    await backend.startTakeover(TUMAIL_ID);

    await backend.finishTakeover();

    expect(waits[0]).toEqual({ until: expect.stringContaining("data-convid") });
  });

  it("isn't taken to be working when the check ends up at Microsoft's sign-in", async () => {
    await connect();
    backend.browser.savedPages.set(SITE.homeUrl, outlookPage("<form></form>", { finalUrl: "https://login.microsoftonline.com/common" }));
    await backend.startTakeover(TUMAIL_ID);

    const response = await backend.finishTakeover();

    expect(await response.json()).toMatchObject({ signedIn: false });
  });

  it("needs the Read Permission first", async () => {
    const response = await backend.startTakeover(TUMAIL_ID);

    expect(response.status).toBe(403);
    await expect(backend.browserAccess.read(INBOX_PAGE)).rejects.toThrow(PageBlocked);
  });
});

describe("reading again", () => {
  it("opens only what's new, and carries the rest over", async () => {
    await connect();
    backend.browser.actions.length = 0;

    await backend.readNow(TUMAIL_ID);

    expect(pagesOpened()).toEqual([INBOX_PAGE]);
    expect(await fact("Made-Up Advisor")).toBeDefined();
  });

  it("opens a message again when a new reply arrives in its conversation, and has the new words", async () => {
    await connect();
    backend.browser.actions.length = 0;
    backend.browser.savedPages.set(
      INBOX_PAGE,
      outlookPage(inboxHtml(rowHtml({ id: ADVISOR, address: "made.up.advisor@temple.edu", words: "A newer reply", when: "Tue 11/3/2026 9:00 AM" }))),
    );
    backend.browser.savedPages.set(
      messagePage(ADVISOR),
      outlookPage(messageHtml({ from: "Made-Up Advisor &lt;made.up.advisor@temple.edu&gt;", subject: "Re: Spring plan", body: "<p>A newer reply.</p>" })),
    );

    await backend.readNow(TUMAIL_ID);

    expect(pagesOpened()).toEqual([INBOX_PAGE, messagePage(ADVISOR)]);
    expect((await fact("Made-Up Advisor")).detail).toContain("A newer reply");
    expect((await backend.connectionEvents(TUMAIL_ID)).map((event) => event.kind)).toEqual(["new_reply"]);
    expect((await backend.activity())[0].detail).toContain("1 new reply");
  });

  it("says a new email in Activity by how many, and never what it says", async () => {
    await connect();
    backend.browser.savedPages.set(
      INBOX_PAGE,
      outlookPage(inboxHtml(rowHtml({ id: "AAQkNew", address: "new@temple.edu", words: "Words" }), rowHtml({ id: ADVISOR, address: "made.up.advisor@temple.edu", words: "Happy to meet on Thursday" }))),
    );
    backend.browser.savedPages.set(messagePage("AAQkNew"), outlookPage(messageHtml({ from: "New &lt;new@temple.edu&gt;", subject: "MARKERSUBJECT", body: "<p>MARKERWORDS</p>" })));

    await backend.readNow(TUMAIL_ID);

    expect(JSON.stringify(await backend.connectionEvents(TUMAIL_ID))).toContain("MARKERSUBJECT");
    const [entry] = await backend.activity();
    expect(entry).toMatchObject({ kind: "connection_read", title: "Buddy read TUmail" });
    expect(entry.detail).toContain("1 new email");
    expect(JSON.stringify(entry)).not.toContain("MARKER");
  });

  it("still knows an email once it has scrolled out of the list", async () => {
    await connect();
    backend.browser.actions.length = 0;
    backend.browser.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml(rowHtml({ id: "AAQkOther", address: "stranger@elsewhere.test", words: "Words" }))));

    await backend.readNow(TUMAIL_ID);

    expect(await fact("Made-Up Advisor")).toBeDefined();
  });

  it("doesn't lose an email, or call it new again, because one read couldn't see who it's from", async () => {
    await connect();
    backend.browser.savedPages.set(
      INBOX_PAGE,
      outlookPage(inboxHtml(`<div data-convid="${ADVISOR}"><span title="Only A Name">Only A Name</span></div>`, rowHtml({ id: CLINIC, address: "clinic@tuhs.temple.edu", words: "Words" }))),
    );

    await backend.readNow(TUMAIL_ID);

    expect(await fact("Made-Up Advisor")).toBeDefined();
    expect((await backend.connectionEvents(TUMAIL_ID)).map((event) => event.kind)).not.toContain("new_email");
  });

  it("lets go of an email from a Contact who's been reported, once the list shows it again", async () => {
    await addContact("Made-Up Partner Office", "partner@elsewhere.test");
    await connect();
    expect(await fact("partner@elsewhere.test")).toBeDefined();

    const contact = backend.guidebook.search("visit", { kind: "contact" })[0]!;
    await backend.report(contact.id);
    await backend.readNow(TUMAIL_ID);

    expect(await fact("partner@elsewhere.test")).toBeUndefined();
  });

  it("opens what's new before trying again what it couldn't read last time", async () => {
    const stuck = Array.from({ length: 10 }, (_, index) => `AAQkStuck${index}`);
    const stuckRows = stuck.map((id) => rowHtml({ id, address: `${id.toLowerCase()}@temple.edu`, words: "Words" }));
    backend.browser.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml(...stuckRows)));
    for (const id of stuck) backend.browser.savedPages.set(messagePage(id), outlookPage("<h1>Not a message</h1>"));
    await connect();
    backend.browser.actions.length = 0;
    backend.browser.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml(...stuckRows, rowHtml({ id: "AAQkOlderButNew", address: "new@temple.edu", words: "Words" }))));
    backend.browser.savedPages.set(messagePage("AAQkOlderButNew"), outlookPage(messageHtml({ from: "New &lt;new@temple.edu&gt;", body: "<p>Words.</p>" })));

    await backend.readNow(TUMAIL_ID);

    expect(pagesOpened()[1]).toBe(messagePage("AAQkOlderButNew"));
    expect(await fact("new@temple.edu")).toBeDefined();
  });

  it("says each thing that went wrong, not only the last", async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `AAQk${index}`);
    backend.browser.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml(...ids.map((id) => rowHtml({ id, address: `${id.toLowerCase()}@temple.edu`, words: "Words" })))));
    for (const id of ids) backend.browser.savedPages.set(messagePage(id), outlookPage("<h1>Not a message</h1>"));

    await connect();

    const { lastReadProblem } = await statusOf();
    expect(lastReadProblem).toMatch(/couldn't read some/);
    expect(lastReadProblem).toMatch(/opened only your newest/);
  });

  it("lets it go after a month", async () => {
    await connect();
    backend.clock.moveForward(31 * 24 * 3_600_000);
    backend.browser.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml(rowHtml({ id: "AAQkOther", address: "stranger@elsewhere.test", words: "Words" }))));

    await backend.readNow(TUMAIL_ID);

    expect(await fact("Made-Up Advisor")).toBeUndefined();
  });

  it("opens only the newest ten at a time, says so, and comes back for the rest", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `AAQk${index}`);
    backend.browser.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml(...ids.map((id) => rowHtml({ id, address: `${id.toLowerCase()}@temple.edu`, words: "Words" })))));
    for (const id of ids) backend.browser.savedPages.set(messagePage(id), outlookPage(messageHtml({ from: `Someone &lt;${id.toLowerCase()}@temple.edu&gt;`, body: "<p>Words.</p>" })));

    await connect();
    expect(pagesOpened()).toHaveLength(11);
    expect((await statusOf()).lastReadProblem).toMatch(/opened only your newest/);

    backend.browser.actions.length = 0;
    await backend.readNow(TUMAIL_ID);
    expect(pagesOpened()).toEqual([INBOX_PAGE, messagePage("AAQk10"), messagePage("AAQk11")]);
    expect((await statusOf()).lastReadProblem).toBeNull();
  });
});

describe("the schedule and Activity", () => {
  it("reads three times a day like any other Connection", async () => {
    await connect();
    backend.browser.actions.length = 0;

    await backend.readDueConnections();
    expect(pagesOpened()).toEqual([]);

    backend.clock.moveForward(8 * 3_600_000);
    await backend.readDueConnections();
    expect(pagesOpened()).toEqual([INBOX_PAGE]);
    expect((await backend.activity())[0]).toMatchObject({ title: "Buddy read TUmail", detail: "It was one of Buddy's regular read times." });
  });

  it("shows each read, and nothing from the mail in it", async () => {
    await connect();

    const entries = await backend.activity();
    expect(entries.map((entry) => entry.title)).toContain("Buddy read TUmail");
    expect(entries.map((entry) => entry.title)).toContain("You gave Buddy a Read Permission for TUmail");
    expect(JSON.stringify(entries)).not.toContain("happy to meet");
    expect(JSON.stringify(entries)).not.toContain("Made-Up Advisor");
  });
});

describe("revoking", () => {
  it("deletes every TUmail fact and the login, and it's in Activity", async () => {
    await connect();
    expect((await factsFromTumail()).length).toBeGreaterThan(0);
    backend.browser.actions.length = 0;

    const response = await backend.revokeReadPermission(TUMAIL_ID);

    expect(response.status).toBe(200);
    expect(await factsFromTumail()).toEqual([]);
    expect(backend.browser.actions).toEqual([
      { type: "clear-screen" },
      { type: "forget-login", hosts: TUMAIL_LOGIN_HOSTS },
    ]);
    expect(await statusOf()).toMatchObject({ on: false, loginNotDeletedYet: false });
    const titles = (await backend.activity()).map((entry) => entry.title);
    expect(titles).toContain("You revoked the Read Permission for TUmail");
    expect(titles).toContain("Buddy deleted your TUmail login");
  });

  it("leaves nothing an email said in the database", async () => {
    await connect();
    expect(backend.storageContains("happy to meet on Thursday")).toBe(true);

    await backend.revokeReadPermission(TUMAIL_ID);

    expect(backend.storageContains("happy to meet on Thursday")).toBe(false);
    expect(backend.storageContains("Re: Spring plan")).toBe(false);
    expect(backend.storageContains("made.up.advisor@temple.edu")).toBe(false);
  });

  it("stops the reads, and the guard refuses Outlook", async () => {
    await connect();
    await backend.revokeReadPermission(TUMAIL_ID);
    backend.browser.actions.length = 0;

    backend.clock.moveForward(8 * 3_600_000);
    await backend.readDueConnections();

    expect(pagesOpened()).toEqual([]);
    await expect(backend.browserAccess.read(INBOX_PAGE)).rejects.toThrow(PageBlocked);
  });

  it("keeps trying to delete the login when the browser can't be reached, and won't read with it under a new Read Permission", async () => {
    await connect();
    backend.browser.unreachable = true;
    await backend.revokeReadPermission(TUMAIL_ID);
    expect(await statusOf()).toMatchObject({ loginNotDeletedYet: true });

    await connect();

    expect((await statusOf()).lastReadProblem).toMatch(/couldn't delete your old TUmail login/);
  });
});
