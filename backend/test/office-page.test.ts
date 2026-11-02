import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OFFICES, savedCopyName } from "../src/office-pages.ts";
import { readOfficePage } from "../src/office-page.ts";

const saved = (url: string) => readFileSync(new URL(`fixtures/office-pages/${savedCopyName(url)}`, import.meta.url), "utf8");
const CONTACT_US = "https://counseling.temple.edu/about-us/contact-us";
const WRITING_CENTER = "https://studentsuccess.temple.edu/programs/writing";

describe("reading a saved office page", () => {
  it.each(OFFICES.flatMap((office) => office.pages))("finds the title and words of %s", (url) => {
    const { title, text } = readOfficePage(saved(url));

    expect(title).not.toBe("");
    expect(text.length).toBeGreaterThan(200);
    expect(text).not.toMatch(/<script|<\/div>|function\s*\(|\{"path":/);
  });

  it("decodes the title and keeps the page's own words", () => {
    const { title, text } = readOfficePage(saved(WRITING_CENTER));

    expect(title).toBe("Writing Center | Student Success Center");
    expect(text).toMatch(/Writing Center/);
  });

  it("keeps a phone number from the page", () => {
    expect(readOfficePage(saved(CONTACT_US)).text).toMatch(/215[-.) ]+204[-. ]+7276/);
  });
});

describe("what a page's code can't get into the text", () => {
  const page = (body: string) => `<!doctype html><html><head><title>T &amp; S</title><style>p{}</style></head><body>${body}</body></html>`;

  it("leaves out scripts, styles, menus and anything hidden from a person reading the page", () => {
    const { text } = readOfficePage(
      page(`<nav>Menu words</nav><script>var a = "code words"</script><p>Seen words</p>
            <p hidden>Hidden one</p><div aria-hidden="true">Hidden two</div><span style="display: none">Hidden three</span>`),
    );

    expect(text).toBe("Seen words");
  });

  it("shows where an email or phone link goes when the words don't say", () => {
    const { text } = readOfficePage(page(`<p><a href="mailto:office@temple.edu">Email us</a> or <a href="tel:+12155551234">call</a></p>`));

    expect(text).toContain("Email us (office@temple.edu)");
    expect(text).toContain("call (+12155551234)");
  });

  it("puts separate blocks on separate lines", () => {
    expect(readOfficePage(page("<h2>One</h2><p>Two <b>three</b></p><ul><li>Four</li></ul>")).text).toBe("One\nTwo three\nFour");
  });
});
