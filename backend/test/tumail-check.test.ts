import { describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import { EXIT_FAILED, EXIT_LOGIN_NEEDED, EXIT_NO_READ_PERMISSION, EXIT_OLD_LOGIN_REMAINS, EXIT_OK, EXIT_TAKEOVER_UNDER_WAY } from "../src/canvas-check.ts";
import { settings } from "../src/settings.ts";
import { tumail } from "../src/tumail.ts";
import { cleanTumailRequest, EXIT_MARKED_READ, runTumailCheck, tumailStructureOf } from "../src/tumail-check.ts";
import { RecordingBrowser } from "./support/recording-browser.ts";
import {
  ADVISOR,
  CLINIC,
  expireTumailLogin,
  INBOX_PAGE,
  inboxHtml,
  messagePage,
  outlookPage,
  rowHtml,
  saveTumailPages,
} from "./support/tumail-pages.ts";

const SITES = settings.sites as Record<string, Site>;

/** Everything here is made up. Any of these reaching the output is a leak. */
const LEAKS = [
  "MARKER",
  "marker",
  "made.up.advisor",
  "Made-Up Advisor",
  "Made-Up Clinic",
  "Made-Up Partner",
  "Made-Up Stranger",
  "Made-Up Student",
  "clinic@",
  "partner@",
  "stranger@",
  "elsewhere.test",
  "evil.test",
  "Spring plan",
  "happy to meet",
  "AAQk",
];

/** A page that holds a marker in each place a page can hold words, in a shape the reader doesn't know. */
const LEAKY_PAGE = `<!doctype html><html lang="MARKERLANG"><head><title>MARKERTITLE</title>
  <script>window.user = "MARKERSCRIPT";</script></head>
  <body data-who="MARKERDATA"><!-- MARKERCOMMENT -->
  <div id="MARKERID" class="MARKERCLASS" role="markerrole" title="MARKERTITLEATTR" aria-label="MARKERLABEL">
    <h1 class="MARKERCLASS">MARKERWORDS</h1>
    <a href="/mail/MARKERLINK?x=MARKERQUERY" data-x="MARKERDATA">MARKERWORDS</a>
    <img alt="MARKERALT" src="/MARKERSRC.png">
    <input value="MARKERVALUE" placeholder="MARKERPLACEHOLDER">
    <span title="marker.person@temple.edu">MARKERWORDS</span>
    <div aria-label="Message body"><p class="MARKERCLASS" data-markerinside="1" role="heading">MARKERWORDS</p></div>
    <div class="x_MARKERSIGNATURE" data-markerx="1"><span class="MARKERCLASS">MARKERWORDS</span></div>
    <iframe srcdoc="MARKERFRAME" data-markerframe="1"></iframe>
    <svg><title>MARKERSVG</title></svg>
    <template><div class="MARKERTEMPLATE"></div></template>
  </div></body></html>`;

function browserWithPages(): RecordingBrowser {
  const browser = new RecordingBrowser();
  saveTumailPages(browser);
  return browser;
}

async function check(browser: RecordingBrowser, more: Partial<Parameters<typeof runTumailCheck>[0]> = {}) {
  const lines: string[] = [];
  const exitCode = await runTumailCheck({
    browser,
    connection: tumail,
    sites: SITES,
    student: () => ({ hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: false }),
    print: (line) => lines.push(line),
    ...more,
  });
  return { exitCode, output: lines.join("\n"), lines };
}

function expectNoLeaks(output: string): void {
  for (const leak of LEAKS) expect(output.includes(leak), `${leak} leaked`).toBe(false);
  expect(output).not.toMatch(/marker/i);
}

describe("what the check prints", () => {
  it("gives the counts, from the real reader, and nothing that was on the pages", async () => {
    const { output, exitCode } = await check(browserWithPages());

    expect(exitCode).toBe(EXIT_OK);
    expect(output).toContain("Login: works");
    expect(output).toMatch(/messages in the list: 5\b/);
    expect(output).toMatch(/with a sender's address: 5\b/);
    expect(output).toMatch(/from temple\.edu addresses: 2\b/);
    expect(output).toMatch(/opened: 2\b/);
    expect(output).toMatch(/words read: 2\b/);
    expect(output).toMatch(/subject found: 2\b/);
    expectNoLeaks(output);
  });

  it("lists each page opened, with ids replaced", async () => {
    const { output } = await check(browserWithPages());

    expect(output).toMatch(/\/mail\/inbox +×2/);
    expect(output).toMatch(/\/mail\/inbox\/id\/:id +×2/);
  });

  it("says a Contact isn't something it can check", async () => {
    const { output } = await check(browserWithPages());

    expect(output).toMatch(/no Contacts/);
  });

  it("lists what the guard refused and what it let through by name, which is what the lead needs to correct the rules", async () => {
    const browser = browserWithPages();
    browser.savedPages.get(messagePage(ADVISOR))!.alsoRequests = [
      { url: "https://outlook.office.com/owa/service.svc?action=GetConversationItems&app=Mail", method: "POST" },
      { url: "https://outlook.office.com/owa/service.svc?action=UpdateItem&app=Mail&who=MARKERWHO", method: "POST" },
      { url: "https://outlook.office.com/owa/graphql?q=MARKERQUERY", method: "POST" },
      { url: "https://browser.events.data.microsoft.com/OneCollector/1.0/", method: "POST" },
    ];

    const { output } = await check(browser);

    expect(output).toContain("POST outlook.office.com /owa/service.svc?action=UpdateItem");
    expect(output).toContain("POST outlook.office.com /owa/graphql");
    expect(output).toContain("POST browser.events.data.microsoft.com");
    const letThrough = output.slice(output.indexOf("Let through"));
    expect(letThrough).toContain("POST outlook.office.com /owa/service.svc?action=GetConversationItems");
    expectNoLeaks(output);
  });

  it("names no host an email could have chosen, such as where a picture comes from", async () => {
    const browser = browserWithPages();
    browser.savedPages.get(messagePage(ADVISOR))!.alsoRequests = [
      { url: "https://marker-person.example/pixel?action=MARKERACTION", method: "POST" },
    ];

    const { output } = await check(browser);

    expect(output).toContain("POST (another host)");
    expectNoLeaks(output);
  });

  it("says whether the list has Focused Inbox's tabs, since mail under Other wouldn't be seen", async () => {
    const browser = browserWithPages();
    expect((await check(browser)).output).toContain("Focused Inbox tabs on the page: no");

    const withTabs = browserWithPages();
    withTabs.savedPages.set(
      INBOX_PAGE,
      outlookPage(inboxHtml(`<div role="tab" aria-selected="true">Focused</div><div role="tab">Other</div>`, rowHtml({ id: ADVISOR, address: "made.up.advisor@temple.edu", words: "Words" }))),
    );

    expect((await check(withTabs)).output).toContain("Focused Inbox tabs on the page: yes");
  });

  it("shows nothing about a page's structure when everything was understood", async () => {
    const { output } = await check(browserWithPages());

    expect(output).not.toContain("Structure");
  });
});

describe("when the reader doesn't recognize a page", () => {
  it("shows the inbox's structure, with no words from it", async () => {
    const browser = browserWithPages();
    browser.savedPages.set(INBOX_PAGE, outlookPage(LEAKY_PAGE));

    const { output, exitCode } = await check(browser);

    expect(exitCode).toBe(EXIT_OK);
    expect(output).toContain("Problem: Buddy opened TUmail but couldn't make sense of the page");
    expect(output).toContain("Structure of /mail/inbox");
    expect(output).toMatch(/not recognized/);
    expect(output).toContain("title=:address");
    expectNoLeaks(output);
  });

  it("shows a message page's structure, with no words from it", async () => {
    const browser = browserWithPages();
    browser.savedPages.set(messagePage(CLINIC), outlookPage(LEAKY_PAGE));

    const { output } = await check(browser);

    expect(output).toMatch(/not recognized: 1\b/);
    expect(output).toContain("Structure of /mail/inbox/id/:id");
    expect(output).toContain("aria-label=message body (not looked inside)");
    expectNoLeaks(output);
  });

  it("shows a list's structure when it can't see any sender", async () => {
    const browser = browserWithPages();
    browser.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml('<div role="option" data-convid="a" aria-label="MARKERLABEL"><span title="MARKER NAME">MARKERWORDS</span></div>')));

    const { output } = await check(browser);

    expect(output).toContain("Structure of /mail/inbox");
    expect(output).toContain("data-convid");
    expectNoLeaks(output);
  });
});

describe("tumailStructureOf", () => {
  it("gives roles, kinds of label and data attribute names, and folds identical rows", () => {
    const lines = tumailStructureOf(inboxHtml(rowHtml({ id: "a", address: "x@temple.edu", words: "One", unread: true }), rowHtml({ id: "b", address: "y@temple.edu", words: "Two", unread: true })));

    const text = lines.join("\n");
    expect(text).toContain("role=listbox aria-label=message list");
    expect(text).toContain("role=option aria-label=:starts-with-unread [data-convid]");
    expect(text).toContain("×2");
    expect(text).toContain("span title=:address");
    expect(text).toContain("span title=:date");
  });

  it("drops plain elements, which only say how deep the app nests things", () => {
    const lines = tumailStructureOf(`<body><div><div><div><section role="main"><div><span title="x@temple.edu">X</span></div></section></div></div></div></body>`);

    expect(lines.join("\n")).toBe(["body", "  section role=main", "    span title=:address"].join("\n"));
  });
});

describe("cleanTumailRequest", () => {
  const hosts = ["outlook.office.com"];

  it.each([
    ["https://outlook.office.com/mail/inbox/id/AAQkMadeUp%3D", "outlook.office.com /mail/inbox/id/:id"],
    ["https://outlook.office.com/mail/0/inbox", "outlook.office.com /mail/:id/inbox"],
    ["https://outlook.office.com/owa/service.svc?action=UpdateItem&app=Mail", "outlook.office.com /owa/service.svc?action=UpdateItem"],
    ["https://outlook.office.com/owa/service.svc?action=Not+A+Name", "outlook.office.com /owa/service.svc"],
    ["https://outlook.office.com/owa/Someone-Name/x.js", "outlook.office.com /owa/:text/:text.js"],
    ["https://elsewhere.example/owa/service.svc?action=UpdateItem", "(another host)"],
    ["not an address", "(another host)"],
  ])("%s", (url, cleaned) => {
    expect(cleanTumailRequest(url, hosts)).toBe(cleaned);
  });
});

describe("whether opening a message marks it read", () => {
  /** An Outlook whose list stops saying unread once a message has been opened, as if the guard hadn't stopped it. */
  class MarksRead extends RecordingBrowser {
    override async read(...[url, guard, wait]: Parameters<RecordingBrowser["read"]>) {
      if (url === messagePage(ADVISOR)) {
        this.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml(rowHtml({ id: ADVISOR, address: "made.up.advisor@temple.edu", words: "Words" }))));
      }
      return super.read(url, guard, wait);
    }
  }

  const unreadInbox = () => outlookPage(inboxHtml(rowHtml({ id: ADVISOR, address: "made.up.advisor@temple.edu", words: "Words", unread: true })));

  it("says it stayed unread when it did, having looked at the list again", async () => {
    const browser = browserWithPages();
    browser.savedPages.set(INBOX_PAGE, unreadInbox());

    const { output, exitCode } = await check(browser);

    expect(exitCode).toBe(EXIT_OK);
    expect(output).toMatch(/opened while unread: 1\b/);
    expect(output).toMatch(/still unread afterwards: 1\b/);
    expect(browser.actions.filter((action) => action.type === "read" && action.url === INBOX_PAGE)).toHaveLength(2);
  });

  it("says loudly, and exits with its own code, when it didn't", async () => {
    const browser = new MarksRead();
    saveTumailPages(browser);
    browser.savedPages.set(INBOX_PAGE, unreadInbox());

    const { output, exitCode } = await check(browser);

    expect(exitCode).toBe(EXIT_MARKED_READ);
    expect(output).toMatch(/still unread afterwards: 0\b/);
    expect(output).toMatch(/opening a message marked it read/i);
  });

  it("says it can't tell when nothing it opened was unread", async () => {
    const browser = browserWithPages();
    browser.savedPages.set(INBOX_PAGE, outlookPage(inboxHtml(rowHtml({ id: ADVISOR, address: "made.up.advisor@temple.edu", words: "Words" }))));

    const { output } = await check(browser);

    expect(output).toMatch(/can't tell.*none of what it opened was unread/i);
  });
});

describe("what the check won't do", () => {
  it("opens nothing without a Read Permission", async () => {
    const browser = browserWithPages();

    const { exitCode, output } = await check(browser, { student: () => ({ hasReadPermission: false, takeoverUnderWay: false, oldLoginRemains: false }) });

    expect(exitCode).toBe(EXIT_NO_READ_PERMISSION);
    expect(browser.actions).toEqual([]);
    expect(output).toContain("Connect TUmail");
  });

  it("opens nothing during a Takeover", async () => {
    const browser = browserWithPages();

    const { exitCode } = await check(browser, { student: () => ({ hasReadPermission: true, takeoverUnderWay: true, oldLoginRemains: false }) });

    expect(exitCode).toBe(EXIT_TAKEOVER_UNDER_WAY);
    expect(browser.actions).toEqual([]);
  });

  it("opens nothing while an old login is waiting to be deleted", async () => {
    const browser = browserWithPages();

    const { exitCode } = await check(browser, { student: () => ({ hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: true }) });

    expect(exitCode).toBe(EXIT_OLD_LOGIN_REMAINS);
    expect(browser.actions).toEqual([]);
  });

  it("stops if the Student revokes in the middle, and says so", async () => {
    const browser = browserWithPages();
    let asked = 0;

    const { exitCode, output } = await check(browser, {
      student: () => ({ hasReadPermission: ++asked < 3, takeoverUnderWay: false, oldLoginRemains: false }),
    });

    expect(exitCode).toBe(EXIT_NO_READ_PERMISSION);
    expect(output).toMatch(/revoked during the check/);
    expectNoLeaks(output);
  });

  it("says when the login has gone, and looks at no message", async () => {
    const browser = browserWithPages();
    expireTumailLogin(browser);

    const { exitCode, output } = await check(browser);

    expect(exitCode).toBe(EXIT_LOGIN_NEEDED);
    expect(output).toContain("Log in to TUmail");
    expect(browser.actions.filter((action) => action.type === "read")).toHaveLength(1);
    expect(output).not.toContain("Structure");
  });

  it("does nothing to the browser but read, and doesn't give away what an error said", async () => {
    const browser = browserWithPages();
    browser.savedPages.set(messagePage(CLINIC), outlookPage("", { finalUrl: "not an address MARKERERROR" }));

    const { output, exitCode } = await check(browser);

    expect([EXIT_OK, EXIT_FAILED, EXIT_LOGIN_NEEDED]).toContain(exitCode);
    expect(browser.actions.every((action) => action.type === "read")).toBe(true);
    expectNoLeaks(output);
  });

});
