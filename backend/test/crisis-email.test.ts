import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Site } from "../src/browser-access.ts";
import { settings } from "../src/settings.ts";
import { tumail } from "../src/tumail.ts";
import { TUMAIL_ID } from "../src/tumail-rules.ts";
import { BackendHarness } from "./support/backend-harness.ts";
import { haikuFinds, TUTTLEMAN_CONTACT_PAGE, WRITING_CENTER_PAGE } from "./support/office-pages.ts";
import { toolUseBlock } from "./support/scripted-claude.ts";
import { expireTumailLogin, saveTumailPages } from "./support/tumail-pages.ts";

// All made up, and only ever handed to a recording browser.
const OWN_ADDRESS = "student@temple.edu";
const FRIEND = { name: "Sam", address: "sam.madeup@example.com" };
const WORDS = { subject: "I could use some help", body: "Hi,\n\nCan you reach out to me?" };
const CRISIS_MESSAGE = "I want to kill myself";

let backend: BackendHarness;

const startBackend = () => BackendHarness.start({ sites: { [TUMAIL_ID]: settings.sites[TUMAIL_ID] as Site }, extraConnectionTypes: [tumail] });

beforeEach(async () => {
  backend = await startBackend();
  await backend.giveReadPermission(TUMAIL_ID, undefined);
  await call("PUT", "/sending/own-address", { address: OWN_ADDRESS });
  backend.claude.willReply({ chunks: ["I'm here with you."] });
  await backend.sendAndCollect(CRISIS_MESSAGE);
  backend.browser.actions.length = 0;
});

afterEach(async () => {
  await backend.stop();
});

function call(method: string, path: string, body?: unknown) {
  return fetch(`${backend.url}${path}`, {
    method,
    headers: body === undefined ? backend.deviceHeaders : { ...backend.deviceHeaders, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const goLive = () => call("POST", "/sending/live");
const askForCard = (who: Record<string, unknown> = FRIEND, words: Record<string, unknown> = WORDS) => call("POST", "/crisis-email/card", { ...who, ...words });

async function makeCard(who: Record<string, unknown> = FRIEND, words: Record<string, unknown> = WORDS): Promise<any> {
  const response = await askForCard(who, words);
  expect(response.status).toBe(200);
  return ((await response.json()) as { card: any }).card;
}

/** A read finds Outlook sending the browser to sign in, which is how Buddy learns the login has gone. */
async function expireLogin() {
  saveTumailPages(backend.browser);
  expireTumailLogin(backend.browser);
  await call("POST", `/connections/${TUMAIL_ID}/read`);
}

const approve = (card: any) => backend.approveCard(card.id, { fingerprint: card.fingerprint });
const lineOn = (card: any, label: string) => card.shows.find((line: any) => line.label === label)?.value;
const sends = () => backend.browser.actions.filter((action) => action.type === "send-email") as any[];
const offer = async () => ((await (await call("GET", "/crisis-email/offer")).json()) as { offer: any }).offer;
const errorIn = async (response: Response) => ((await response.json()) as { error: string }).error;

describe("emailing someone the Student chose, from the Crisis card", () => {
  it("only makes a card, and sends nothing without the Approve tap", async () => {
    const card = await makeCard();

    expect(card.status).toBe("waiting");
    expect(card.canDecide).toBe(true);
    expect(lineOn(card, "Subject")).toBe(WORDS.subject);
    expect(lineOn(card, "Message")).toBe(WORDS.body);
    expect(sends()).toEqual([]);
    expect((await backend.history()).at(-1)).toMatchObject({ type: "action_card", card: { id: card.id } });
  });

  it("gives the same card to a repeated tap, rather than a second card", async () => {
    const first = await makeCard();
    const second = await makeCard();
    expect(second.id).toBe(first.id);
  });

  it("sends nothing on a Decline, or when the card is left to expire", async () => {
    const declined = await makeCard();
    await call("POST", `/action-cards/${declined.id}/decline`);
    expect((await approve(declined)).status).toBe(409);

    const expired = await makeCard({ ...FRIEND, name: "Alex" });
    backend.clock.moveForward(25 * 60 * 60_000);
    expect((await approve(expired)).status).toBe(409);

    expect(sends()).toEqual([]);
  });

  it("doesn't count a typed yes, or anything Claude asks for", async () => {
    await makeCard();
    backend.claude.willReply(
      { content: [toolUseBlock("request_action", { kind: "send_email", crisis_email: { ...FRIEND, ...WORDS } })], stopReason: "tool_use" },
      { chunks: ["You'll need to tap Approve."] },
    );

    const events = await backend.sendAndCollect("yes, send it to Sam at sam.madeup@example.com");

    expect(events.filter((event) => event.type === "action_card")).toEqual([]);
    expect(sends()).toEqual([]);
  });

  it("won't send the same words twice, and says so without talking about a Draft, which this has none of", async () => {
    await approve(await makeCard());

    const response = await askForCard();

    expect(response.status).toBe(409);
    const why = await errorIn(response);
    expect(why).toContain("won't do it again");
    expect(why).not.toContain("Draft");
    expect(sends()).toHaveLength(1);
  });

  it("is refused without the paired phone's key", async () => {
    const response = await fetch(`${backend.url}/crisis-email/card`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...FRIEND, ...WORDS }),
    });
    expect(response.status).toBe(401);
    expect((await backend.history()).filter((item) => item.type === "action_card")).toEqual([]);
  });

  it("makes no card when there's no conversation for it to go in", async () => {
    const fresh = await startBackend();
    try {
      await fresh.giveReadPermission(TUMAIL_ID, undefined);
      await fetch(`${fresh.url}/sending/live`, { method: "POST", headers: fresh.deviceHeaders });
      const response = await fetch(`${fresh.url}/crisis-email/card`, {
        method: "POST",
        headers: { ...fresh.deviceHeaders, "content-type": "application/json" },
        body: JSON.stringify({ ...FRIEND, ...WORDS }),
      });
      expect(response.status).toBe(409);
      expect(await errorIn(response)).toContain("Crisis card");
    } finally {
      await fresh.stop();
    }
  });

  it("won't take anything but one plain address", async () => {
    for (const address of ["", "not an address", "a@example.com, b@example.com", "Sam <sam@example.com>", 7, undefined]) {
      const response = await askForCard({ address });
      expect(response.status, String(address)).toBe(409);
      expect(await errorIn(response)).toContain("one email address");
    }
    expect((await backend.history()).filter((item) => item.type === "action_card")).toEqual([]);
  });

  it("won't make a card with no subject or no message, or with a secret in it", async () => {
    expect(await errorIn(await askForCard(FRIEND, { ...WORDS, subject: " " }))).toContain("no subject");
    expect(await errorIn(await askForCard(FRIEND, { ...WORDS, body: "" }))).toContain("no message");
    expect(await errorIn(await askForCard(FRIEND, { ...WORDS, body: "My SSN is 123-45-6789" }))).toContain("hid something");
    expect(backend.storageContains("123-45-6789")).toBe(false);
  });

  it("is written down in Activity, as any send is", async () => {
    await approve(await makeCard());
    const kinds = (await backend.activity()).map((entry) => entry.kind);
    expect(kinds).toEqual(expect.arrayContaining(["email_send_started", "email_sent"]));
  });
});

describe("what the email does in each mode", () => {
  it("in Practice mode, goes to the Student's own address, and the card says so plainly and offers Live", async () => {
    const card = await makeCard();

    expect(card.title).toBe("Send a practice email to yourself");
    expect(lineOn(card, "Practice mode")).toBe("This email will go to you, not to Sam. To send it to Sam instead, tap Switch to Live.");
    expect(lineOn(card, "To")).toBe(OWN_ADDRESS);
    expect(lineOn(card, "In Live, this would go to")).toBe(`Sam <${FRIEND.address}>`);
    expect(card.crisisEmail).toEqual({ offersLive: true });

    const after = ((await (await approve(card)).json()) as { card: any }).card;

    expect(after.status).toBe("done");
    expect(sends()).toHaveLength(1);
    expect(sends()[0].email).toEqual({ inboxUrl: "https://outlook.office.com/mail/", to: OWN_ADDRESS, ...WORDS });
  });

  it("in Live, goes to who the Student chose, even outside Temple, and offers nothing more", async () => {
    await goLive();
    const card = await makeCard();

    expect(card.title).toBe("Send a real email from your TUmail");
    expect(lineOn(card, "To")).toBe(FRIEND.address);
    expect(card.crisisEmail).toEqual({ offersLive: false });
    expect(sends()).toEqual([]);

    await approve(card);

    expect(sends()).toHaveLength(1);
    expect(sends()[0].email.to).toBe(FRIEND.address);
  });

  it("uses the address as the name when the Student gives no name", async () => {
    await goLive();
    const card = await makeCard({ address: FRIEND.address });
    expect(lineOn(card, "Live")).toBe(`This really goes to ${FRIEND.address}.`);
  });

  it("stops a waiting card if the mode changes, and the old card can't send", async () => {
    const card = await makeCard();
    await goLive();

    expect((await approve(card)).status).toBe(409);

    expect(sends()).toEqual([]);
    expect(((await (await call("GET", `/action-cards/${card.id}`)).json()) as { card: any }).card).toMatchObject({
      status: "invalid",
      outcome: expect.stringContaining("Crisis card"),
    });
  });
});

describe("when the email can't go out", () => {
  it("with TUmail not connected, says so plainly, makes no card and sends nothing, and the Crisis card still shows first", async () => {
    await backend.revokeReadPermission(TUMAIL_ID);

    expect((await offer()).whyNotYet).toBe("TUmail isn't connected, so an email can't go out yet. You can connect it on the You tab.");

    const response = await askForCard();
    expect(response.status).toBe(409);
    expect(await errorIn(response)).toContain("can't go out yet");
    expect(sends()).toEqual([]);

    backend.claude.willReply({ chunks: ["I'm here."] });
    expect((await backend.sendAndCollect(CRISIS_MESSAGE))[0].type).toBe("crisis_card");
  });

  it("with the login expired, says so plainly, makes no card and sends nothing, and the Crisis card still shows first", async () => {
    await expireLogin();

    expect((await offer()).whyNotYet).toBe("Buddy's Browser isn't logged in to TUmail, so an email can't go out yet. Tap Log in to TUmail on the You tab.");

    const response = await askForCard();
    expect(response.status).toBe(409);
    expect(await errorIn(response)).toContain("can't go out yet");
    expect(sends()).toEqual([]);

    backend.claude.willReply({ chunks: ["I'm here."] });
    expect((await backend.sendAndCollect(CRISIS_MESSAGE))[0].type).toBe("crisis_card");
  });

  it("with the login found to have expired only at the Approve tap, says nothing was sent and how to fix it", async () => {
    const card = await makeCard();
    backend.browser.nextSend = async () => ({ outcome: "login_needed" });

    const after = ((await (await approve(card)).json()) as { card: any }).card;

    expect(after.status).toBe("not_run");
    expect(after.outcome).toContain("isn't logged in to TUmail");
    expect(after.outcome).toContain("Nothing was sent.");
    // The Student can try again once they've logged in.
    expect((await makeCard()).id).not.toBe(card.id);
  });

  it("with TUmail revoked while a card waits, the Approve tap sends nothing and says why", async () => {
    const card = await makeCard();
    await backend.revokeReadPermission(TUMAIL_ID);

    const response = await approve(card);

    expect(response.status).toBe(409);
    expect(await errorIn(response)).toContain("Read Permission is off");
    expect(sends()).toEqual([]);
  });

  it("in Practice mode with no address of the Student's, makes no card, and says Live is another way", async () => {
    const fresh = await startBackend();
    try {
      await fresh.giveReadPermission(TUMAIL_ID, undefined);
      fresh.claude.willReply({ chunks: ["I'm here."] });
      await fresh.sendAndCollect(CRISIS_MESSAGE);

      const response = await fetch(`${fresh.url}/crisis-email/card`, {
        method: "POST",
        headers: { ...fresh.deviceHeaders, "content-type": "application/json" },
        body: JSON.stringify({ ...FRIEND, ...WORDS }),
      });

      expect(response.status).toBe(409);
      expect(await errorIn(response)).toContain("switch to Live");
    } finally {
      await fresh.stop();
    }
  });
});

describe("what the Crisis card is told", () => {
  async function discoverTuttleman(email: string | null) {
    backend.web.save(TUTTLEMAN_CONTACT_PAGE, `<html><head><title>Contact Us</title></head><body><p>${"Words. ".repeat(50)} Write to ${email ?? "us"}.</p></body></html>`);
    backend.claude.willReply(haikuFinds(), haikuFinds({ name: "Tuttleman Counseling Services", kind: "contact", summary: "Counseling.", email }), haikuFinds());
    await backend.discovery.run();
  }

  it("has nothing in the way, and the mode, when TUmail is ready", async () => {
    expect(await offer()).toMatchObject({ whyNotYet: null, isLive: false, ownAddress: OWN_ADDRESS, tuttleman: null });
    await goLive();
    expect(await offer()).toMatchObject({ isLive: true });
  });

  it("gives Tuttleman's address only from the Guidebook, with its Source", async () => {
    await discoverTuttleman("counseling.madeup@temple.edu");

    const { tuttleman } = await offer();

    expect(tuttleman.name).toBe("Tuttleman Counseling Services");
    expect(tuttleman.email).toBe("counseling.madeup@temple.edu");
    expect(tuttleman.sources[0].url).toBe(TUTTLEMAN_CONTACT_PAGE);
  });

  it("gives none when the Guidebook has no address for Tuttleman", async () => {
    await discoverTuttleman(null);
    expect((await offer()).tuttleman).toBeNull();
  });

  // The real Let's Talk page gives this for emailing a consent form, so nobody may be reading it for this.
  it("doesn't give the Let's Talk consent form address, the only one Temple's counseling pages publish", async () => {
    await discoverTuttleman("lets.talk@temple.edu");
    expect((await offer()).tuttleman).toBeNull();
  });

  it("doesn't take another Contact with Tuttleman in its name for the counseling service", async () => {
    backend.web.save(TUTTLEMAN_CONTACT_PAGE, `<html><head><title>Contact Us</title></head><body><p>${"Words. ".repeat(50)} Write to learning.madeup@temple.edu.</p></body></html>`);
    backend.claude.willReply(haikuFinds(), haikuFinds({ name: "Tuttleman Learning Center", kind: "contact", summary: "A building.", email: "learning.madeup@temple.edu" }), haikuFinds());
    await backend.discovery.run();

    expect((await offer()).tuttleman).toBeNull();
  });

  it("doesn't take an address for Tuttleman from any page but its own office's", async () => {
    backend.web.save(WRITING_CENTER_PAGE, `<html><head><title>Elsewhere</title></head><body><p>${"Words. ".repeat(50)} Write to elsewhere.madeup@temple.edu.</p></body></html>`);
    backend.claude.willReply(haikuFinds({ name: "Tuttleman Counseling Services", kind: "contact", summary: "Counseling.", email: "elsewhere.madeup@temple.edu" }), haikuFinds(), haikuFinds());
    await backend.discovery.run();

    expect((await offer()).tuttleman).toBeNull();
  });

  it("gives none once Tuttleman has been reported", async () => {
    await discoverTuttleman("counseling.madeup@temple.edu");
    const { tuttleman } = await offer();
    await backend.report(tuttleman.id);
    expect((await offer()).tuttleman).toBeNull();
  });
});

describe("switching to Live from the card", () => {
  const switchToLive = (card: any) => call("POST", `/crisis-email/cards/${card.id}/live`);
  const sendingNow = async () => ((await (await call("GET", "/sending")).json()) as { sending: any }).sending;

  it("switches, stops the old card, and makes a new one that still needs its own tap", async () => {
    const practice = await makeCard();

    const response = await switchToLive(practice);

    expect(response.status).toBe(200);
    const { card } = (await response.json()) as { card: any };
    expect((await sendingNow()).mode).toBe("live");
    expect(card.id).not.toBe(practice.id);
    expect(card.status).toBe("waiting");
    expect(lineOn(card, "To")).toBe(FRIEND.address);
    expect(lineOn(card, "Live")).toBe("This really goes to Sam.");
    expect(lineOn(card, "Subject")).toBe(WORDS.subject);
    expect(lineOn(card, "Message")).toBe(WORDS.body);
    expect(sends()).toEqual([]);

    expect((await approve(practice)).status).toBe(409);
    expect(sends()).toEqual([]);

    await approve(card);
    expect(sends()).toHaveLength(1);
    expect(sends()[0].email.to).toBe(FRIEND.address);
  });

  it("doesn't switch for a card that's no longer waiting", async () => {
    const card = await makeCard();
    await call("POST", `/action-cards/${card.id}/decline`);

    expect((await switchToLive(card)).status).toBe(409);
    expect((await sendingNow()).mode).toBe("practice");
  });

  it("doesn't switch for a card that isn't there", async () => {
    expect((await call("POST", "/crisis-email/cards/999/live")).status).toBe(404);
    expect((await call("POST", "/crisis-email/cards/nope/live")).status).toBe(404);
    expect((await sendingNow()).mode).toBe("practice");
  });

  it("doesn't switch for an ordinary Draft's card, which keeps to the You tab", async () => {
    backend.web.save(TUTTLEMAN_CONTACT_PAGE, `<html><head><title>Contact Us</title></head><body><p>${"Words. ".repeat(50)} Write to advising.madeup@temple.edu.</p></body></html>`);
    backend.claude.willReply(haikuFinds(), haikuFinds({ name: "Advising Office", kind: "contact", summary: "Helps.", email: "advising.madeup@temple.edu", search_terms: ["hold"] }), haikuFinds());
    await backend.discovery.run();
    const contact = backend.guidebook.search("hold", { kind: "contact" })[0]!;
    backend.claude.willReply(
      { content: [toolUseBlock("make_handoff", { contact_id: contact.id, why: "They help.", subject: "Hold", body: "Hello" })], stopReason: "tool_use" },
      { chunks: ["Here's a Draft."] },
    );
    const events = await backend.sendAndCollect("Help me with my hold");
    const { draft } = events.find((event) => event.type === "draft_card");
    const { card } = (await (await call("POST", `/drafts/${draft.id}/send-card`)).json()) as { card: any };

    expect(card.crisisEmail).toBeUndefined();
    expect((await switchToLive(card)).status).toBe(404);
    expect((await sendingNow()).mode).toBe("practice");
  });

  it("says plainly when the new card can't be made, having still switched as asked", async () => {
    const card = await makeCard();
    await expireLogin();

    const response = await switchToLive(card);

    expect(response.status).toBe(409);
    expect(await errorIn(response)).toContain("can't go out yet");
    expect((await sendingNow()).mode).toBe("live");
    expect(sends()).toEqual([]);
  });

  it("is refused without the paired phone's key", async () => {
    const card = await makeCard();
    const response = await fetch(`${backend.url}/crisis-email/cards/${card.id}/live`, { method: "POST" });
    expect(response.status).toBe(401);
    expect((await sendingNow()).mode).toBe("practice");
  });
});

describe("what Claude is told", () => {
  it("in a Crisis, to offer it, that only the card can do it, and that it can't always go", async () => {
    backend.claude.requests.length = 0;
    backend.claude.willReply({ chunks: ["I'm here."] });
    await backend.sendAndCollect(CRISIS_MESSAGE);

    const request = backend.claude.requests.at(-1)!;
    const note = request.messages.at(-1)!.content as string;
    expect(note).toContain("asks whom");
    expect(note).toContain("can't go out yet");
    expect(request.system as string).not.toContain("You can't contact anyone for them");
    expect(request.system as string).toContain("tap Approve on the Action card");
  });
});
