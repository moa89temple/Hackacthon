import type { KnownRequest, PagePattern } from "./browser-access.ts";
import type { ContactAddress } from "./guidebook.ts";

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
export const INBOX_IS_READY = `[data-convid], ${LOGIN_FORM}`;
export const MESSAGE_IS_READY = `[aria-label="Message body"], ${LOGIN_FORM}`;

/**
 * The only pages Buddy opens: the inbox and one message in it. Sent mail, Drafts, Junk, Deleted Items,
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
 */
const READING_ACTIONS = ["FindConversation", "FindItem", "GetConversationItems", "GetItem", "FindFolder", "GetFolder"].join("|");
const READING_ACTION_QUERY = new RegExp(`^\\?action=(?:${READING_ACTIONS})(?:&(?!action=)[a-z0-9_]+=[^&;]*)*$`, "i");
const READING_ACTION_HEADER = new RegExp(`^(?:${READING_ACTIONS})$`, "i");

export function tumailReadOnlyRequests(appHosts: string[]): KnownRequest[] {
  return appHosts.flatMap((host) => [
    { method: "POST", host, path: /^\/owa(?:\/\d+)?\/service\.svc$/, query: READING_ACTION_QUERY, headers: { action: READING_ACTION_HEADER } },
    { method: "POST", host, path: /^\/owa(?:\/\d+)?\/startupdata\.ashx$/ },
  ]);
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
