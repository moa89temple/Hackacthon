import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { isHidden } from "./office-page.ts";

export interface PageLink {
  address: string;
  words: string;
}

const MOST_LINKS = 60;
const LONGEST_WORDS = 80;

function wordsIn(node: Html.ChildNode): string {
  if (node.nodeName === "#text") return (node as Html.TextNode).value;
  return "childNodes" in node ? node.childNodes.map(wordsIn).join("") : "";
}

/**
 * The links someone reading this page could follow, each once, with what it says. An address comes from the page
 * as it was served, so it can't carry anything the Student's records said. One nobody can see is where a page
 * could hide something meant only for an AI, so it's left out.
 */
export function linksOnPage(html: string, pageAddress: string): PageLink[] {
  const links = new Map<string, string>();
  const visit = (node: Html.ChildNode | Html.Document): void => {
    if (!("childNodes" in node)) return;
    const element = "tagName" in node ? node : null;
    if (element && isHidden(element)) return;
    if (element?.tagName === "a") {
      const href = element.attrs.find((attr) => attr.name === "href")?.value;
      const url = href ? URL.parse(href, pageAddress) : null;
      if (url?.protocol === "https:") {
        url.hash = "";
        const words = wordsIn(element).replace(/\s+/g, " ").trim().slice(0, LONGEST_WORDS);
        if (!links.has(url.href)) links.set(url.href, words);
      }
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(parse(html));
  return [...links].slice(0, MOST_LINKS).map(([address, words]) => ({ address, words }));
}

/** For Claude, one line for each, so that a link's words can't start a line of their own. */
export function describeLinks(links: PageLink[]): string {
  if (links.length === 0) return "";
  return `\n\nLinks on this page, which you can follow by their exact address:\n${links.map((link) => JSON.stringify(link)).join("\n")}`;
}
