import { parse, serialize } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { realDay } from "./milestone-reading.ts";
import { readOfficePage, type OfficePage } from "./office-page.ts";
import {
  ALL_DAY_TIMES,
  CANCELLED_EVENT,
  EVENT_DATE_CLASS,
  EVENT_PAGE_CLASS,
  EVENT_PATH,
  EVENT_TEASER_CLASS,
  EVENT_TITLE_CLASS,
  LISTED_DAY,
  LISTED_TIMES,
  NOW_TEMPLE_HOST,
  withoutCancelledInAddress,
} from "./now-temple-rules.ts";

/** One event as the list gives it. All of this is the site's own, so none of it goes through a model. */
export interface ListedEvent {
  url: string;
  name: string;
  /** Its first day, as YYYY-MM-DD. */
  date: string;
  /** Its last day, if it isn't the first. */
  endDate: string | null;
  /** Such as "12:00 pm to 1:00 pm". Null when it runs over several days or all day. */
  time: string | null;
}

export interface EventsPage {
  events: ListedEvent[];
  /** The addresses of what the list says is cancelled, so that what Buddy already has of them can go. */
  cancelled: string[];
  /** False when the page has no events on it at all, which means it isn't the list as Buddy knows it. */
  understood: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hasClass(node: Html.ChildNode | Html.Document, name: string): node is Html.Element {
  if (!("attrs" in node)) return false;
  return node.attrs.find((attr) => attr.name === "class")?.value.split(/\s+/).includes(name) ?? false;
}

function allWithClass(node: Html.ChildNode | Html.Document, name: string): Html.Element[] {
  if (!("childNodes" in node)) return [];
  return node.childNodes.flatMap((child) => [...(hasClass(child, name) ? [child] : []), ...allWithClass(child, name)]);
}

function firstLink(node: Html.ChildNode): Html.Element | null {
  if (!("childNodes" in node)) return null;
  if (node.nodeName === "a") return node as Html.Element;
  for (const child of node.childNodes) {
    const link = firstLink(child);
    if (link) return link;
  }
  return null;
}

function wordsOf(node: Html.ChildNode): string {
  if (node.nodeName === "#text") return (node as Html.TextNode).value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(wordsOf).join("").replace(/\s+/g, " ").trim();
}

function daysIn(words: string): string[] {
  return [...words.matchAll(LISTED_DAY)].flatMap(([, month, day, year]) => {
    const monthNumber = MONTHS.indexOf(month!) + 1;
    const iso = `${year}-${String(monthNumber).padStart(2, "0")}-${day!.padStart(2, "0")}`;
    return monthNumber > 0 && realDay(iso) ? [iso] : [];
  });
}

/** Null for one that's no use to the reader. A cancelled one still has its address, which is what it's named by here. */
function readTeaser(teaser: Html.Element): ListedEvent | { cancelledAt: string } | null {
  const href = firstLink(teaser)?.attrs.find((attr) => attr.name === "href")?.value;
  const url = href ? URL.parse(href, `https://${NOW_TEMPLE_HOST}/`) : null;
  const addressDay = url?.hostname === NOW_TEMPLE_HOST ? EVENT_PATH.exec(url.pathname)?.[1] : undefined;
  const dateWords = allWithClass(teaser, EVENT_DATE_CLASS)[0];
  const title = allWithClass(teaser, EVENT_TITLE_CLASS)[0];
  if (!addressDay || !dateWords || !title) return null;

  const name = wordsOf(title);
  const when = wordsOf(dateWords);
  const [first, last] = daysIn(when);
  if (CANCELLED_EVENT.test(name)) return { cancelledAt: url!.href };
  // The address and the words are two statements of one date. If they disagree, neither can be trusted.
  if (!name || first !== addressDay) return null;

  const times = last ? null : (LISTED_TIMES.exec(when)?.[0] ?? null);
  return {
    url: url!.href,
    name,
    date: first,
    endDate: last ?? null,
    time: times === ALL_DAY_TIMES ? null : times,
  };
}

export function readEventsPage(html: string): EventsPage {
  const teasers = allWithClass(parse(html), EVENT_TEASER_CLASS);
  const byAddress = new Map<string, ListedEvent>();
  const cancelled: string[] = [];
  for (const teaser of teasers) {
    const event = readTeaser(teaser);
    if (event && "cancelledAt" in event) cancelled.push(event.cancelledAt, withoutCancelledInAddress(event.cancelledAt));
    else if (event) byAddress.set(event.url, event);
  }
  return { events: [...byAddress.values()], cancelled: [...new Set(cancelled)], understood: teasers.length > 0 };
}

/** The event's own words, without the site's menus and footer, or null if there's no event on the page. */
export function readEventPage(html: string): OfficePage | null {
  const [article] = allWithClass(parse(html), EVENT_PAGE_CLASS);
  if (!article) return null;
  const { title } = readOfficePage(html);
  const fragment = { nodeName: "#document-fragment", childNodes: [article] } as unknown as Html.DocumentFragment;
  return { title, text: readOfficePage(`<body>${serialize(fragment)}</body>`).text };
}
