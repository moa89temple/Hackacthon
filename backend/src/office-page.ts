import { parse } from "parse5";
import type { DefaultTreeAdapterTypes as Html } from "parse5";

/** What's kept of an office page: its title, and the words a person reading it would see. */
export interface OfficePage {
  title: string;
  text: string;
}

const NEVER_READ = new Set(["head", "script", "style", "noscript", "template", "svg", "iframe", "nav", "button", "select", "textarea"]);
const BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl", "dt", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "ol", "p", "pre", "section", "summary",
  "table", "tbody", "td", "th", "thead", "tr", "ul",
]);

function attribute(element: Html.Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

/** Words nobody reading the page can see are also where a page could hide instructions to an AI. */
export function isHidden(element: Html.Element): boolean {
  return (
    attribute(element, "hidden") !== undefined ||
    attribute(element, "aria-hidden") === "true" ||
    /(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attribute(element, "style") ?? "")
  );
}

/** Where an email or phone link goes, when the link's words are only "Email us". */
function linkTarget(element: Html.Element): string | null {
  const match = element.tagName === "a" ? /^(?:mailto|tel):([^?]+)/i.exec(attribute(element, "href") ?? "") : null;
  return match ? decodeURIComponent(match[1]!) : null;
}

function collect(node: Html.ChildNode | Html.Document, words: string[]): void {
  if (node.nodeName === "#text") {
    words.push((node as Html.TextNode).value);
    return;
  }
  if (!("childNodes" in node)) return;
  const element = "tagName" in node ? node : null;
  if (element && (NEVER_READ.has(element.tagName) || isHidden(element))) return;

  const isBlock = element !== null && BLOCKS.has(element.tagName);
  if (isBlock) words.push("\n");
  const before = words.length;
  for (const child of node.childNodes) collect(child, words);
  const target = element && linkTarget(element);
  if (target && !words.slice(before).join("").includes(target)) words.push(` (${target})`);
  if (isBlock) words.push("\n");
}

function findTitle(node: Html.ChildNode | Html.Document): string | null {
  if (!("childNodes" in node)) return null;
  if ("tagName" in node && node.tagName === "title") {
    return node.childNodes.map((child) => ("value" in child ? child.value : "")).join("");
  }
  for (const child of node.childNodes) {
    const title = findTitle(child);
    if (title !== null) return title;
  }
  return null;
}

export function readOfficePage(html: string): OfficePage {
  const document = parse(html);
  const words: string[] = [];
  collect(document, words);
  return {
    title: (findTitle(document) ?? "").replace(/\s+/g, " ").trim(),
    text: words
      .join("")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line !== "")
      .join("\n"),
  };
}
