import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";

/**
 * Reads TUportal's pages. There's no model here and no fetching. Nobody has checked these against the
 * real site yet: see the unconfirmed list in tuportal-rules.ts, and `npm run check-tuportal`.
 *
 * Each function returns null when it can't understand the page, and only says there's nothing when the
 * page says so in as many words. A false "you have no hold" is the worst thing Buddy could say here, so
 * nothing is ever concluded from a hold not being found. What counts as said is what the page shows
 * (`text`, the browser's own idea of what's visible), because a page often carries its empty message
 * hidden in its HTML while it draws its holds some other way.
 */

/** A page as Buddy's Browser read it. */
export interface PageToRead {
  /** The page as it stood once it had loaded. */
  html: string;
  /** What a person sees on it, one line to a block. */
  text: string;
}

export interface HoldOnPage {
  type: string;
  reason: string | null;
  from: string | null;
  until: string | null;
  amount: string | null;
  /** What the hold stops the Student doing, such as registering. */
  affects: string | null;
}

export interface BalanceOnPage {
  /** How much, in cents, never below zero. */
  cents: number;
  /** Temple owes the Student this, rather than the other way round. */
  credit: boolean;
}

export interface RegistrationOnPage {
  /** As the page words it. */
  status: string;
  term: string | null;
}

type Node = Html.ChildNode | Html.Document;

export function attribute(element: Html.Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function* elementsIn(node: Node): Generator<Html.Element> {
  if (!("childNodes" in node)) return;
  for (const child of node.childNodes) {
    if ("tagName" in child) yield child;
    yield* elementsIn(child);
  }
}

export const elementsNamed = (node: Node, ...tags: string[]) => [...elementsIn(node)].filter((element) => tags.includes(element.tagName));

export function wordsIn(node: Node): string {
  const words: string[] = [];
  const visit = (current: Node): void => {
    if (current.nodeName === "#text") words.push((current as Html.TextNode).value);
    else if ("childNodes" in current) current.childNodes.forEach(visit);
  };
  visit(node);
  return words.join(" ").replace(/\s+/g, " ").trim();
}

const linesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** A whole line that says there are no holds. A sentence that only mentions them, such as "if you have no holds", doesn't count. */
const SAYS_NO_HOLDS =
  /^(?:(?:you (?:currently )?have|there are(?: currently)?) no|you (?:do not|don't)(?: currently)? have any|no)\s+(?:(?:active|current)\s+)?holds?(?:\s+(?:exists?|(?:were )?found))?(?:\s+on (?:your|this) (?:record|account))?(?:\s+at this time)?[.!]?$/i;
/** Words that only a page with a hold on it would show, whatever else it says. */
const SAYS_THERE_IS_A_HOLD = /\bhold type\b|\bprocesses affected\b|\byou have (?:an?|one|some|\d+)\s+(?:[a-z]+\s+)?holds?\b/i;
/**
 * A short line that isn't a sentence and speaks of one hold, or of holds and a number: how a hold or a
 * count of them reads when it's drawn some way the reader doesn't know, such as "Made-Up Bursar Hold".
 */
const NAMES_A_HOLD = /^(?=.{1,100}$)[^.?!]*(?:\bhold\b|\bholds?\b[^.?!]*\d|\d[^.?!]*\bholds?\b)[^.?!]*$/i;

/** A table with a row of more than one filled cell, on a page that's meant to say there's nothing to list. */
function hasDataRows(html: string): boolean {
  return elementsNamed(parse(html), "tr").some((row) => elementsNamed(row, "td").filter((cell) => wordsIn(cell) !== "").length > 1);
}

/** Who placed a hold isn't read: a column with no match here is left alone. */
const COLUMNS: Record<Exclude<keyof HoldOnPage, "type">, RegExp> = {
  reason: /reason|description|instruction|detail/i,
  from: /^(?:from|start|begin)/i,
  until: /^(?:to\b|end|until|expir)/i,
  amount: /amount/i,
  affects: /process|affect|restrict/i,
};
const HOLD_COLUMN = /\bholds?\b/i;

/** Only a table with a column for the hold. Null if any row of it can't be read, so that no hold gets left out. */
function holdsInTable(rows: Html.Element[], shown: string): { holds: HoldOnPage[]; empty: boolean } | null {
  const headings = elementsNamed(rows[0]!, "th", "td").map(wordsIn);
  const column = (pattern: RegExp) => headings.findIndex((heading) => pattern.test(heading));
  const holdColumn = column(HOLD_COLUMN);

  const holds: HoldOnPage[] = [];
  let empty = false;
  for (const row of rows.slice(1)) {
    const cells = elementsNamed(row, "th", "td").map(wordsIn);
    if (cells.every((cell) => cell === "")) continue;
    if (cells.length === 1 && SAYS_NO_HOLDS.test(cells[0]!)) {
      empty = true;
      continue;
    }
    const type = cells[holdColumn];
    if (cells.length !== headings.length || !type || !shown.includes(type)) return null;
    const cell = (pattern: RegExp) => {
      const index = column(pattern);
      return index >= 0 && cells[index] ? cells[index] : null;
    };
    holds.push({
      type,
      reason: cell(COLUMNS.reason),
      from: cell(COLUMNS.from),
      until: cell(COLUMNS.until),
      amount: cell(COLUMNS.amount),
      affects: cell(COLUMNS.affects),
    });
  }
  return { holds, empty };
}

export function readHoldsPage({ html, text }: PageToRead): HoldOnPage[] | null {
  const lines = linesOf(text);
  const shown = lines.join(" ").replace(/\s+/g, " ");
  const tables = elementsNamed(parse(html), "table")
    .map((table) => elementsNamed(table, "tr"))
    .filter((rows) => rows.length > 0 && elementsNamed(rows[0]!, "th", "td").some((cell) => HOLD_COLUMN.test(wordsIn(cell))));

  const holds: HoldOnPage[] = [];
  let aTableSaysNone = false;
  for (const rows of tables) {
    const found = holdsInTable(rows, shown);
    if (!found) return null;
    aTableSaysNone ||= found.empty;
    holds.push(...found.holds);
  }
  if (holds.length > 0) return holds;

  const saysNone = lines.some((line) => SAYS_NO_HOLDS.test(line));
  // A table's own heading has the words for a hold in it, and it doesn't mean there is one.
  if (aTableSaysNone) return saysNone ? [] : null;
  const saysOne = lines.some((line) => !SAYS_NO_HOLDS.test(line) && (SAYS_THERE_IS_A_HOLD.test(line) || NAMES_A_HOLD.test(line)));
  return saysNone && !saysOne && !hasDataRows(html) ? [] : null;
}

const BALANCE_LABEL = String.raw`(?:your\s+)?(?:(?:current|total|account|student\s+account|outstanding)\s+)*(?:balance(?:\s+due)?|amount\s+due)`;
const MONEY = String.raw`([-–−]\s*)?(\()?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\)?(\s*(?:CR|credit))?`;
const LABEL_AND_AMOUNT = new RegExp(`^${BALANCE_LABEL}\\s*:?\\s+${MONEY}$`, "i");
const LABEL_ALONE = new RegExp(`^${BALANCE_LABEL}\\s*:?$`, "i");
const AMOUNT_ALONE = new RegExp(`^${MONEY}$`, "i");

function balanceFrom(match: RegExpExecArray): BalanceOnPage {
  const [, minus, bracket, whole, part, credit] = match;
  const cents = Number(whole!.replaceAll(",", "")) * 100 + Number(part ?? 0);
  return { cents, credit: cents > 0 && Boolean(minus || bracket || credit) };
}

/** Only a labelled amount that's the Student's whole balance. Two that disagree can't be told apart, so that's no answer. */
export function readBalancePage({ text }: PageToRead): BalanceOnPage | null {
  const lines = linesOf(text);
  const balances = lines.flatMap((line, index) => {
    const together = LABEL_AND_AMOUNT.exec(line);
    if (together) return [balanceFrom(together)];
    const below = LABEL_ALONE.test(line) ? AMOUNT_ALONE.exec(lines[index + 1] ?? "") : null;
    return below ? [balanceFrom(below)] : [];
  });
  const different = new Set(balances.map(({ cents, credit }) => `${cents} ${credit}`));
  return different.size === 1 ? balances[0]! : null;
}

const STATUS_LABEL = String.raw`(?:registration|enrollment|enrolment)\s+status`;
const STATUS_AND_VALUE = new RegExp(`^${STATUS_LABEL}\\s*[:\\t]\\s*(.+)$`, "i");
const STATUS_ALONE = new RegExp(`^${STATUS_LABEL}\\s*:?$`, "i");
const SAYS_REGISTERED = /^you are (?:currently )?(?:not )?(?:currently )?registered(?: for [^.]{1,60})?\.?$/i;
const TERM_AND_VALUE = /^term\s*[:\t]\s*(.{3,30})$/i;
const TERM_ALONE = /^term\s*:?$/i;
const LONGEST_STATUS = 80;
/** What follows a label when the value hasn't loaded, or is really the next thing on the page. */
const NOT_A_STATUS = /^(?:-+|n\/?a|none|unknown|loading.*|select.*)$|register for|add\/drop|click|plan your/i;

const isStatus = (words: string | undefined): words is string =>
  words !== undefined && words.length <= LONGEST_STATUS && /\p{L}/u.test(words) && !NOT_A_STATUS.test(words);

export function readRegistrationPage({ text }: PageToRead): RegistrationOnPage | null {
  const lines = linesOf(text);
  const statuses = lines.flatMap((line, index) => {
    if (SAYS_REGISTERED.test(line)) return [line];
    const value = STATUS_AND_VALUE.exec(line)?.[1] ?? (STATUS_ALONE.test(line) ? lines[index + 1] : undefined);
    return isStatus(value) ? [value] : [];
  });
  if (new Set(statuses.map((status) => status.toLowerCase())).size !== 1) return null;

  const termAt = lines.findIndex((line) => TERM_AND_VALUE.test(line) || TERM_ALONE.test(line));
  const term = termAt < 0 ? null : (TERM_AND_VALUE.exec(lines[termAt]!)?.[1] ?? lines[termAt + 1] ?? null);
  return { status: statuses[0]!, term };
}

/** Somewhere to log in, wherever it turned up. A page with a Student's records on it never asks for this. */
export function hasPasswordField(html: string): boolean {
  return elementsNamed(parse(html), "input").some((input) => attribute(input, "type")?.toLowerCase() === "password");
}
