import { describe, expect, it } from "vitest";
import { settings } from "../src/settings.ts";
import { runTuportalCheck, type TuportalCheckDeps } from "../src/tuportal-check.ts";
import { RecordingBrowser } from "./support/recording-browser.ts";
import {
  BALANCE_PAGE,
  changeTuportalPage,
  expireTuportalLogin,
  HOLDS_PAGE,
  HOME_PAGE,
  REGISTRATION_PAGE,
  saveTuportalPages,
  savedTuportalHtml,
  TUPORTAL,
} from "./support/tuportal-pages.ts";

const browserWithAllPages = (): RecordingBrowser => {
  const browser = new RecordingBrowser();
  saveTuportalPages(browser);
  return browser;
};

async function check(browser: RecordingBrowser, more: Partial<TuportalCheckDeps> = {}) {
  const lines: string[] = [];
  const exitCode = await runTuportalCheck({
    browser,
    sites: { tuportal: settings.sites.tuportal },
    student: () => ({ hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: false }),
    print: (line) => lines.push(line),
    ...more,
  });
  return { exitCode, output: lines.join("\n") };
}

/** Everything here is made up. Any of these reaching the output is a leak. */
const SECRETS = /MARKER|markerslug|1,?234|250\.00|9,?999|Made-?Up|made-?up|Spring 2027|Hold: |Bursar|\b2 holds?\b|×\d/;

const LEAKY_HTML = `<!doctype html>
<html lang="MARKERATTR">
<head><title>MARKERTITLE</title><script>window.who = "MARKERSCRIPT";</script><style>.x::after { content: "MARKERSTYLE"; }</style></head>
<body class="portal" data-student="MARKERNAME">
  <!-- MARKERCOMMENT -->
  <h1 class="page-heading">Welcome, MARKERNAME</h1>
  <table class="made-table" data-row-kind="MARKERNAME">
    <tr><th>Hold Type</th><th>MARKERHEADING</th></tr>
    <tr class="row"><td>$1,234.56</td></tr><tr class="row"><td>$1,234.56</td></tr><tr class="row"><td>$1,234.56</td></tr>
  </table>
  <a href="/web/markerslug/profile?who=MARKERQUERY" title="MARKERATTR">MARKERNAME</a>
  <input value="MARKERVALUE" name="MARKERATTR" class="field">
  <iframe src="https://prd-banner.temple.edu/prod8/markerslug/bwskoacc.P_ViewAcct?who=MARKERQUERY" title="MARKERATTR"></iframe>
  <iframe src="https://markerhost.example.test/x"></iframe>
</body>
</html>`;

describe("before anything opens", () => {
  it("needs the Student's Read Permission, and opens nothing without it", async () => {
    const browser = browserWithAllPages();

    const { exitCode, output } = await check(browser, { student: () => ({ hasReadPermission: false, takeoverUnderWay: false, oldLoginRemains: false }) });

    expect(exitCode).toBe(2);
    expect(output).toMatch(/no Read Permission/);
    expect(browser.actions).toEqual([]);
  });

  it("stays out during a Takeover", async () => {
    const browser = browserWithAllPages();

    const { exitCode } = await check(browser, { student: () => ({ hasReadPermission: true, takeoverUnderWay: true, oldLoginRemains: false }) });

    expect(exitCode).toBe(3);
    expect(browser.actions).toEqual([]);
  });

  it("stays out while a revoked login is still waiting to be deleted", async () => {
    const browser = browserWithAllPages();

    const { exitCode } = await check(browser, { student: () => ({ hasReadPermission: true, takeoverUnderWay: false, oldLoginRemains: true }) });

    expect(exitCode).toBe(5);
    expect(browser.actions).toEqual([]);
  });
});

describe("with pages the reader understands", () => {
  it("says which it understood, exits 0, and only ever reads", async () => {
    const browser = browserWithAllPages();

    const { exitCode, output } = await check(browser);

    expect(exitCode).toBe(0);
    expect(output).toMatch(/Login: works/);
    expect(output).toMatch(/holds \/group\/home\/student-record-services: understood/);
    expect(output).toMatch(/balance \/group\/home\/costs-and-aid: understood/);
    expect(output).toMatch(/registration \/group\/home\/student: understood/);
    expect(browser.actions.every((action) => action.type === "read")).toBe(true);
  });

  it("never says what they said", async () => {
    const { output } = await check(browserWithAllPages());

    expect(output).not.toMatch(SECRETS);
  });

  it("doesn't let on whether there are holds: a page with none and a page with some look the same", async () => {
    const some = browserWithAllPages();
    const none = browserWithAllPages();
    changeTuportalPage(none, HOLDS_PAGE, savedTuportalHtml("no-holds"));

    const withSome = await check(some);
    const withNone = await check(none);

    expect(withNone.output).toBe(withSome.output);
    expect(withNone.output).not.toMatch(/no holds/i);
  });

  it("lists the links on the portal's home, so that the guessed addresses can be corrected, with nothing personal", async () => {
    const browser = browserWithAllPages();
    changeTuportalPage(
      browser,
      HOME_PAGE,
      '<a href="/group/home/cost-aid">Cost &amp; Aid</a><a href="/group/home/view-holds?x=MARKERQUERY">View Holds</a><a href="/web/markerslug/profile">MARKERNAME</a><a href="https://tuportal.temple.edu/group/student">Student</a><a href="https://elsewhere.example.test/MARKERQUERY">Off the portal</a>',
    );

    const { output } = await check(browser);

    expect(output).toContain("/group/home/cost-aid");
    expect(output).toContain("/group/home/view-holds");
    expect(output).toContain("/group/student");
    expect(output).toContain("/web/:text/profile");
    expect(output).not.toMatch(SECRETS);
    expect(output).not.toContain("elsewhere.example.test");
  });
});

describe("with pages it doesn't understand", () => {
  it("names the page, exits 6, and prints its structure with nothing from it", async () => {
    const browser = browserWithAllPages();
    changeTuportalPage(browser, HOLDS_PAGE, LEAKY_HTML);

    const { exitCode, output } = await check(browser);

    expect(exitCode).toBe(6);
    expect(output).toMatch(/holds \/group\/home\/student-record-services: NOT understood/);
    expect(output).toMatch(/balance \/group\/home\/costs-and-aid: understood/);
    expect(output).toMatch(/couldn't read your holds/);
    expect(output).toContain("table.made-table");
    expect(output).not.toMatch(SECRETS);
  });

  it("names the frames on it, because that's where the portal may keep what matters, with nothing personal", async () => {
    const browser = browserWithAllPages();
    changeTuportalPage(browser, HOLDS_PAGE, LEAKY_HTML);

    const { output } = await check(browser);

    expect(output).toContain("frame: prd-banner.temple.edu /prod8/:text/bwskoacc.p_viewacct");
    expect(output).toContain("frame: (a host off the portal) /:text");
    expect(output).not.toMatch(SECRETS);
  });

  it("shows the headings it knows the words of, and hides the rest", async () => {
    const browser = browserWithAllPages();
    changeTuportalPage(browser, HOLDS_PAGE, LEAKY_HTML);

    const { output } = await check(browser);

    expect(output).toContain("heading: hold type");
    expect(output).toContain("heading: :word");
    expect(output).toContain("heading: :word :word");
  });

  it("doesn't count rows, which would say how many holds there are", async () => {
    const browser = browserWithAllPages();
    changeTuportalPage(browser, HOLDS_PAGE, LEAKY_HTML);

    const { output } = await check(browser);

    expect(output).not.toMatch(/×\d/);
    expect(output).toContain("(repeated)");
  });

  it("says where a page ended up when that isn't where it was sent, in words that aren't the Student's", async () => {
    const browser = browserWithAllPages();
    changeTuportalPage(browser, BALANCE_PAGE, "<p>Made-up</p>", { finalUrl: `${TUPORTAL}/group/home` });

    const { exitCode, output } = await check(browser);

    expect(exitCode).toBe(6);
    expect(output).toMatch(/balance \/group\/home\/costs-and-aid: NOT understood \(ended up at tuportal6\.temple\.edu \/group\/home\)/);
  });

  it("reports what the guard refused, and that nothing got through", async () => {
    const browser = browserWithAllPages();
    changeTuportalPage(browser, HOLDS_PAGE, savedTuportalHtml("holds"), {
      alsoRequests: [
        { url: `${TUPORTAL}/group/home/registration`, method: "GET" },
        { url: `${TUPORTAL}/group/home/student-record-services`, method: "POST" },
        { url: "https://prd-wlssb.temple.edu/prod8/bwskoacc.P_ViewAcct?who=MARKERQUERY", method: "GET" },
      ],
    });

    const { output } = await check(browser);

    expect(output).toContain("GET tuportal6.temple.edu /group/home/registration");
    expect(output).toContain("POST tuportal6.temple.edu /group/home/student-record-services");
    expect(output).toContain("GET prd-wlssb.temple.edu /prod8/bwskoacc.p_viewacct");
    expect(output).not.toMatch(SECRETS);
  });

  it("says when a page the reader asked for is refused, and it isn't blamed on the login", async () => {
    const browser = browserWithAllPages();
    changeTuportalPage(browser, REGISTRATION_PAGE, "<p>x</p>", { finalUrl: `${TUPORTAL}/group/home/registration` });

    const { exitCode, output } = await check(browser);

    expect(exitCode).toBe(6);
    expect(output).toMatch(/Login: works/);
    expect(output).toMatch(/registration \/group\/home\/student: NOT understood \(PageBlocked\)/);
  });
});

describe("when the login has gone", () => {
  it("exits 4 and says to log in, printing no structure", async () => {
    const browser = browserWithAllPages();
    expireTuportalLogin(browser);

    const { exitCode, output } = await check(browser);

    expect(exitCode).toBe(4);
    expect(output).toMatch(/Log in to TUportal/);
    expect(output).not.toContain("body");
    expect(output).toContain("fim.temple.edu /idp/profile/saml2/redirect/sso");
  });
});

describe("when the Student steps in", () => {
  it("stops if the Read Permission goes during the check", async () => {
    const browser = browserWithAllPages();
    let asked = 0;

    const { exitCode, output } = await check(browser, {
      student: () => ({ hasReadPermission: asked++ < 2, takeoverUnderWay: false, oldLoginRemains: false }),
    });

    expect(exitCode).toBe(2);
    expect(output).toMatch(/revoked during the check/);
  });

  it("stops if a Takeover starts during the check", async () => {
    const browser = browserWithAllPages();
    let asked = 0;

    const { exitCode, output } = await check(browser, {
      student: () => ({ hasReadPermission: true, takeoverUnderWay: asked++ >= 2, oldLoginRemains: false }),
    });

    expect(exitCode).toBe(3);
    expect(output).toMatch(/Takeover started during the check/);
  });
});

describe("whatever goes wrong", () => {
  it("doesn't print an error's words, which could quote a page", async () => {
    const browser = browserWithAllPages();

    const { exitCode, output } = await check(browser, {
      student: () => {
        throw new Error("MARKERERROR");
      },
    });

    expect(exitCode).toBe(1);
    expect(output).not.toContain("MARKER");
  });
});
