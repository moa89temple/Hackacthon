import { describe, expect, it } from "vitest";
import { readInboxPage, readMessagePage } from "../src/tumail-pages.ts";
import { inboxHtml, messageHtml, rowHtml, savedTumailHtml } from "./support/tumail-pages.ts";

describe("reading the inbox's list", () => {
  it("gives each message's id and sender's address, newest first, from the page as the app built it", () => {
    const rows = readInboxPage(savedTumailHtml("inbox"))!;

    expect(rows.map((row) => [row.id, row.address])).toEqual([
      ["AAQkMadeUpAdvisor=", "made.up.advisor@temple.edu"],
      ["AAQkMadeUpHospital=", "clinic@tuhs.temple.edu"],
      ["AAQkMadeUpContact=", "partner@elsewhere.test"],
      ["AAQkMadeUpStranger=", "stranger@elsewhere.test"],
      ["AAQkMadeUpLookalike=", "dean@temple.edu.evil.test"],
    ]);
  });

  it("finds the sender past the row's own controls and an empty title, as in a real inbox", () => {
    const row = `<div role="option" data-convid="a" aria-label="Unread Made-up">
      <button title="dean@temple.edu"></button>
      <div role="checkbox" title="dean@temple.edu"><span title="dean@temple.edu" role="img"></span></div>
      <div title=""></div>
      <span title="someone@evil.test">Made-Up Sender</span>
      <span title="dean@temple.edu">A subject with an address in it</span>
    </div>`;

    expect(readInboxPage(inboxHtml(row))![0]).toMatchObject({ address: "someone@evil.test", name: "Made-Up Sender" });
  });

  it("says which are unread, and when the page can't say", () => {
    const rows = readInboxPage(savedTumailHtml("inbox"))!;
    expect(rows[0]!.unread).toBe(true);
    expect(rows[1]!.unread).toBe(false);

    const noLabel = readInboxPage(inboxHtml('<div data-convid="a"><span title="x@temple.edu">X</span></div>'))!;
    expect(noLabel[0]!.unread).toBeNull();
  });

  it("gives when it came, as the page writes it", () => {
    expect(readInboxPage(savedTumailHtml("inbox"))![0]!.shownAt).toBe("Mon 11/2/2026 10:32 AM");
  });

  it("goes by the sender's own place in the row, so that a subject can't pass for an address", () => {
    const rows = readInboxPage(
      inboxHtml('<div role="option" data-convid="a"><span title="Made-Up Name">Made-Up Name</span><span title="dean@temple.edu">dean@temple.edu</span></div>'),
    )!;

    expect(rows[0]!.address).toBeNull();
  });

  it("marks a message changed when a new reply arrives in its conversation", () => {
    const row = (words: string, when: string) => readInboxPage(inboxHtml(rowHtml({ id: "a", address: "x@temple.edu", words, when })))![0]!;

    expect(row("first", "Mon 11/2/2026 10:32 AM").fingerprint).toBe(row("first", "Mon 11/2/2026 10:32 AM").fingerprint);
    expect(row("first", "Mon 11/2/2026 10:32 AM").fingerprint).not.toBe(row("second", "Mon 11/2/2026 10:32 AM").fingerprint);
    expect(row("first", "Mon 11/2/2026 10:32 AM").fingerprint).not.toBe(row("first", "Tue 11/3/2026 9:00 AM").fingerprint);
  });

  it("doesn't mark it changed because the list writes the same date another way as it gets older", () => {
    const row = (shown: string) =>
      readInboxPage(inboxHtml(`<div data-convid="a"><span title="x@temple.edu">X</span><span title="Mon 11/2/2026 10:32 AM">${shown}</span></div>`))![0]!;

    expect(row("10:32 AM").fingerprint).toBe(row("Mon 10:32 AM").fingerprint);
  });

  it("reads an inbox the app says is empty as empty", () => {
    expect(readInboxPage('<div role="listbox" aria-label="Message list"><p>Nothing in inbox</p></div>')).toEqual([]);
  });

  it.each([
    ["a page with nothing the reader knows", "<html><body><h1>Made-up page</h1></body></html>"],
    ["the app before it has built the list", '<html><body><div id="loading"></div></body></html>'],
    ["a list with no rows and no word that it's empty", '<div role="listbox" aria-label="Message list"><p>Something went wrong</p></div>'],
    ["a sign-in form", '<form><input name="loginfmt"></form>'],
  ])("fails loudly on %s, rather than call the inbox empty", (_, html) => {
    expect(readInboxPage(html)).toBeNull();
  });

  it("won't use an id that couldn't go in an address", () => {
    expect(readInboxPage(inboxHtml('<div data-convid="../../compose"><span title="x@temple.edu">X</span></div>'))).toBeNull();
  });
});

describe("reading one message", () => {
  it("gives who it's from, its subject, when it came and its words, and nothing from the list beside it", () => {
    const message = readMessagePage(savedTumailHtml("message-advisor"));

    expect(message).toEqual({
      outcome: "read",
      address: "made.up.advisor@temple.edu",
      name: "Made-Up Advisor",
      subject: "Re: Spring plan",
      shownAt: "Mon 11/2/2026 10:32 AM",
      words: "Hi, happy to meet on Thursday at 2 to go over your spring plan. Made-Up Advisor",
    });
    expect(JSON.stringify(message)).not.toContain("MARKER");
  });

  it("leaves out words kept out of sight, where a message could hide what the Student would never see", () => {
    const message = readMessagePage(
      messageHtml({
        from: "X &lt;x@temple.edu&gt;",
        body: `<p>Shown words.</p>
          <p style="display:none">Hidden one.</p>
          <p style="visibility: hidden">Hidden two.</p>
          <p style="font-size:0">Hidden three.</p>
          <p style="font-size: 0px">Hidden four.</p>
          <p hidden>Hidden five.</p>
          <script>hidden six</script>
          <style>hidden seven</style>`,
      }),
    );

    expect(message).toMatchObject({ words: "Shown words." });
  });

  it("goes by the address and not by a display name that looks like one", () => {
    const message = readMessagePage(messageHtml({ from: "dean@temple.edu &lt;someone@evil.test&gt;", body: "<p>Words.</p>" }));

    expect(message).toMatchObject({ outcome: "read", address: "someone@evil.test" });
  });

  it("goes by the sender of the message shown, when others in its conversation are collapsed above it", () => {
    const html = `<div aria-label="Reading Pane">
      <div role="heading"><span>A subject</span></div>
      <div aria-label="From: Earlier">Earlier &lt;earlier@elsewhere.test&gt;</div>
      <div aria-label="From: Shown">Shown &lt;shown@temple.edu&gt;</div>
      <div aria-label="Message body"><p>Words.</p></div>
    </div>`;

    expect(readMessagePage(html)).toMatchObject({ address: "shown@temple.edu" });
  });

  it("doesn't take a sender from inside the words", () => {
    const html = `<div aria-label="Reading Pane"><div role="heading">A subject</div>
      <div aria-label="Message body"><div aria-label="From: Dean" title="dean@temple.edu">dean@temple.edu</div><p>Words.</p></div>
    </div>`;

    expect(readMessagePage(html)).toEqual({ outcome: "no_sender" });
  });

  it("doesn't take when it came from inside the words", () => {
    const html = `<div aria-label="Reading Pane"><div aria-label="From: A">A &lt;a@temple.edu&gt;</div>
      <div aria-label="Message body"><div data-testid="SentReceivedSavedTime">Made-up date from the email</div><p>Words.</p></div>
    </div>`;

    expect(readMessagePage(html)).toMatchObject({ outcome: "read", shownAt: null });
  });

  it("doesn't take an address on its own in the words for the sender, because a display name could look like one", () => {
    expect(readMessagePage(messageHtml({ from: "dean@temple.edu", body: "<p>Words.</p>" }))).toEqual({ outcome: "no_sender" });
  });

  it("takes it from the header's own title", () => {
    const html = `<div aria-label="Reading Pane"><div aria-label="From: Jane" title="jane@temple.edu">Jane</div><div aria-label="Message body"><p>Words.</p></div></div>`;

    expect(readMessagePage(html)).toMatchObject({ outcome: "read", address: "jane@temple.edu", name: "jane@temple.edu" });
  });

  describe("a conversation with several messages open, each with its own header", () => {
    const fromRow = { address: "jane.advisor@temple.edu", name: "Jane Advisor" };
    const open = (from: string, time: string, words: string) =>
      `<div aria-label="From: ${from}">${from}</div><div data-testid="SentReceivedSavedTime">${time}</div><div aria-label="Message body"><p>${words}</p></div>`;
    const pane = (...messages: string[]) => `<div aria-label="Reading Pane"><span role="heading">Made-up subject</span>${messages.join("")}</div>`;

    it("reads only the row's sender's, with its own time, and nobody else's words", () => {
      const message = readMessagePage(pane(open("Someone Else", "Mon 11/2/2026 1:00 PM", "MARKEROUTSIDER"), open("Jane Advisor", "Sun 11/1/2026 9:00 AM", "Her words.")), fromRow);

      expect(message).toMatchObject({ outcome: "read", address: "jane.advisor@temple.edu", subject: "Made-up subject", shownAt: "Sun 11/1/2026 9:00 AM", words: "Her words." });
      expect(JSON.stringify(message)).not.toContain("MARKEROUTSIDER");
    });

    it("goes by the address when that's what a header shows", () => {
      const message = readMessagePage(pane(open("Someone Else", "x", "MARKEROUTSIDER"), open("Jane &lt;jane.advisor@temple.edu&gt;", "y", "Her words.")), fromRow);

      expect(message).toMatchObject({ outcome: "read", words: "Her words." });
    });

    it("reads none if the row's sender wrote more than one, because it can't tell which is newest", () => {
      expect(readMessagePage(pane(open("Jane Advisor", "x", "One."), open("Jane Advisor", "y", "Two.")), fromRow)).toEqual({ outcome: "several_open" });
    });

    it("reads none if the row's sender wrote none of them", () => {
      expect(readMessagePage(pane(open("Someone Else", "x", "One."), open("Another Person", "y", "Two.")), fromRow)).toEqual({ outcome: "several_open" });
    });

    it("isn't fooled by an email that draws its own header and message inside itself", () => {
      const madeUp = `<div aria-label="From: Jane Advisor">Jane Advisor</div><div aria-label="Message body">MARKERFORGED</div>`;

      expect(readMessagePage(pane(open("Someone Else", "x", madeUp)), fromRow)).toEqual({ outcome: "several_open" });
    });

    it("isn't fooled by a header an email draws in itself, ahead of the next real message", () => {
      const forgedInFirst = `<div aria-label="From: Jane Advisor">Jane Advisor</div>`;
      const message = readMessagePage(pane(open("Someone Else", "x", forgedInFirst), open("Another Person", "y", "MARKERFORGED")), fromRow);

      expect(message).toEqual({ outcome: "several_open" });
    });
  });

  describe("a message that shows only a name, as Outlook does for someone in Temple's own directory", () => {
    const fromRow = { address: "jane.advisor@temple.edu", name: "Jane Advisor" };

    it("is the row's sender's if it shows exactly the name the row does", () => {
      const message = readMessagePage(messageHtml({ from: "jane  ADVISOR", body: "<p>Words.</p>" }), fromRow);

      expect(message).toMatchObject({ outcome: "read", address: "jane.advisor@temple.edu", name: "jane ADVISOR", words: "Words." });
    });

    it("isn't if it shows another name, as when a conversation's open message is someone else's", () => {
      expect(readMessagePage(messageHtml({ from: "Someone Else", body: "<p>Words.</p>" }), fromRow)).toEqual({ outcome: "no_sender" });
    });

    it("isn't if the name looks like an address, which anyone can set a display name to", () => {
      const row = { address: "dean@temple.edu", name: "dean@temple.edu" };

      expect(readMessagePage(messageHtml({ from: "dean@temple.edu", body: "<p>Words.</p>" }), row)).toEqual({ outcome: "no_sender" });
    });

    it("isn't if the row has no address to go by", () => {
      expect(readMessagePage(messageHtml({ from: "Jane Advisor", body: "<p>Words.</p>" }), { address: null, name: null })).toEqual({ outcome: "no_sender" });
    });

    it("goes by the address when a message shows one, even with the row's name on it", () => {
      const message = readMessagePage(messageHtml({ from: "Jane Advisor &lt;someone@evil.test&gt;", body: "<p>Words.</p>" }), fromRow);

      expect(message).toMatchObject({ outcome: "read", address: "someone@evil.test" });
    });
  });

  it("says so when it can't see who it's from, so that the words aren't kept", () => {
    const html = messageHtml({ from: "Made-Up Name With No Address", body: "<p>Words.</p>" });

    expect(readMessagePage(html)).toEqual({ outcome: "no_sender" });
  });

  it("says so when it shows several messages open at once, because it can't tell whose words are whose", () => {
    const html = `<div aria-label="Reading Pane"><div aria-label="From: A">A &lt;a@temple.edu&gt;</div><div aria-label="Message body">One.</div>
      <div aria-label="From: B">B &lt;b@elsewhere.test&gt;</div><div aria-label="Message body">Two.</div></div>`;

    expect(readMessagePage(html)).toEqual({ outcome: "several_open" });
  });

  it.each([
    ["a page with nothing the reader knows", "<h1>Made-up page</h1>"],
    ["the list with no message open", savedTumailHtml("inbox")],
    ["a pane with no body", '<div aria-label="Reading Pane"><div aria-label="From: A">A &lt;a@temple.edu&gt;</div></div>'],
  ])("fails loudly on %s", (_, html) => {
    expect(readMessagePage(html)).toEqual({ outcome: "not_recognized" });
  });
});
