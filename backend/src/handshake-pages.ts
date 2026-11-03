import { parse, serializeOuter } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { HANDSHAKE_NAME, isHandshakeHost, LISTING_PAGE, type ListingKind } from "./handshake-rules.ts";
import { readOfficePage, type OfficePage } from "./office-page.ts";

/**
 * All that Buddy assumes about how Handshake's pages are laid out, in one small place, because nobody has
 * seen a real one yet. It's kept to as little as possible so that there's little to correct: a list is
 * only links to listings, and a listing is only the words of its main part. Everything else about a
 * listing, such as its date and what it costs, is read from those words and checked against them, by the
 * same code that reads any other page for Opportunities. See opportunity-reading.ts.
 *
 * `npm run check-handshake` prints the shape of the real pages to correct this against. There's no model
 * here and no fetching. Null means Buddy couldn't understand a page, which isn't the same as there being
 * nothing on it.
 */

/** Waited for before a list is read, because it's built by script. ASSUMED, from the addresses in handshake-rules.ts. */
export const LIST_READY: Record<ListingKind, string> = {
  job: 'a[href*="/jobs/"], a[href*="/job-search/"]',
  event: 'a[href*="/events/"]',
};
/** Waited for before a listing is read, and the only part of it that's kept. ASSUMED. */
export const LISTING_READY = "main";

/** How many of each list one read goes through: the first ones, in the order Handshake gives them. */
const MOST_FROM_A_LIST = 15;
/** Less than this is a stand-in such as "Loading", not a listing. */
const SHORTEST_LISTING_CHARACTERS = 40;
/** Far longer than any listing. It's sent to the model whole or not at all, like any other page. */
const LONGEST_LISTING_CHARACTERS = 200_000;

function allElements(node: Html.ChildNode | Html.Document, tagName: string): Html.Element[] {
  if (!("childNodes" in node)) return [];
  return node.childNodes.flatMap((child) => [...("tagName" in child && child.tagName === tagName ? [child] : []), ...allElements(child, tagName)]);
}

/** Each listing's own page, once and with nothing a list added to it, or null if the page shows none. */
export function readListPage(html: string, pageAddress: string, kind: ListingKind): string[] | null {
  const found = new Set<string>();
  for (const link of allElements(parse(html), "a")) {
    const href = link.attrs.find((attr) => attr.name === "href")?.value;
    const url = href === undefined ? null : URL.parse(href, pageAddress);
    if (!url || url.protocol !== "https:" || !isHandshakeHost(url.hostname) || !LISTING_PAGE[kind].test(url.pathname)) continue;
    found.add(`${url.origin}${url.pathname.replace(/\/$/, "")}`);
  }
  // A big university always has some, so none means this isn't the list as Buddy knows it.
  return found.size > 0 ? [...found].slice(0, MOST_FROM_A_LIST) : null;
}

/** A listing's title and the words of its main part, which is meant to keep out the menus around it and the Student's name in them. */
export function readListingPage(html: string): OfficePage | null {
  const document = parse(html);
  const main = allElements(document, "main")[0];
  if (!main) return null;
  const { text } = readOfficePage(serializeOuter(main));
  if (text.length < SHORTEST_LISTING_CHARACTERS || text.length > LONGEST_LISTING_CHARACTERS) return null;
  return { title: readOfficePage(html).title || HANDSHAKE_NAME, text };
}

/** Where every link on a page goes, for the check to clean and count. Never a link's words. */
export function linksOn(html: string): string[] {
  return allElements(parse(html), "a").flatMap((link) => link.attrs.find((attr) => attr.name === "href")?.value ?? []);
}
