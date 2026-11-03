import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import type { KnownRequest, PagePattern, SendingRules } from "./browser-access.ts";
import type { ContactAddress } from "./guidebook.ts";
import type { ApprovedEmail, RequestToCheck } from "./network-guard.ts";

/**
 * Everything Buddy assumes about Outlook on the web, as data in one place, because none of it has been
 * seen against a real TUmail login yet. npm run check-tumail shows what's wrong with it: see tumail-check.ts.
 */

/** The Connection's id. It's also the site's id, because the guard checks the Read Permission by it. */
export const TUMAIL_ID = "tumail";
const TUMAIL_HOST = "outlook.office.com";
export const TUMAIL_HOME = `https://${TUMAIL_HOST}/mail/`;
/** Microsoft can send Outlook on the web to any of these. */
export const TUMAIL_APP_HOSTS = [TUMAIL_HOST, "outlook.office365.com", "outlook.cloud.microsoft"];
const MICROSOFT_SIGN_IN_HOSTS = ["login.microsoftonline.com", "login.microsoft.com"];
const TEMPLE_SIGN_ON_HOST = "fim.temple.edu";
/** Every host holding part of the login. The last two are shared with Temple's other Connections. */
export const TUMAIL_LOGIN_HOSTS = [...TUMAIL_APP_HOSTS, ...MICROSOFT_SIGN_IN_HOSTS, TEMPLE_SIGN_ON_HOST, "duosecurity.com"];

export const INBOX_PATH = "/mail/inbox";
export const messagePath = (id: string) => `${INBOX_PATH}/id/${encodeURIComponent(id)}`;

/** What the reader waits for, because the app builds its page after it has loaded: mail, or somewhere to log in. */
const LOGIN_FORM = 'input[name="loginfmt"], input[type="password"]';
/** One message in the inbox's list. */
export const MESSAGE_ROW = "[data-convid]";
export const INBOX_IS_READY = `${MESSAGE_ROW}, ${LOGIN_FORM}`;
export const MESSAGE_IS_READY = `[aria-label="Message body"], ${LOGIN_FORM}`;

/**
 * The only pages Buddy opens to read: the inbox and one message in it. Sent mail, Drafts, Junk, Deleted Items,
 * writing an email, settings, the calendar and People all stay out, because each address is tested as
 * it is. The sign-in pages are there only so that a read can see a login has expired, and nothing is
 * taken from them.
 */
export function tumailReadablePages(appHosts: string[]): PagePattern[] {
  return [
    ...appHosts.flatMap((host) => [
      { host, path: /^\/owa\/?$/ },
      { host, path: /^\/mail(?:\/\d+)?\/?$/ },
      { host, path: /^\/mail(?:\/\d+)?\/inbox(?:\/id\/[A-Za-z0-9%_.~-]+)?\/?$/ },
    ]),
    ...[...MICROSOFT_SIGN_IN_HOSTS, TEMPLE_SIGN_ON_HOST].map((host) => ({ host, path: /^\// })),
  ];
}

export const TUMAIL_READABLE_PAGES = tumailReadablePages(TUMAIL_APP_HOSTS);

/**
 * Outlook's script asks for mail by POST, so the guard has to be told which of those only read. One
 * address serves everything, sending and deleting included, and only its action says which, so an
 * action must be on this list by name. Marking something read is deliberately not on it, and neither
 * is anything else that changes mail. An address with a second action in it doesn't match. If a real
 * read shows the app needs another action that only reads, this is the one place to add it.
 *
 * Outlook also renews its own token by POST about every hour, and without that it never asks for any mail.
 * That's what a real login showed. It's this one address on Microsoft's sign-in and nothing else there, so
 * it can't sign anyone in or change anything, and what it gets back stays in the browser.
 */
const READING_ACTIONS = ["FindConversation", "FindItem", "GetConversationItems", "GetItem", "FindFolder", "GetFolder"].join("|");
const READING_ACTION_QUERY = new RegExp(`^\\?action=(?:${READING_ACTIONS})(?:&(?!action=)[a-z0-9_]+=[^&;]*)*$`, "i");
const READING_ACTION_HEADER = new RegExp(`^(?:${READING_ACTIONS})$`, "i");

export function tumailReadOnlyRequests(appHosts: string[]): KnownRequest[] {
  return appHosts.flatMap((host) => [
    { method: "POST", host, path: /^\/owa(?:\/\d+)?\/service\.svc$/, query: READING_ACTION_QUERY, headers: { action: READING_ACTION_HEADER } },
    { method: "POST", host, path: /^\/owa(?:\/\d+)?\/startupdata\.ashx$/ },
  ]).concat({ method: "POST", host: "login.microsoftonline.com", path: /^\/organizations\/oauth2\/v2\.0\/token$/ });
}

export const TUMAIL_READ_ONLY_REQUESTS = tumailReadOnlyRequests(TUMAIL_APP_HOSTS);

/** Outlook sends a browser with no working login to someone else's host: Microsoft's sign-in, or the sign-on's. */
export function isTumailLoginPage(address: string, appHosts: string[] = TUMAIL_APP_HOSTS): boolean {
  const url = URL.parse(address);
  return !url || !appHosts.includes(url.hostname);
}

const ADDRESS = "[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9-]+(?:\\.[a-z0-9-]+)+";
const WHOLE_ADDRESS = new RegExp(`^${ADDRESS}$`);
/** Only what's in the last brackets at the very end is the address. Anyone can write anything before that. */
const IN_BRACKETS_AT_THE_END = /<([^<>]*)>\s*$/;

/** The address in what a page shows for a sender, in lower case. Null if it's only a name, or anything odd. */
export function senderAddressIn(written: string): string | null {
  const text = written.trim().toLowerCase();
  const candidate = IN_BRACKETS_AT_THE_END.exec(text)?.[1]?.trim() ?? text;
  return WHOLE_ADDRESS.test(candidate) ? candidate : null;
}

/** The address only if it's written in brackets after a name, as in "Jane Doe <jdoe@temple.edu>". */
export function bracketedAddressIn(written: string): string | null {
  return IN_BRACKETS_AT_THE_END.test(written.trim()) ? senderAddressIn(written) : null;
}

export function isTempleAddress(address: string): boolean {
  if (!WHOLE_ADDRESS.test(address)) return false;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return domain === "temple.edu" || domain.endsWith(".temple.edu");
}

/** Every address in what a page wrote for a Contact, which may be more than one. */
export function addressesIn(written: string): string[] {
  return written.toLowerCase().match(new RegExp(ADDRESS, "g")) ?? [];
}

export function contactWithAddress(address: string, contacts: ContactAddress[]): ContactAddress | null {
  return contacts.find((contact) => contact.email !== null && addressesIn(contact.email).includes(address)) ?? null;
}

/**
 * SENDING. Everything from here down is UNVERIFIED, because nobody has seen a real compose window or a
 * real send yet. It comes from what Outlook on the web is known to do, and a real Practice send has to
 * prove each part. All of it fails closed: if Outlook differs, nothing is sent, and the card says what
 * didn't match. The guard only looks at any of this while the send routine has it open for one approved
 * card, so none of it makes reading any broader. See forSending in network-guard.ts.
 */

/** UNVERIFIED: that this address opens a new email by itself. The app's Open in Outlook button already uses it, on the phone. */
const COMPOSE_PATH = "/mail/deeplink/compose";

/** UNVERIFIED: each of these. The roles and labels Outlook's compose window has, which are all there is to go by. */
export const COMPOSE_SELECTORS = {
  ready: `[aria-label="Message body"][contenteditable="true"], ${LOGIN_FORM}`,
  to: '[aria-label="To"]',
  cc: '[aria-label="Cc"]',
  bcc: '[aria-label="Bcc"]',
  subject: 'input[aria-label="Add a subject"], input[aria-label="Subject"]',
  body: '[aria-label="Message body"][contenteditable="true"]',
  send: 'button[aria-label="Send"]',
};

/**
 * UNVERIFIED: that a new email goes out as one CreateItem on this address, carrying the whole message,
 * with the guard refusing everything before it, including the saves Outlook would otherwise make as a
 * Draft. If it's really a save and then a send, or anything else, the guard refuses it and nothing goes.
 */
const SEND_ACTION_QUERY = /^\?action=CreateItem(?:&(?!action=)[a-z0-9_]+=[^&;]*)*$/i;
const SEND_ACTION_HEADER = /^CreateItem$/i;
/** UNVERIFIED: the value that means send it, and not just save it. */
const SENDS_THE_MESSAGE = new Set(["SendAndSaveCopy", "SendOnly"]);

/** The home address and hosts are only ever something else for made-up pages in the checks of the real browser. */
export function tumailSending(appHosts: string[], home: string = TUMAIL_HOME): SendingRules {
  return {
    composeUrl: new URL(COMPOSE_PATH, home).href,
    pages: appHosts.map((host) => ({ host, path: /^\/mail(?:\/\d+)?\/deeplink\/compose\/?$/ })),
    sendRequests: appHosts.map((host) => ({
      method: "POST",
      host,
      path: /^\/owa(?:\/\d+)?\/service\.svc$/,
      query: SEND_ACTION_QUERY,
      headers: { action: SEND_ACTION_HEADER },
    })),
    whyNotThisEmail,
  };
}

export const TUMAIL_SENDING = tumailSending(TUMAIL_APP_HOSTS);

const sameEmailAddress = (left: unknown, right: string) => typeof left === "string" && left.trim().toLowerCase() === right.trim().toLowerCase();
const inOneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const isNothing = (value: unknown) => value === undefined || value === null || (Array.isArray(value) && value.length === 0);

function wordsInHtml(html: string): string {
  const words: string[] = [];
  const walk = (node: Html.ChildNode | Html.Document) => {
    if (node.nodeName === "#text") words.push((node as Html.TextNode).value);
    if (node.nodeName === "style" || node.nodeName === "script" || node.nodeName === "head") return;
    // A block and a line break both keep the words on either side from running together.
    const breaksWords = node.nodeName === "br" || node.nodeName === "div" || node.nodeName === "p";
    if (breaksWords) words.push(" ");
    if ("childNodes" in node) node.childNodes.forEach(walk);
    if (breaksWords) words.push(" ");
  };
  walk(parse(html));
  return words.join("");
}

/** UNVERIFIED: that the request's data is JSON in its body, in a header that holds the same thing URL-encoded, or both. */
function dataInRequest({ body, headers }: RequestToCheck): unknown[] | null {
  const held = [body, headers?.["x-owa-urlpostdata"]];
  try {
    const data = [
      ...(held[0] ? [JSON.parse(held[0])] : []),
      ...(held[1] ? [JSON.parse(decodeURIComponent(held[1]))] : []),
    ];
    return data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

/** UNVERIFIED: every field name here, which come from Exchange's published shape for CreateItem. */
function whyNotInData(data: any, email: ApprovedEmail): string | null {
  const request = data?.Body;
  if (!SENDS_THE_MESSAGE.has(request?.MessageDisposition)) return "Outlook asked to do something other than send a message, such as save a Draft.";
  if (!Array.isArray(request.Items) || request.Items.length !== 1) return "Outlook's request didn't hold exactly one message.";
  const [message] = request.Items;
  const to = message?.ToRecipients;
  if (!Array.isArray(to) || to.length !== 1 || !sameEmailAddress(to[0]?.EmailAddress, email.to)) return "Outlook's request wasn't to exactly the approved recipient.";
  if (!isNothing(message.CcRecipients) || !isNothing(message.BccRecipients)) return "Outlook's request had a copy going to someone.";
  if (!isNothing(message.Attachments)) return "Outlook's request had an attachment.";
  if (typeof message.Subject !== "string" || inOneLine(message.Subject) !== inOneLine(email.subject)) return "Outlook's request had a different subject.";
  const body = message.Body;
  if (typeof body?.Value !== "string") return "Outlook's request didn't show the message's words.";
  const words = String(body.BodyType).toLowerCase() === "html" ? wordsInHtml(body.Value) : body.Value;
  return inOneLine(words) === inOneLine(email.body) ? null : "Outlook's request had different words.";
}

/** Whether a request carries exactly the approved email, and nothing more. Null means it does. */
export function whyNotThisEmail(request: RequestToCheck, email: ApprovedEmail): string | null {
  const held = dataInRequest(request);
  if (!held) return "Buddy couldn't read what Outlook's request carries.";
  for (const data of held) {
    const why = whyNotInData(data, email);
    if (why) return why;
  }
  return null;
}

/** The answer to the send request, which has to be told from Outlook's other answers. */
export function isSendAnswer(address: string): boolean {
  const url = URL.parse(address);
  return url !== null && /^\/owa(?:\/\d+)?\/service\.svc$/.test(url.pathname) && SEND_ACTION_QUERY.test(url.search);
}

/** UNVERIFIED: the shape of Outlook's answer. Anything else means there's no telling, and never that it didn't go. */
export function answerSaysSent(answer: string): boolean {
  try {
    const items = JSON.parse(answer)?.Body?.ResponseMessages?.Items;
    return Array.isArray(items) && items.length === 1 && items[0]?.ResponseClass === "Success";
  } catch {
    return false;
  }
}

/** What's in the compose window, as read back just before pressing Send. A line that isn't shown is null. */
export interface ComposeContents {
  /** Everything the To line shows, and every label and title inside it, where a chip may keep its address. */
  to: string;
  cc: string | null;
  bcc: string | null;
  subject: string;
  body: string;
}

/**
 * How the compose window differs from the card, in Buddy's words, with none of the email's. Line breaks
 * can differ, because the editor keeps them its own way, but the words and their order can't.
 */
export function differencesFromApproved(found: ComposeContents, email: ApprovedEmail): string[] {
  const problems: string[] = [];
  const addresses = [...new Set(addressesIn(found.to))];
  if (addresses.length !== 1 || !sameEmailAddress(addresses[0], email.to)) problems.push("The To line didn't hold exactly the approved recipient.");
  if (inOneLine(found.cc ?? "") !== "") problems.push("The Cc line wasn't empty.");
  if (inOneLine(found.bcc ?? "") !== "") problems.push("The Bcc line wasn't empty.");
  if (inOneLine(found.subject) !== inOneLine(email.subject)) problems.push("The subject wasn't what the card says.");
  if (inOneLine(found.body) !== inOneLine(email.body)) problems.push("The message wasn't what the card says.");
  return problems;
}
