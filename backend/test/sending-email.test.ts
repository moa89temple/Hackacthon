import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import type { SendGuard } from "../src/network-guard.ts";
import { settings } from "../src/settings.ts";
import { tumail } from "../src/tumail.ts";
import { TUMAIL_ID } from "../src/tumail-rules.ts";
import { BackendHarness, TEST_CHAT_MODEL } from "./support/backend-harness.ts";
import { haikuFinds, TUTTLEMAN_CONTACT_PAGE } from "./support/office-pages.ts";
import { madeUpSendRequest } from "./support/outlook-send.ts";
import { toolUseBlock } from "./support/scripted-claude.ts";

const OWN_ADDRESS = "student@temple.edu";
const CONTACT_EMAIL = "advising@temple.edu";
const AI_LINE = "Drafted with help from Buddy, an AI assistant";
const SUBJECT = "Hold on my account";
const BODY = "Hello,\n\nI have a hold on my account. Could you help?\n\nThanks,\nMaria";
const FULL_BODY = `${BODY}\n\n${AI_LINE}`;

let backend: BackendHarness;
let contact: any;

const contactPage = (address: string | null) =>
  `<html><head><title>Contact the Advisors</title></head><body><p>${"Words. ".repeat(50)} Write to ${address ?? "us"} for advice.</p></body></html>`;
const contactFound = (address: string | null, name: string) => haikuFinds({ name, kind: "contact", summary: "Helps with holds.", email: address, search_terms: ["hold"] });

async function readContactPages(name: string): Promise<void> {
  await backend.discovery.run();
  contact = backend.guidebook.search("hold", { kind: "contact" }).find((item) => item.name === name);
  backend.claude.requests.length = 0;
}

async function discoverContact(address: string, name = "Academic Advising Office"): Promise<void> {
  backend.web.save(TUTTLEMAN_CONTACT_PAGE, contactPage(address));
  backend.claude.willReply(haikuFinds(), contactFound(address, name), haikuFinds());
  await readContactPages(name);
}

beforeEach(async () => {
  backend = await BackendHarness.start({ sites: { [TUMAIL_ID]: settings.sites[TUMAIL_ID] as Site }, extraConnectionTypes: [tumail] });
  await backend.giveReadPermission(TUMAIL_ID, undefined);
  await discoverContact(CONTACT_EMAIL);
  backend.browser.actions.length = 0;
});

afterEach(async () => {
  await backend.stop();
});

const call = (method: string, path: string, body?: unknown, key: Record<string, string> = backend.deviceHeaders) =>
  fetch(`${backend.url}${path}`, {
    method,
    headers: body === undefined ? key : { ...key, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const sendingNow = async () => ((await (await call("GET", "/sending")).json()) as { sending: any }).sending;
const saveOwnAddress = (address: unknown) => call("PUT", "/sending/own-address", { address });
const goLive = () => call("POST", "/sending/live");
const backToPractice = () => call("POST", "/sending/practice");
const tapBuddySendsIt = (draftId: number) => call("POST", `/drafts/${draftId}/send-card`);

async function makeDraft(words: { subject?: string; body?: string } = {}): Promise<any> {
  backend.claude.willReply(
    {
      content: [toolUseBlock("make_handoff", { contact_id: contact.id, why: "They help Students with holds.", subject: SUBJECT, body: BODY, ...words })],
      stopReason: "tool_use",
    },
    { chunks: ["Here's a Draft."] },
  );
  const events = await backend.sendAndCollect("Help me with my hold");
  return events.find((event) => event.type === "draft_card").draft;
}

async function makeCard(words: { subject?: string; body?: string } = {}): Promise<any> {
  const draft = await makeDraft(words);
  const response = await tapBuddySendsIt(draft.id);
  expect(response.status).toBe(200);
  return ((await response.json()) as { card: any }).card;
}

const approve = (card: any) => backend.approveCard(card.id, { fingerprint: card.fingerprint });
const lineOn = (card: any, label: string) => card.shows.find((line: any) => line.label === label)?.value;
const sends = () => backend.browser.actions.filter((action) => action.type === "send-email") as any[];
const activityKinds = async () => (await backend.activity()).map((entry) => entry.kind);

describe("Buddy sends it", () => {
  beforeEach(async () => {
    await saveOwnAddress(OWN_ADDRESS);
  });

  it("makes an Action card with the exact recipient, subject and body, and sends nothing", async () => {
    const card = await makeCard();

    expect(card.status).toBe("waiting");
    expect(card.canDecide).toBe(true);
    expect(lineOn(card, "To")).toBe(OWN_ADDRESS);
    expect(lineOn(card, "Subject")).toBe(SUBJECT);
    expect(lineOn(card, "Message")).toBe(FULL_BODY);
    expect(sends()).toEqual([]);
    expect(await activityKinds()).toContain("action_card_requested");
  });

  it("appears after the conversation so far, each time it's loaded", async () => {
    const card = await makeCard();
    const history = await backend.history();
    expect(history.at(-1)).toMatchObject({ type: "action_card", card: { id: card.id } });
  });

  it("sends exactly what the card says, once, after the Approve tap", async () => {
    const card = await makeCard();

    const response = await approve(card);
    const after = ((await response.json()) as { card: any }).card;

    expect(after.status).toBe("done");
    expect(sends()).toHaveLength(1);
    expect(sends()[0].email).toEqual({ composeUrl: "https://outlook.office.com/mail/deeplink/compose", to: OWN_ADDRESS, subject: SUBJECT, body: FULL_BODY });
  });

  it("gives the same card to a repeated tap, rather than a second card", async () => {
    const draft = await makeDraft();
    const first = (await (await tapBuddySendsIt(draft.id)).json()) as { card: any };
    const second = (await (await tapBuddySendsIt(draft.id)).json()) as { card: any };
    expect(second.card.id).toBe(first.card.id);
    expect(await backend.history().then((items) => items.filter((item) => item.type === "action_card"))).toHaveLength(1);
  });

  it.each([
    ["sent", "done", async () => {}],
    [
      "sent with no clear answer",
      "unknown",
      async () => {
        backend.browser.nextSend = async (email, guard, beforePressing) => {
          beforePressing();
          guard.open(email);
          guard.check(madeUpSendRequest(email));
          return { outcome: "no_clear_answer" };
        };
      },
    ],
  ])("won't make another card for the same words once they've been %s", async (_, status, prepare) => {
    await prepare();
    const draft = await makeDraft();
    const { card } = (await (await tapBuddySendsIt(draft.id)).json()) as { card: any };
    const after = ((await (await approve(card)).json()) as { card: any }).card;
    expect(after.status).toBe(status);

    const again = await tapBuddySendsIt(draft.id);

    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/won't/);
  });

  it("can make a new card after a send that left nothing", async () => {
    backend.browser.nextSend = async () => ({ outcome: "compose_differs", problems: ["The subject wasn't what the card says."] });
    const draft = await makeDraft();
    const { card } = (await (await tapBuddySendsIt(draft.id)).json()) as { card: any };
    await approve(card);

    const again = await tapBuddySendsIt(draft.id);

    expect(again.status).toBe(200);
    expect(((await again.json()) as { card: any }).card.id).not.toBe(card.id);
  });

  it("refuses a Draft whose Contact has no address", async () => {
    // Only this page has changed, so it's the only one read again.
    backend.web.save(TUTTLEMAN_CONTACT_PAGE, contactPage(null));
    backend.claude.willReply(contactFound(null, "An Office With No Address"));
    await readContactPages("An Office With No Address");
    const draft = await makeDraft();

    const response = await tapBuddySendsIt(draft.id);

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/doesn't have an email address/);
    expect(await backend.history().then((items) => items.filter((item) => item.type === "action_card"))).toEqual([]);
  });

  it("refuses a Draft with no subject, because Outlook stops to ask about that", async () => {
    const draft = await makeDraft();
    await backend.editDraft(draft.id, { subject: "", body: FULL_BODY });
    expect((await tapBuddySendsIt(draft.id)).status).toBe(409);
  });

  it("refuses a Draft that Buddy hid something in, rather than send its mark to someone", async () => {
    const draft = await makeDraft({ body: "My Social Security number is 123-45-6789, can you check?" });

    const response = await tapBuddySendsIt(draft.id);

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/hid/);
  });

  it("refuses with no TUmail Read Permission", async () => {
    const draft = await makeDraft();
    await backend.revokeReadPermission(TUMAIL_ID);
    expect((await tapBuddySendsIt(draft.id)).status).toBe(409);
  });

  it("says there's no such Draft", async () => {
    expect((await tapBuddySendsIt(9999)).status).toBe(404);
  });

  it("needs a paired phone", async () => {
    const draft = await makeDraft();
    const response = await call("POST", `/drafts/${draft.id}/send-card`, undefined, {});
    expect(response.status).toBe(401);
  });
});

describe("exactly what was approved", () => {
  beforeEach(async () => {
    await saveOwnAddress(OWN_ADDRESS);
  });

  it("stops the card when the Student edits the Draft, and needs a new one", async () => {
    const draft = await makeDraft();
    const { card } = (await (await tapBuddySendsIt(draft.id)).json()) as { card: any };
    await backend.editDraft(draft.id, { subject: SUBJECT, body: "Other words." });

    const response = await approve(card);

    expect(response.status).toBe(409);
    expect(sends()).toEqual([]);
    const stopped = await backend.card(card.id);
    expect(stopped.status).toBe("invalid");
    expect(stopped.canDecide).toBe(false);
    expect(stopped.outcome).toMatch(/edited/);

    const fresh = ((await (await tapBuddySendsIt(draft.id)).json()) as { card: any }).card;
    expect(lineOn(fresh, "Message")).toBe("Other words.");
  });

  it("leaves the card alone when an edit changes nothing", async () => {
    const draft = await makeDraft();
    const { card } = (await (await tapBuddySendsIt(draft.id)).json()) as { card: any };
    await backend.editDraft(draft.id, { subject: SUBJECT, body: FULL_BODY });
    expect((await backend.card(card.id)).status).toBe("waiting");
  });

  it("refuses a tap for words the card no longer holds", async () => {
    const card = await makeCard();
    backend.changeStoredCardContent(card.id, { to: "someone-else@temple.edu" });

    expect((await approve(card)).status).toBe(409);

    expect(sends()).toEqual([]);
    expect((await backend.card(card.id)).status).toBe("invalid");
  });

  it("refuses a tap that didn't see this card", async () => {
    const card = await makeCard();
    expect((await backend.approveCard(card.id, { fingerprint: "something else" })).status).toBe(409);
    expect(sends()).toEqual([]);
    expect((await backend.card(card.id)).status).toBe("waiting");
  });

  it("sends nothing when the compose window differs, and says what differed without the words", async () => {
    backend.browser.nextSend = async () => ({ outcome: "compose_differs", problems: ["The To line didn't hold exactly the approved recipient."] });
    const card = await makeCard();

    const after = ((await (await approve(card)).json()) as { card: any }).card;

    expect(after.status).toBe("not_run");
    const finished = (await backend.activity()).find((entry) => entry.kind === "action_not_run");
    expect(finished.detail).toContain("The To line");
  });

  it("stops at the last moment if the mode has changed since the tap", async () => {
    let answer: string | null = "not asked";
    backend.browser.nextSend = async (email, guard, beforePressing) => {
      await goLive();
      answer = beforePressing();
      if (answer) return { outcome: "not_sent", why: answer };
      guard.open(email);
      return { outcome: "sent" };
    };
    const card = await makeCard();

    const after = ((await (await approve(card)).json()) as { card: any }).card;

    expect(answer).toMatch(/Live/);
    expect(after.status).toBe("not_run");
    expect(await activityKinds()).not.toContain("email_send_started");
  });
});

describe("exactly once", () => {
  beforeEach(async () => {
    await saveOwnAddress(OWN_ADDRESS);
  });

  it("sends once when Approve is tapped twice at the same time", async () => {
    let release!: () => void;
    backend.browser.holdSends = new Promise((resolve) => (release = resolve));
    const card = await makeCard();

    const taps = [approve(card), approve(card)];
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await Promise.all(taps);

    expect(sends()).toHaveLength(1);
  });

  it("sends once when Approve is tapped again later, as after a dropped connection", async () => {
    const card = await makeCard();
    await approve(card);

    const again = await approve(card);

    expect(again.status).toBe(200);
    expect(sends()).toHaveLength(1);
    expect(((await again.json()) as { card: any }).card.status).toBe("done");
  });

  it("records that the send has started before anything can press Send", async () => {
    let kindsAtPress: string[] = [];
    backend.browser.nextSend = async (email, guard, beforePressing) => {
      expect(beforePressing()).toBeNull();
      kindsAtPress = await activityKinds();
      guard.open(email);
      guard.check(madeUpSendRequest(email));
      guard.close();
      return { outcome: "sent" };
    };

    await approve(await makeCard());

    expect(kindsAtPress).toContain("email_send_started");
    expect(kindsAtPress).toContain("action_approved");
    expect(kindsAtPress).not.toContain("email_sent");
  });

  it("presses nothing if that can't be recorded", async () => {
    let opened = false;
    backend.browser.nextSend = async (email, guard, beforePressing) => {
      backend.stopActivityWrites();
      try {
        beforePressing();
      } catch {
        return { outcome: "not_sent", why: "It couldn't be recorded." };
      }
      opened = true;
      guard.open(email);
      return { outcome: "sent" };
    };
    await approve(await makeCard()).catch(() => {});
    expect(opened).toBe(false);
  });

  it("can't tell, and won't try again, after a restart partway through", async () => {
    const card = await makeCard();
    backend.stopCardPartway(card.id);

    await backend.restart();

    const after = await backend.card(card.id);
    expect(after.status).toBe("unknown");
    expect(after.outcome).toMatch(/can't tell/);
    await approve(after);
    expect(sends()).toEqual([]);
    expect((await backend.card(card.id)).status).toBe("unknown");
  });

  it("can't tell, and won't try again, when the request went and the answer isn't clear", async () => {
    backend.browser.nextSend = async () => ({ outcome: "no_clear_answer" });
    const card = await makeCard();

    const after = ((await (await approve(card)).json()) as { card: any }).card;

    expect(after.status).toBe("unknown");
    expect(after.outcome).toMatch(/won't try again/);
    await approve(card);
    expect(sends()).toHaveLength(1);
    expect(await activityKinds()).toContain("email_maybe_sent");
    expect(await activityKinds()).not.toContain("email_sent");
  });

  it("can't tell when the browser fails once the guard has been opened, even with nothing seen", async () => {
    backend.browser.nextSend = async (email, guard, beforePressing) => {
      beforePressing();
      guard.open(email);
      throw new Error("The guard lost its connection");
    };
    const after = ((await (await approve(await makeCard())).json()) as { card: any }).card;
    expect(after.status).toBe("unknown");
  });

  it("says nothing was sent when the browser fails before the guard was opened", async () => {
    backend.browser.nextSend = async () => {
      throw new Error("Couldn't reach the browser");
    };
    const after = ((await (await approve(await makeCard())).json()) as { card: any }).card;
    expect(after.status).toBe("not_run");
    expect(after.outcome).toMatch(/Nothing was sent/);
  });

  it("says nothing was sent when pressing Send let nothing through", async () => {
    backend.browser.nextSend = async (email, guard, beforePressing) => {
      beforePressing();
      guard.open(email);
      guard.close();
      return { outcome: "not_sent", why: "Nothing went out when Buddy pressed Send." };
    };
    const after = ((await (await approve(await makeCard())).json()) as { card: any }).card;
    expect(after.status).toBe("not_run");
    expect(await activityKinds()).not.toContain("email_sent");
  });

  it("asks the Student to log in when the login has gone, and sends nothing", async () => {
    backend.browser.nextSend = async () => ({ outcome: "login_needed" });
    const after = ((await (await approve(await makeCard())).json()) as { card: any }).card;
    expect(after.status).toBe("not_run");
    expect(after.outcome).toMatch(/Log in to TUmail/);
  });

  it("leaves the card waiting while the Student is in control of the browser", async () => {
    const card = await makeCard();
    await backend.startTakeover(TUMAIL_ID);

    const response = await approve(card);

    expect(response.status).toBe(409);
    expect(sends()).toEqual([]);
    expect((await backend.card(card.id)).status).toBe("waiting");
  });

  it("leaves the card waiting if TUmail's Read Permission has gone, and sends nothing", async () => {
    const card = await makeCard();
    await backend.revokeReadPermission(TUMAIL_ID);

    expect((await approve(card)).status).toBe(409);
    expect(sends()).toEqual([]);
  });

  it("does nothing when it's declined", async () => {
    const card = await makeCard();
    await backend.declineCard(card.id);
    expect((await approve(card)).status).toBe(409);
    expect(sends()).toEqual([]);
  });
});

describe("the guard around a send", () => {
  beforeEach(async () => {
    await saveOwnAddress(OWN_ADDRESS);
  });

  const usingGuard = (use: (guard: SendGuard, email: any) => void) => {
    let seen!: SendGuard;
    backend.browser.nextSend = async (email, guard, beforePressing) => {
      seen = guard;
      beforePressing();
      use(guard, email);
      return { outcome: "sent" };
    };
    return () => seen;
  };

  it("is shut until the routine opens it, and shut for good afterwards", async () => {
    let before: boolean | undefined;
    const guard = usingGuard((inner, email) => {
      before = inner.check(madeUpSendRequest(email)).allowed;
      inner.open(email);
      inner.check(madeUpSendRequest(email));
    });

    await approve(await makeCard());

    expect(before).toBe(false);
    const email = { to: OWN_ADDRESS, subject: SUBJECT, body: FULL_BODY };
    expect(guard().check(madeUpSendRequest(email)).allowed).toBe(false);
    expect(guard().progress()).toBe("sent");
  });

  it("is shut afterwards when the routine failed with it open", async () => {
    let seen!: SendGuard;
    backend.browser.nextSend = async (email, guard, beforePressing) => {
      seen = guard;
      beforePressing();
      guard.open(email);
      throw new Error("Something went wrong after opening it");
    };

    await approve(await makeCard());

    const email = { to: OWN_ADDRESS, subject: SUBJECT, body: FULL_BODY };
    expect(seen.check(madeUpSendRequest(email)).allowed).toBe(false);
  });

  it("gets only the approved email, whatever is in the Draft by then", async () => {
    const card = await makeCard();
    let opened: any;
    backend.browser.nextSend = async (email, guard, beforePressing) => {
      beforePressing();
      opened = email;
      guard.open(email);
      return { outcome: "sent" };
    };

    await approve(card);

    expect(opened.to).toBe(OWN_ADDRESS);
  });

  it("leaves reading as shut as it was, after a send", async () => {
    await approve(await makeCard());
    const email = { to: OWN_ADDRESS, subject: SUBJECT, body: FULL_BODY };
    await expect(backend.browserAccess.read("https://outlook.office.com/mail/deeplink/compose")).rejects.toThrow();
    backend.browser.savedPages.set("https://outlook.office.com/mail/inbox", {
      title: "Inbox",
      text: "",
      accessibilitySnapshot: "",
      alsoRequests: [madeUpSendRequest(email) as any],
    });
    backend.browser.actions.length = 0;
    await backend.browserAccess.read("https://outlook.office.com/mail/inbox");
    expect(sends()).toEqual([]);
  });
});

describe("Practice mode", () => {
  it("is on by default, with no address known", async () => {
    expect(await sendingNow()).toEqual({ mode: "practice", ownAddress: null });
  });

  it("stays on across a restart", async () => {
    await saveOwnAddress(OWN_ADDRESS);
    await backend.restart();
    expect(await sendingNow()).toEqual({ mode: "practice", ownAddress: OWN_ADDRESS });
  });

  it("makes no card and sends nothing with no address for the Student, and never uses the real recipient", async () => {
    const draft = await makeDraft();

    const response = await tapBuddySendsIt(draft.id);

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toMatch(/You tab/);
    expect(error).not.toContain(CONTACT_EMAIL);
    expect(await backend.history().then((items) => items.filter((item) => item.type === "action_card"))).toEqual([]);
    expect(sends()).toEqual([]);
  });

  it("replaces the recipient with the Student's own address, and shows who it will really go to", async () => {
    await saveOwnAddress(OWN_ADDRESS);

    const card = await makeCard();

    expect(card.title).toMatch(/practice/i);
    expect(lineOn(card, "To")).toBe(OWN_ADDRESS);
    expect(lineOn(card, "Practice mode")).toMatch(/you/);
    expect(lineOn(card, "In Live, this would go to")).toContain(CONTACT_EMAIL);

    await approve(card);

    expect(sends()[0].email.to).toBe(OWN_ADDRESS);
  });

  it("sends only to the Student's own address, even if the guard is asked about the real recipient", async () => {
    await saveOwnAddress(OWN_ADDRESS);
    let allowed: boolean | undefined;
    backend.browser.nextSend = async (email, guard, beforePressing) => {
      beforePressing();
      guard.open(email);
      allowed = guard.check(madeUpSendRequest({ ...email, to: CONTACT_EMAIL })).allowed;
      guard.close();
      return { outcome: "not_sent", why: "The guard stopped it." };
    };

    await approve(await makeCard());

    expect(allowed).toBe(false);
  });

  it.each([["someone@gmail.com"], ["not an address"], ["a@temple.edu.evil.test"], [""], [42]])("won't take %j as the Student's TUmail address", async (address) => {
    const response = await saveOwnAddress(address);
    expect(response.status).toBe(400);
    expect((await sendingNow()).ownAddress).toBeNull();
  });

  it("keeps the address in lower case", async () => {
    await saveOwnAddress("  Student@Temple.EDU ");
    expect((await sendingNow()).ownAddress).toBe(OWN_ADDRESS);
  });

  it("stops a waiting card when the Student's address changes", async () => {
    await saveOwnAddress(OWN_ADDRESS);
    const card = await makeCard();
    await saveOwnAddress("other@temple.edu");

    expect((await approve(card)).status).toBe(409);

    expect(sends()).toEqual([]);
    expect((await backend.card(card.id)).status).toBe("invalid");
  });
});

describe("switching between Practice and Live", () => {
  beforeEach(async () => {
    await saveOwnAddress(OWN_ADDRESS);
  });

  it("needs a paired phone", async () => {
    const response = await call("POST", "/sending/live", undefined, {});
    expect(response.status).toBe(401);
    expect((await sendingNow()).mode).toBe("practice");
  });

  it("records the switch to Live in Activity, once, and back again", async () => {
    await goLive();
    await goLive();
    expect((await sendingNow()).mode).toBe("live");
    expect((await backend.activity()).filter((entry) => entry.kind === "sending_mode_changed")).toHaveLength(1);

    await backToPractice();
    expect((await sendingNow()).mode).toBe("practice");
    const entries = (await backend.activity()).filter((entry) => entry.kind === "sending_mode_changed");
    expect(entries.map((entry) => entry.title).join(" ")).toMatch(/Live/);
    expect(entries.map((entry) => entry.title).join(" ")).toMatch(/Practice/);
  });

  it("stays Live across a restart, because only the Student changes it", async () => {
    await goLive();
    await backend.restart();
    expect((await sendingNow()).mode).toBe("live");
  });

  it("in Live, sends to the Contact, and the card says so", async () => {
    await goLive();
    const card = await makeCard();

    expect(card.title).not.toMatch(/practice/i);
    expect(lineOn(card, "To")).toBe(CONTACT_EMAIL);
    await approve(card);
    expect(sends()[0].email.to).toBe(CONTACT_EMAIL);
    const sent = (await backend.activity()).find((entry) => entry.kind === "email_sent");
    expect(sent.detail).toContain(CONTACT_EMAIL);
  });

  it("stops a card from Practice as soon as the mode changes, and it needs a new one", async () => {
    const draft = await makeDraft();
    const { card } = (await (await tapBuddySendsIt(draft.id)).json()) as { card: any };
    await goLive();

    expect((await backend.card(card.id)).status).toBe("invalid");
    expect((await approve(card)).status).toBe(409);
    expect(sends()).toEqual([]);

    const fresh = ((await (await tapBuddySendsIt(draft.id)).json()) as { card: any }).card;
    expect(lineOn(fresh, "To")).toBe(CONTACT_EMAIL);
    expect(fresh.fingerprint).not.toBe(card.fingerprint);
  });

  it("stops a card from Live the same way", async () => {
    await goLive();
    const card = await makeCard();
    await backToPractice();
    expect((await approve(card)).status).toBe(409);
    expect(sends()).toEqual([]);
  });

  it("stops a card even when the mode has gone there and back", async () => {
    const card = await makeCard();
    await goLive();
    await backToPractice();
    expect((await backend.card(card.id)).status).toBe("invalid");
    expect((await approve(card)).status).toBe(409);
    expect(sends()).toEqual([]);
  });
});

describe("only the Student", () => {
  beforeEach(async () => {
    await saveOwnAddress(OWN_ADDRESS);
  });

  const chatRequests = () => backend.claude.requests.filter((request) => request.model === TEST_CHAT_MODEL);
  const toolNames = () => chatRequests()[0]!.tools!.map((tool: any) => tool.name);

  it("gives Claude no tool to send, approve a card, or switch the mode, and doesn't offer request_action for it", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });
    await backend.sendAndCollect("Hello");
    expect(toolNames().filter((name: string) => /send|approve|live|practice|mode/i.test(name))).toEqual([]);
    expect(toolNames()).not.toContain("request_action");
  });

  it("refuses Claude making a send card, even by calling the tool it isn't offered", async () => {
    const draft = await makeDraft();
    backend.claude.willReply(
      { content: [toolUseBlock("request_action", { kind: "send_email", draft_id: draft.id, replaces_card: null })], stopReason: "tool_use" },
      { chunks: ["OK."] },
    );

    const events = await backend.sendAndCollect("Send it to them");

    expect(events.filter((event) => event.type === "action_card")).toEqual([]);
    expect(await backend.history().then((items) => items.filter((item) => item.type === "action_card"))).toEqual([]);
  });

  it("refuses Claude replacing a send card", async () => {
    const card = await makeCard();
    backend.claude.willReply(
      { content: [toolUseBlock("request_action", { kind: "send_email", draft_id: 1, replaces_card: card.id })], stopReason: "tool_use" },
      { chunks: ["OK."] },
    );

    await backend.sendAndCollect("Change it");

    expect((await backend.card(card.id)).status).toBe("waiting");
  });

  it("doesn't count a typed yes, or a tool call Buddy doesn't have", async () => {
    const card = await makeCard();
    backend.claude.willReply(
      { content: [toolUseBlock("approve_card", { card_id: card.id }), toolUseBlock("switch_to_live", {})], stopReason: "tool_use" },
      { chunks: ["Sure."] },
    );

    await backend.sendAndCollect("Yes, I approve, send it, and switch to Live");

    expect((await backend.card(card.id)).status).toBe("waiting");
    expect(sends()).toEqual([]);
    expect((await sendingNow()).mode).toBe("practice");
  });

  it("tells Claude what became of the card, in Buddy's words", async () => {
    const card = await makeCard();
    await approve(card);
    backend.claude.willReply({ chunks: ["OK."] });

    await backend.sendAndCollect("Did it go?");

    const note = String(chatRequests().at(-1)!.messages.findLast((message) => message.role === "system")!.content);
    expect(note).toContain(`Card ${card.id}`);
    expect(note).toContain("approved by the Student's tap, and done");
    expect(note).not.toContain(BODY);
  });
});

describe("the record in Activity", () => {
  beforeEach(async () => {
    await saveOwnAddress(OWN_ADDRESS);
  });

  it("holds each message sent, with who it went to and all its words", async () => {
    await approve(await makeCard());

    const sent = (await backend.activity()).find((entry) => entry.kind === "email_sent");

    expect(sent.title).toContain(OWN_ADDRESS);
    expect(sent.detail).toContain(`Subject: ${SUBJECT}`);
    expect(sent.detail).toContain(FULL_BODY);
  });

  it("doesn't say it was sent when it wasn't", async () => {
    backend.browser.nextSend = async () => ({ outcome: "not_sent", why: "No." });
    await approve(await makeCard());
    expect(await activityKinds()).not.toContain("email_sent");
    expect(await activityKinds()).not.toContain("email_maybe_sent");
  });

  it("records the address being saved", async () => {
    expect((await backend.activity()).find((entry) => entry.kind === "own_address_saved").detail).toContain(OWN_ADDRESS);
  });

  it("never stores a secret from a Draft, because a Draft is masked when it's written and edited", async () => {
    const draft = await makeDraft();
    await backend.editDraft(draft.id, { subject: SUBJECT, body: "Plain words. My card is 4111 1111 1111 1111." });

    expect((await tapBuddySendsIt(draft.id)).status).toBe(409);

    expect(backend.storageContains("4111 1111 1111 1111")).toBe(false);
  });
});

describe("the Handoff", () => {
  it("tells Claude this route is the Student's tap, and doesn't let it say a Draft went", async () => {
    await makeDraft();
    const system = JSON.stringify(backend.claude.requests.find((request) => request.model === TEST_CHAT_MODEL)!.system);
    expect(system).toContain("Buddy sends it");
    expect(system).toMatch(/Only the Student can switch to Live/);
  });

  it("offers it through the same Action card", async () => {
    await saveOwnAddress(OWN_ADDRESS);
    const card = await makeCard();
    expect(card.kind).toBe("send_email");
    expect(await backend.card(card.id)).toMatchObject({ id: card.id, kind: "send_email" });
  });
});
