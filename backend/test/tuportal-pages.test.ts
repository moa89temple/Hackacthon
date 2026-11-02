import { partToRead } from "../src/tuportal.ts";
import { describe, expect, it } from "vitest";
import { hasPasswordField, readBalancePage, readHoldsPage, readRegistrationPage } from "../src/tuportal-pages.ts";
import { pageFrom, savedPage } from "./support/tuportal-pages.ts";

describe("the holds page", () => {
  it("reads each hold, and not who placed it", () => {
    const holds = readHoldsPage(savedPage("holds"))!;

    expect(holds.map((hold) => hold.type)).toEqual(["Made-Up Bursar Hold", "Made-Up Advising Hold"]);
    expect(holds[0]).toMatchObject({ reason: "Made-up past due balance", from: "Oct 01, 2026", amount: "$250.00", affects: "Registration" });
    expect(JSON.stringify(holds)).not.toContain("MADE-UP-STAFF-NAME");
  });

  it("reads a page that says plainly there are none as none, even with words about holds around it", () => {
    expect(readHoldsPage(savedPage("no-holds"))).toEqual([]);
  });

  it.each(["No holds", "No Holds Exist", "You have no holds.", "You do not have any holds on your account.", "There are no holds on your record."])(
    "takes %j as saying there are none",
    (line) => {
      expect(readHoldsPage({ html: `<p>${line}</p>`, text: line })).toEqual([]);
    },
  );

  describe("never turns a page it can't understand into no holds", () => {
    const CANT_BE_UNDERSTOOD: Record<string, { html: string; text: string }> = {
      "a page that holds it in a frame": savedPage("unknown"),
      "an empty page": pageFrom("<html><body></body></html>"),
      "a page still loading": pageFrom('<div class="spinner">Loading holds...</div>'),
      "a page that only mentions no holds in passing": pageFrom("<p>If you have no holds, you may register.</p>"),
      "a table with no rows and nothing that says why": pageFrom("<table><tr><th>Hold Type</th><th>Reason</th></tr></table>"),
      "a table with other headings": pageFrom("<table><tr><th>Type</th><th>Why</th></tr><tr><td>Made-up</td><td>Made-up</td></tr></table>"),
      "a row whose hold has no name": pageFrom("<table><tr><th>Hold Type</th><th>Reason</th></tr><tr><td></td><td>Made-up reason</td></tr></table>"),
      "a row with cells missing": pageFrom("<table><tr><th>Hold Type</th><th>Reason</th></tr><tr><td>Made-up hold</td></tr></table>"),
      "a sign-on page": pageFrom('<form><input name="j_username"><input type="password" name="j_password"></form>'),
    };

    it.each(Object.keys(CANT_BE_UNDERSTOOD))("%s", (name) => {
      expect(readHoldsPage(CANT_BE_UNDERSTOOD[name]!)).toBeNull();
    });

    it("an empty message that's in the page but hidden, with the holds drawn some way it doesn't know", () => {
      const html = '<div class="empty-state">No holds exist</div><div class="card">Made-Up Bursar Hold</div>';

      expect(readHoldsPage({ html, text: "Made-Up Bursar Hold" })).toBeNull();
    });

    it("a line saying there are none alongside words that say there's one", () => {
      const text = "No holds\nHold Type: Made-Up Bursar Hold";

      expect(readHoldsPage({ html: `<p>${text}</p>`, text })).toBeNull();
    });

    it.each([
      ["a hold drawn as a card beside it", "No holds found\nMade-Up Bursar Hold", ""],
      ["a count of holds beside it", "No holds\nHolds: 2", ""],
      ["a table beside it whose headings don't say hold", "No holds found\nType\tWhy\nMade-up\tMade-up", "<table><tr><th>Type</th><th>Why</th></tr><tr><td>Made-up</td><td>Made-up</td></tr></table>"],
    ])("a visible line saying there are none, with %s", (_, text, html) => {
      expect(readHoldsPage({ html: `<p>No holds found</p>${html}`, text })).toBeNull();
    });

    it("a line saying there are none inside a longer visible line", () => {
      const text = "Holds: No holds exist for last term, 1 for this term";

      expect(readHoldsPage({ html: `<p>${text}</p>`, text })).toBeNull();
    });
  });

  it("goes by the holds it can see when a none message stays in the page", () => {
    const html = "<p hidden>No holds exist</p><table><tr><th>Hold Type</th></tr><tr><td>Made-Up Bursar Hold</td></tr></table>";

    expect(readHoldsPage(pageFrom(html))!.map((hold) => hold.type)).toEqual(["Made-Up Bursar Hold"]);
  });

  it("doesn't believe a hold that's in the page but out of sight, because the page is drawn some way it doesn't know", () => {
    const html = "<table><tr><th>Hold Type</th></tr><tr><td>Made-Up Stale Hold</td></tr></table>";

    expect(readHoldsPage({ html, text: "Nothing to see" })).toBeNull();
  });

  it("takes a single row saying there are none as none", () => {
    const html = "<table><tr><th>Hold Type</th><th>Reason</th></tr><tr><td colspan=2>No holds exist</td></tr></table>";

    expect(readHoldsPage(pageFrom(html))).toEqual([]);
  });

  it("keeps identical rows, so that the count isn't short", () => {
    const row = "<tr><td>Made-Up Bursar Hold</td></tr>";

    expect(readHoldsPage(pageFrom(`<table><tr><th>Hold</th></tr>${row}${row}</table>`))).toHaveLength(2);
  });
});

describe("the balance on the Cost & Aid page", () => {
  it("reads the balance, and no other amount", () => {
    expect(readBalancePage(savedPage("balance"))).toEqual({ cents: 123456, credit: false });
  });

  it("reads a balance of nothing as nothing, not as unreadable", () => {
    expect(readBalancePage({ html: "", text: "Account Balance: $0.00" })).toEqual({ cents: 0, credit: false });
  });

  it.each(["Balance: -$50.00", "Balance: ($50.00)", "Balance: $50.00 CR", "Current Balance\n-$50.00"])("reads %j as a credit", (text) => {
    expect(readBalancePage({ html: "", text })).toEqual({ cents: 5000, credit: true });
  });

  it.each([
    ["no balance on the page", "Made-Up Spring 2027 Charges\t$9,999.00"],
    ["a balance with no amount", "Current Balance\nNot available"],
    ["a label with nothing after it", "Current Balance"],
    ["two balances that differ", "Current Balance: $5.00\nAmount Due: $7.00"],
    ["only an amount with no label", "$10.00"],
  ])("gives nothing rather than a guess for %s", (_, text) => {
    expect(readBalancePage({ html: "", text })).toBeNull();
  });

  it("reads two labels for one amount as one balance", () => {
    expect(readBalancePage({ html: "", text: "Current Balance: $5.00\nAmount Due: $5.00" })).toEqual({ cents: 500, credit: false });
  });
});

describe("the registration status", () => {
  it("reads the status and its term", () => {
    expect(readRegistrationPage(savedPage("registration"))).toEqual({ status: "Made-Up Registered Full Time", term: "Spring 2027" });
  });

  it("takes a plain sentence that the Student isn't registered", () => {
    const text = "You are not registered for this term.";

    expect(readRegistrationPage({ html: "", text })).toEqual({ status: text, term: null });
  });

  it.each([
    ["no status on the page", "Register for Classes (Add/Drop)"],
    ["a label with no value", "Registration Status:"],
    ["a placeholder", "Registration Status: -"],
    ["two statuses that differ", "Registration Status: Active\nRegistration Status: Inactive"],
  ])("gives nothing rather than a guess for %s", (_, text) => {
    expect(readRegistrationPage({ html: "", text })).toBeNull();
  });
});

describe("a page that asks for a password", () => {
  it("is somewhere to log in", () => {
    expect(hasPasswordField('<form><input type="password" name="j_password"></form>')).toBe(true);
    expect(hasPasswordField(savedPage("holds").html)).toBe(false);
  });
});

describe("the part of a page the reader goes by", () => {
  const reading = (frames: { url: string; text: string }[], text = "") => ({
    url: "https://tuportal6.temple.edu/group/home/costs-and-aid",
    title: "",
    accessibilitySnapshot: "",
    html: "",
    text,
    frames: frames.map((frame) => ({ ...frame, html: "" })),
  });
  const CHANNELS = "https://tuportal6.temple.edu/html/TEMPLE/apps/tup/Channels/index.jsp?x=1";

  it("is the balance frame, and the words outside it don't count", () => {
    const part = partToRead("balance", reading([{ url: CHANNELS, text: "Your Current Balance\n$20.00" }], "Current Balance: $99.00"));
    expect(readBalancePage(part)).toEqual({ cents: 2000, credit: false });
  });

  it("is nothing when that frame didn't load, however much the page seems to say", () => {
    expect(readBalancePage(partToRead("balance", reading([], "Current Balance: $99.00")))).toBeNull();
  });

  it("isn't another host's frame at the same address, or another app's on the same host", () => {
    const part = partToRead(
      "balance",
      reading([
        { url: "https://elsewhere.example.test/html/TEMPLE/apps/tup/Channels/index.jsp", text: "Current Balance: $99.00" },
        { url: "https://tuportal6.temple.edu/html/TEMPLE/apps/tup/Bursar/TuitionCalculator/index.jsp", text: "Current Balance: $99.00" },
      ]),
    );
    expect(readBalancePage(part)).toBeNull();
  });

  it("gives no answer when two frames disagree", () => {
    const part = partToRead("balance", reading([{ url: CHANNELS, text: "Current Balance: $20.00" }, { url: CHANNELS, text: "Current Balance: $99.00" }]));
    expect(readBalancePage(part)).toBeNull();
  });

  it("is the whole page for a page with no frame named", () => {
    const whole = reading([], "You have no holds");
    expect(partToRead("holds", whole).text).toBe("You have no holds");
  });
});
