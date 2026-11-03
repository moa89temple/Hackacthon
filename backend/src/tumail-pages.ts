import { createHash } from "node:crypto";
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { bracketedAddressIn, senderAddressIn } from "./tumail-rules.ts";

/**
 * Reads Outlook on the web's pages. There's no model here and no fetching: each function takes a page's
 * HTML, as the app built it, and gives back what's on it. Outlook's class names are made by its build
 * and change, so this goes by its roles, labels and data attributes.
 *
 * A real inbox was compared with this on 2026-11-02. A row has controls with titles ahead of the sender,
 * and a message from someone in Temple's own directory shows only their name. Anything it doesn't
 * recognize is a failure it says out loud, and never an empty inbox.
 * The list is on the page beside an open message and the words of a message can hold anything, so
 * nothing is ever searched for across a whole page.
 */

/** One message in the inbox's list. Only what's needed to decide about opening it, and none of its words. */
export interface RowOnPage {
  /** Outlook's id for its conversation, which stays the same when a reply arrives. */
  id: string;
  /** Null when the row doesn't show one. */
  address: string | null;
  /** The sender's name as the row shows it, to tell whether a message that shows only a name is theirs. */
  name: string | null;
  /** Null when the page can't say. */
  unread: boolean | null;
  /** When it came, as the page writes it. */
  shownAt: string | null;
  /** Changes when what the row shows changes, such as when a reply arrives. It holds no words. */
  fingerprint: string;
}

export type MessageOnPage =
  | { outcome: "read"; address: string; name: string; subject: string; shownAt: string | null; words: string }
  /** It's open, but nothing says who wrote it, so its words can't be kept. */
  | { outcome: "no_sender" }
  /** Several messages of a conversation are open, and there's no telling which one is the row's sender's. */
  | { outcome: "several_open" }
  | { outcome: "not_recognized" };

type Node = Html.ChildNode | Html.Document;

/** Says whether something changed, and holds none of what it's made from. */
export const shortHash = (text: string) => createHash("sha256").update(text).digest("base64url").slice(0, 22);

const NOT_WORDS_ON_THE_PAGE = new Set(["script", "style", "template", "noscript", "head"]);
const KEPT_OUT_OF_SIGHT = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])/i;
/** A date with a year, as Outlook writes in a title. */
const DATE_WITH_A_YEAR = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;
const FITS_IN_AN_ADDRESS = /^[A-Za-z0-9_+=/.-]{1,512}$/;
const THIS_INBOX_IS_EMPTY = /nothing in (?:your )?inbox|this folder is empty|all done for the day/i;
const NAME_AND_ADDRESS = /^(.*)<[^<>]*>\s*$/;

function attribute(element: Html.Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function* elementsIn(node: Node): Generator<Html.Element> {
  if (!("childNodes" in node)) return;
  for (const child of node.childNodes) {
    if ("tagName" in child) yield child;
    yield* elementsIn(child);
  }
}

function isHidden(element: Html.Element): boolean {
  return (
    NOT_WORDS_ON_THE_PAGE.has(element.tagName) ||
    attribute(element, "hidden") !== undefined ||
    KEPT_OUT_OF_SIGHT.test(attribute(element, "style") ?? "")
  );
}

function collectWords(node: Node, words: string[]): void {
  if (node.nodeName === "#text") {
    words.push((node as Html.TextNode).value);
    return;
  }
  if (!("childNodes" in node)) return;
  if ("tagName" in node && isHidden(node)) return;
  for (const child of node.childNodes) collectWords(child, words);
}

/** What a person reading the page sees of it. */
function wordsIn(node: Node | undefined): string {
  if (!node) return "";
  const words: string[] = [];
  collectWords(node, words);
  return words.join(" ").replace(/\s+/g, " ").trim();
}

function withLabel(element: Html.Element, label: RegExp): boolean {
  return label.test(attribute(element, "aria-label") ?? "");
}

/** A row's own buttons and tick box. A real inbox gives them titles too, ahead of the sender's, and they say nothing about the mail. */
function isControl(element: Html.Element): boolean {
  return element.tagName === "button" || ["button", "checkbox"].includes(attribute(element, "role") ?? "");
}

function readRow(row: Html.Element): RowOnPage | null {
  const id = attribute(row, "data-convid")!;
  if (!FITS_IN_AN_ADDRESS.test(id) || id.includes("..")) return null;
  const inControls = new Set([...elementsIn(row)].filter(isControl).flatMap((control) => [control, ...elementsIn(control)]));
  // A real row can have an empty title ahead of the sender's too, which says nothing at all.
  const withTitles = [...elementsIn(row)].filter((element) => Boolean(attribute(element, "title")?.trim()) && !inControls.has(element));
  // The sender comes first in a row. Only there: anyone can put an address in a subject.
  const firstTitle = withTitles[0] && attribute(withTitles[0], "title");
  const dated = withTitles.findLast((element) => DATE_WITH_A_YEAR.test(attribute(element, "title")!));
  const label = attribute(row, "aria-label");
  const address = firstTitle ? senderAddressIn(firstTitle) : null;
  const name = address && withTitles[0] ? wordsIn(withTitles[0]) || null : null;
  const shownAt = dated ? attribute(dated, "title")! : null;
  return {
    id,
    address,
    name,
    unread: label === undefined ? null : /^unread\b/i.test(label.trim()),
    shownAt,
    fingerprint: shortHash(JSON.stringify([address, shownAt, wordsIn(row).replace(dated ? wordsIn(dated) : "", "")])),
  };
}

/**
 * The list as far as the app has built it. Null when this isn't a list the reader knows, because that
 * isn't the same as an inbox with nothing in it, and nothing already known should go over it.
 */
export function readInboxPage(html: string): RowOnPage[] | null {
  const page = parse(html);
  const elements = [...elementsIn(page)];
  const rows = elements.filter((element) => attribute(element, "data-convid") !== undefined);
  if (rows.length === 0) {
    const list = elements.find((element) => withLabel(element, /^message list$/i));
    return list && THIS_INBOX_IS_EMPTY.test(wordsIn(list)) ? [] : null;
  }
  const read = rows.map(readRow);
  return read.every((row) => row !== null) ? read : null;
}

const sameName = (one: string, other: string) => one.toLowerCase().replace(/\s+/g, " ").trim() === other.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The message open in the reading pane, and only it, given the row it was opened from. Outlook shows someone
 * in Temple's own directory by name alone, where anyone from outside comes with their address. So a message
 * with no address is taken to be the row's sender's only if it shows exactly the name the row does, and that
 * name doesn't look like an address, which anyone could set their display name to.
 *
 * Each open message in a conversation has its own header. Only the row's sender's is read, so that anyone
 * else in the conversation, who may not be someone Buddy reads, stays out. If that isn't exactly one, nothing is.
 */
export function readMessagePage(html: string, row?: Pick<RowOnPage, "address" | "name">): MessageOnPage {
  const pane = [...elementsIn(parse(html))].find((element) => attribute(element, "id") === "ReadingPaneContainerId" || withLabel(element, /^reading pane$/i));
  if (!pane) return { outcome: "not_recognized" };

  const elements = [...elementsIn(pane)];
  const bodies = elements.filter((element) => withLabel(element, /^message body$/i));
  if (bodies.length === 0) return { outcome: "not_recognized" };
  // Words in an email can be labelled anything, so one "message" inside another could be anyone's made-up header and words.
  if (bodies.some((body) => bodies.some((other) => other !== body && [...elementsIn(other)].includes(body)))) return { outcome: "several_open" };

  const messages = bodies.map((body, index) => {
    // In document order. Only what comes between the last message and this one can be this one's header.
    const last = bodies[index - 1];
    const start = last ? elements.indexOf(last) + [...elementsIn(last)].length + 1 : 0;
    const before = elements.slice(start, elements.indexOf(body));
    const fromHeader = before.findLast((element) => withLabel(element, /^from\b/i));
    const shownFrom = fromHeader ? wordsIn(fromHeader) : "";
    // In the words it must be in brackets: an address on its own there could be a display name that looks like one.
    const addressShown = fromHeader ? (senderAddressIn(attribute(fromHeader, "title") ?? "") ?? bracketedAddressIn(shownFrom)) : null;
    const nameMatchesRow = addressShown === null && shownFrom !== "" && !shownFrom.includes("@") && row?.name != null && sameName(shownFrom, row.name);
    const when = before.findLast((element) => attribute(element, "data-testid") === "SentReceivedSavedTime");
    return { body, shownFrom, addressShown, nameMatchesRow, when };
  });

  const theRowSenders = messages.filter(({ addressShown, nameMatchesRow }) => nameMatchesRow || (addressShown !== null && addressShown === row?.address));
  if (messages.length > 1 && theRowSenders.length !== 1) return { outcome: "several_open" };
  const message = messages.length > 1 ? theRowSenders[0]! : messages[0]!;
  const address = message.addressShown ?? (message.nameMatchesRow ? row!.address : null);
  if (!address) return { outcome: "no_sender" };

  // The conversation's subject, at the top of the pane, for whichever message this is.
  const heading = elements.slice(0, elements.indexOf(bodies[0]!)).find((element) => attribute(element, "role") === "heading");
  return {
    outcome: "read",
    address,
    name: message.nameMatchesRow ? message.shownFrom : NAME_AND_ADDRESS.exec(message.shownFrom)?.[1]?.trim() || address,
    subject: wordsIn(heading),
    shownAt: wordsIn(message.when) || null,
    words: wordsIn(message.body),
  };
}
