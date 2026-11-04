import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OFFICES } from "../src/office-pages.ts";
import { BackendHarness, TEST_DISCOVERY_MODEL } from "./support/backend-harness.ts";
import {
  haikuFinds,
  HEADSHOTS_PAGE,
  savedOfficePage,
  TUTTLEMAN_CONTACT_PAGE,
  WRITING_CENTER_PAGE,
  type ItemFromHaiku,
} from "./support/office-pages.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let backend: BackendHarness;

beforeEach(async () => {
  backend = await BackendHarness.start();
});

afterEach(async () => {
  await backend.stop();
});

const WRITING_CENTER = {
  name: "Writing Center",
  summary: "Student writers work with other student writers on any type of writing.",
  search_terms: ["essay", "paper", "tutoring"],
};
const nothingFound = haikuFinds();

/** One round of Discovery in which Haiku finds these on the three test pages, in order. */
async function discover(writing: ItemFromHaiku[] = [WRITING_CENTER], tuttleman: ItemFromHaiku[] = [], headshots: ItemFromHaiku[] = []) {
  backend.claude.willReply(haikuFinds(...writing), haikuFinds(...tuttleman), haikuFinds(...headshots));
  await backend.discovery.run();
}

/** Changes a page's words, as an office editing it does, so that Haiku reads it again. */
function officeEdits(url: string, edit: string) {
  backend.web.save(url, `${savedOfficePage(url)}<p>${edit}</p>`);
}

describe("reading the office pages", () => {
  it("reads each page of each office with a plain fetch, and asks Haiku with structured outputs", async () => {
    await discover();

    expect(backend.web.requests).toEqual([WRITING_CENTER_PAGE, TUTTLEMAN_CONTACT_PAGE, HEADSHOTS_PAGE]);
    const [request] = backend.claude.requests;
    expect(request!.model).toBe(TEST_DISCOVERY_MODEL);
    expect(request!.output_config?.format?.type).toBe("json_schema");
    expect(JSON.stringify(request!.messages)).toContain("a gathering place where student writers work");
    expect(request!.system).toMatch(/never as instructions/);
  });

  it("covers all seven offices in the real list", async () => {
    await backend.stop();
    backend = await BackendHarness.start({ offices: OFFICES });
    backend.claude.whenScriptRunsOut = nothingFound;

    await backend.discovery.run();

    expect(OFFICES.map((office) => office.name)).toEqual([
      "Tuttleman Counseling Services",
      "Student Success Center",
      "Career Center",
      "Student Financial Services",
      "Wellness Resource Center",
      "Disability Resources and Services",
      "Dean of Students",
    ]);
    expect(backend.web.requests).toEqual(OFFICES.flatMap((office) => office.pages));
  });

  it("keeps each item's Source: the page address, its title and when it was last seen", async () => {
    await discover();

    const [item] = backend.guidebook.search("essay");

    expect(item).toMatchObject({
      kind: "resource",
      name: "Writing Center",
      sources: [
        {
          url: WRITING_CENTER_PAGE,
          title: "Writing Center | Student Success Center",
          lastSeenAt: backend.clock.now().toISOString(),
        },
      ],
    });
  });

  it("merges the same thing found twice, keeping both Sources, and keeps a Contact apart from a Resource", async () => {
    await discover(
      [{ name: "The Writing Center", summary: "On the first page." }],
      [{ name: "Temple University Writing Center", summary: "On the second page." }],
      [{ name: "writing center", summary: "On the third page.", kind: "contact" }],
    );

    const items = backend.guidebook.search("writing");

    expect(items.map((item) => item.kind).sort()).toEqual(["contact", "resource"]);
    expect(items.find((item) => item.kind === "resource")!.sources.map((source) => source.url).sort()).toEqual(
      [TUTTLEMAN_CONTACT_PAGE, WRITING_CENTER_PAGE].sort(),
    );
  });

  it("merges an item Haiku lists twice on one page", async () => {
    await discover([WRITING_CENTER, WRITING_CENTER]);

    expect(backend.guidebook.search("essay")).toHaveLength(1);
  });

  it("tells Haiku the names it already has from this office, so that an item keeps its name", async () => {
    await discover();
    officeEdits(WRITING_CENTER_PAGE, "New hours.");
    backend.claude.requests.length = 0;

    backend.clock.moveForward(DAY);
    backend.claude.willReply(haikuFinds(WRITING_CENTER));
    await backend.discovery.run();

    expect(backend.claude.requests).toHaveLength(1);
    expect(JSON.stringify(backend.claude.requests[0]!.messages)).toContain("- Writing Center");
  });

  it("doesn't ask Haiku about a page whose words haven't changed, and still counts its items as seen", async () => {
    await discover();
    backend.claude.requests.length = 0;

    backend.clock.moveForward(DAY);
    await backend.discovery.run();

    expect(backend.claude.requests).toEqual([]);
    expect(backend.guidebook.search("essay")[0]!.sources[0]!.lastSeenAt).toBe(backend.clock.now().toISOString());
  });

  it("asks again the next day if Haiku failed, losing nothing meanwhile", async () => {
    await discover();
    officeEdits(WRITING_CENTER_PAGE, "New hours.");
    backend.claude.requests.length = 0;
    backend.claude.willReply({ failWith: new Error("Haiku is down") }, haikuFinds(WRITING_CENTER));

    backend.clock.moveForward(DAY);
    await backend.discovery.run();
    expect(backend.guidebook.search("essay")).toHaveLength(1);

    backend.clock.moveForward(DAY);
    await backend.discovery.run();

    expect(backend.claude.requests).toHaveLength(2);
    expect(backend.guidebook.search("essay")).toHaveLength(1);
  });

  it.each([
    ["refuses", { stopReason: "refusal" as const }],
    ["is cut off", { stopReason: "max_tokens" as const }],
    ["answers with something else", { content: undefined, chunks: ["Sorry, no JSON here"] }],
    ["answers in the wrong shape", { content: undefined, chunks: ['{"items":[{"name":3}]}'] }],
  ])("saves nothing from a page when Haiku %s", async (_name, reply) => {
    backend.claude.willReply({ ...haikuFinds(WRITING_CENTER), ...reply }, nothingFound, nothingFound);

    await backend.discovery.run();

    expect(backend.guidebook.search("essay")).toEqual([]);
  });

  it("lists the read in Activity, with any page it couldn't read", async () => {
    backend.web.save(HEADSHOTS_PAGE, "Gone", 404);
    backend.claude.willReply(haikuFinds(WRITING_CENTER), nothingFound);

    await backend.discovery.run();

    expect((await backend.activity())[0]).toMatchObject({
      kind: "discovery_read",
      title: "Buddy read Temple's office pages",
      detail: `Read 2 of 3 pages. Couldn't read: ${HEADSHOTS_PAGE}`,
    });
  });

  it("says so in Activity when nothing could be read", async () => {
    backend.web.unreachable = true;

    await backend.discovery.run();

    expect((await backend.activity())[0]).toMatchObject({
      kind: "discovery_read_failed",
      title: "Buddy couldn't read Temple's office pages",
    });
  });
});

describe("not taking Haiku's word for it", () => {
  it("drops a phone number that isn't on the page, and keeps one that is", async () => {
    await discover(
      [],
      [
        { name: "Real office", kind: "contact", phone: "(215) 204-7276" },
        { name: "Invented office", kind: "contact", phone: "(215) 555-0000" },
      ],
    );

    expect(backend.guidebook.search("real", { kind: "contact" })[0]).toMatchObject({
      phone: "(215) 204-7276",
      phoneToDial: "+12152047276",
    });
    expect(backend.guidebook.search("invented", { kind: "contact" })[0]).toMatchObject({ phone: null, phoneToDial: null });
  });

  it("drops an email address that isn't on the page", async () => {
    await discover([{ name: "Writing Center", email: "invented@temple.edu" }]);

    expect(backend.guidebook.search("writing")[0]!.email).toBeNull();
  });

  it("drops hours or a place with a number that isn't on the page", async () => {
    await discover([], [{ name: "Tuttleman", place: "9999 Fake Street", hours: "8:00am-5:00pm" }]);

    expect(backend.guidebook.search("tuttleman")[0]).toMatchObject({ place: null, hours: "8:00am-5:00pm" });
  });

  it("leaves out an item whose summary has a number that isn't on the page", async () => {
    await discover([{ name: "Writing Center", summary: "Open 9999 days a year." }]);

    expect(backend.guidebook.search("writing")).toEqual([]);
  });

  it("won't call something free unless the page's own words say so", async () => {
    await discover(
      [],
      [],
      [
        { name: "Headshots", cost: "free", cost_quote: "We offer FREE LinkedIn headshots" },
        { name: "Padfolio", cost: "free", cost_quote: "Everything here is free of charge" },
        { name: "Coaching", cost: "free", cost_quote: null },
      ],
    );

    expect(backend.guidebook.search("headshots")[0]!.cost).toBe("Free");
    expect(backend.guidebook.search("padfolio")[0]!.cost).toBe("Its Source doesn't say what this costs.");
    expect(backend.guidebook.search("coaching")[0]!.cost).toBe("Its Source doesn't say what this costs.");
  });

  it("won't take a price whose number isn't in the words it quotes, even if the number is elsewhere on the page", async () => {
    officeEdits(TUTTLEMAN_CONTACT_PAGE, "Each session has a fee.");

    await discover(
      [],
      [{ name: "Sessions", cost: "paid", cost_amount: "$215 per session", cost_quote: "Each session has a fee" }],
    );

    expect(backend.guidebook.search("sessions")[0]!.cost).toBe("There's a fee, but its Source doesn't say how much. Ask before you sign up.");
  });

  it("won't take a phone number made of digits that are only scattered around the page", async () => {
    backend.web.save(
      HEADSHOTS_PAGE,
      `<html><head><title>Scattered</title></head><body><p>${"Words on the page. ".repeat(20)} Room 215, floor 204, code 7276.</p></body></html>`,
    );

    await discover([], [], [{ name: "Scattered office", kind: "contact", phone: "(215) 204-7276" }]);

    expect(backend.guidebook.search("scattered", { kind: "contact" })[0]!.phone).toBeNull();
  });

  it("won't take a number that only appears as part of a longer one on the page", async () => {
    await discover([], [{ name: "Tuttleman", hours: "Open 727 days" }]);

    expect(backend.guidebook.search("tuttleman")[0]!.hours).toBeNull();
  });

  it("won't take a quote from the page that doesn't talk about cost", async () => {
    await discover(
      [],
      [
        { name: "Called free", cost: "free", cost_quote: "Office hours" },
        { name: "Called paid", cost: "paid", cost_amount: null, cost_quote: "Office hours" },
      ],
    );

    expect(backend.guidebook.search("called free")[0]!.cost).toBe("Its Source doesn't say what this costs.");
    expect(backend.guidebook.search("called paid")[0]!.cost).toBe("Its Source doesn't say what this costs.");
  });

  it("gives a Contact no cost at all", async () => {
    await discover([], [{ name: "Tuttleman", kind: "contact", cost: "free", cost_quote: null }]);

    expect(backend.guidebook.search("tuttleman")[0]!.cost).toBeNull();
  });
});

describe("what things cost", () => {
  const withFees = () => backend.web.save(HEADSHOTS_PAGE, `${savedOfficePage(HEADSHOTS_PAGE)}<p>Each session costs $25 and the padfolio is $10.</p>`);

  it("says what something costs, and says so when its Source doesn't", async () => {
    withFees();
    await discover(
      [],
      [],
      [
        { name: "Sessions", cost: "paid", cost_amount: "$25 per session", cost_quote: "Each session costs $25" },
        { name: "Mystery", cost: "paid", cost_amount: null, cost_quote: "Each session costs" },
        { name: "Padfolio", cost: "paid", cost_amount: "$99", cost_quote: "the padfolio is $10" },
      ],
    );

    const noAmount = "There's a fee, but its Source doesn't say how much. Ask before you sign up.";
    expect(backend.guidebook.search("sessions")[0]!.cost).toBe("Costs $25 per session");
    expect(backend.guidebook.search("mystery")[0]!.cost).toBe(noAmount);
    expect(backend.guidebook.search("padfolio")[0]!.cost).toBe(noAmount);
  });

  it("puts free Resources first, then those with no cost given, then those that cost money", async () => {
    withFees();
    await discover(
      [],
      [],
      [
        // The best match by its words, which doesn't get it ahead of a free one.
        { name: "Paid tutoring", cost: "paid", cost_amount: "$25", cost_quote: "Each session costs $25", search_terms: ["tutoring"] },
        { name: "Other tutoring" },
        { name: "Free tutoring", cost: "free", cost_quote: "We offer FREE LinkedIn headshots" },
      ],
    );

    expect(backend.guidebook.search("tutoring").map((item) => item.name)).toEqual(["Free tutoring", "Other tutoring", "Paid tutoring"]);
  });

  it("says a merged item costs money if any of its Sources says so", async () => {
    backend.web.save(TUTTLEMAN_CONTACT_PAGE, `${savedOfficePage(TUTTLEMAN_CONTACT_PAGE)}<p>Each session costs $25.</p>`);
    await discover(
      [],
      [{ name: "Tutoring", cost: "paid", cost_amount: "$25", cost_quote: "Each session costs $25" }],
      [{ name: "Tutoring", cost: "free", cost_quote: "We offer FREE LinkedIn headshots" }],
    );

    expect(backend.guidebook.search("tutoring")[0]!.cost).toBe("Costs $25");
  });
});

describe("searching", () => {
  beforeEach(async () => {
    await discover(
      [WRITING_CENTER],
      [{ name: "Tuttleman Counseling Services", kind: "contact", summary: "Counseling for Students.", phone: "(215) 204-7276" }],
    );
  });

  it("finds an item by a word its Source never uses but a Student would", () => {
    expect(backend.guidebook.search("Where can I get help with my essays?").map((item) => item.name)).toEqual(["Writing Center"]);
  });

  it("finds nothing for a question with nothing in the Guidebook, or only filler words", () => {
    expect(backend.guidebook.search("parking permits")).toEqual([]);
    expect(backend.guidebook.search("where can I get help")).toEqual([]);
  });

  it("matches the different forms of a word", async () => {
    officeEdits(HEADSHOTS_PAGE, "Now rewritten.");
    backend.claude.willReply(haikuFinds({ name: "Peer tutoring" }, { name: "Math tutors" }));
    await backend.discovery.run();

    const names = (query: string) => backend.guidebook.search(query).map((item) => item.name).sort();
    expect(names("tutor")).toEqual(["Math tutors", "Peer tutoring", "Writing Center"]);
    expect(names("tutoring")).toEqual(["Math tutors", "Peer tutoring", "Writing Center"]);
    expect(names("tutors")).toEqual(["Math tutors", "Peer tutoring", "Writing Center"]);
  });

  it("can look for Contacts only", () => {
    expect(backend.guidebook.search("counseling", { kind: "contact" })).toHaveLength(1);
    expect(backend.guidebook.search("essay", { kind: "contact" })).toEqual([]);
  });
});

describe("items that go missing from their Source", () => {
  async function officeRemovesTheWritingCenter() {
    await discover();
    officeEdits(WRITING_CENTER_PAGE, "Rewritten without it.");
    backend.claude.willReply(nothingFound);
    await backend.discovery.run();
  }

  it("stays for just under two weeks after it goes missing, and leaves at two weeks", async () => {
    await officeRemovesTheWritingCenter();

    backend.clock.moveForward(14 * DAY - HOUR);
    await backend.discovery.run();
    expect(backend.guidebook.search("essay")).toHaveLength(1);

    backend.clock.moveForward(HOUR);
    await backend.discovery.run();
    expect(backend.guidebook.search("essay")).toEqual([]);
  });

  it("shows when it was last seen, which stops moving once it's missing", async () => {
    const seenAt = backend.clock.now().toISOString();
    await discover();
    backend.clock.moveForward(DAY);
    officeEdits(WRITING_CENTER_PAGE, "Rewritten without it.");
    backend.claude.willReply(nothingFound);
    await backend.discovery.run();

    backend.clock.moveForward(DAY);
    await backend.discovery.run();

    expect(backend.guidebook.search("essay")[0]!.sources[0]!.lastSeenAt).toBe(seenAt);
  });

  it("starts the two weeks again if it comes back", async () => {
    await officeRemovesTheWritingCenter();

    backend.clock.moveForward(10 * DAY);
    officeEdits(WRITING_CENTER_PAGE, "Back again.");
    backend.claude.willReply(haikuFinds(WRITING_CENTER));
    await backend.discovery.run();

    backend.clock.moveForward(10 * DAY);
    await backend.discovery.run();
    expect(backend.guidebook.search("essay")).toHaveLength(1);
  });

  it("isn't brought back by a page whose words haven't changed", async () => {
    await officeRemovesTheWritingCenter();

    for (let day = 1; day <= 14; day++) {
      backend.clock.moveForward(DAY);
      await backend.discovery.run();
    }

    expect(backend.guidebook.search("essay")).toEqual([]);
  });

  it("stays while another of its Sources still has it", async () => {
    await discover([WRITING_CENTER], [WRITING_CENTER]);
    officeEdits(WRITING_CENTER_PAGE, "Rewritten without it.");
    backend.claude.willReply(nothingFound);
    await backend.discovery.run();

    backend.clock.moveForward(14 * DAY);
    await backend.discovery.run();

    const [item] = backend.guidebook.search("essay");
    expect(item!.sources.map((source) => source.url)).toEqual([TUTTLEMAN_CONTACT_PAGE]);
  });

  it("leaves after two weeks of its page not answering", async () => {
    await discover();
    backend.web.save(WRITING_CENTER_PAGE, "Gone", 404);

    await backend.discovery.run();
    backend.clock.moveForward(14 * DAY - HOUR);
    await backend.discovery.run();
    expect(backend.guidebook.search("essay")).toHaveLength(1);

    backend.clock.moveForward(HOUR);
    await backend.discovery.run();
    expect(backend.guidebook.search("essay")).toEqual([]);
  });

  it("counts a page that answers with next to nothing as not answering, and doesn't ask Haiku about it", async () => {
    await discover();
    backend.web.save(WRITING_CENTER_PAGE, "<html><body>Please wait</body></html>");
    backend.claude.requests.length = 0;

    await backend.discovery.run();
    expect(backend.claude.requests).toEqual([]);
    backend.clock.moveForward(14 * DAY);
    await backend.discovery.run();

    expect(backend.guidebook.search("essay")).toEqual([]);
  });

  it("stays when a page comes back within the two weeks", async () => {
    await discover();
    backend.web.save(WRITING_CENTER_PAGE, "Gone", 404);
    await backend.discovery.run();

    backend.clock.moveForward(13 * DAY);
    backend.web.save(WRITING_CENTER_PAGE, savedOfficePage(WRITING_CENTER_PAGE));
    await backend.discovery.run();
    backend.clock.moveForward(13 * DAY);
    await backend.discovery.run();

    expect(backend.guidebook.search("essay")).toHaveLength(1);
  });

  it("comes back when its page returns with the same words after more than two weeks", async () => {
    await discover();
    backend.web.save(WRITING_CENTER_PAGE, "Gone", 404);
    await backend.discovery.run();
    backend.clock.moveForward(14 * DAY);
    await backend.discovery.run();
    expect(backend.guidebook.search("essay")).toEqual([]);

    backend.web.save(WRITING_CENTER_PAGE, savedOfficePage(WRITING_CENTER_PAGE));
    backend.claude.willReply(haikuFinds(WRITING_CENTER));
    backend.clock.moveForward(DAY);
    await backend.discovery.run();

    expect(backend.guidebook.search("essay")).toHaveLength(1);
  });

  it("doesn't count time the laptop couldn't reach the web at all", async () => {
    await discover();
    backend.web.unreachable = true;
    await backend.discovery.run();

    backend.clock.moveForward(30 * DAY);
    await backend.discovery.run();

    expect(backend.guidebook.search("essay")).toHaveLength(1);
  });

  it("carries on across a restart", async () => {
    await officeRemovesTheWritingCenter();

    await backend.restart();
    backend.clock.moveForward(14 * DAY);
    await backend.discovery.run();

    expect(backend.guidebook.search("essay")).toEqual([]);
  });
});

describe("a Report", () => {
  async function theWritingCenter() {
    await discover();
    return backend.guidebook.search("essay")[0]!;
  }

  it("hides the item for every Student, at once", async () => {
    const item = await theWritingCenter();

    const response = await backend.report(item.id);

    expect(response.status).toBe(204);
    expect(backend.guidebook.search("essay")).toEqual([]);
    expect(backend.guidebook.itemsWithIds([item.id])).toEqual([]);
  });

  it("keeps it hidden when Discovery finds it again, on any page, after a restart too", async () => {
    const item = await theWritingCenter();
    await backend.report(item.id);

    officeEdits(WRITING_CENTER_PAGE, "Still here.");
    officeEdits(TUTTLEMAN_CONTACT_PAGE, "Mentions it now.");
    backend.claude.willReply(haikuFinds(WRITING_CENTER), haikuFinds(WRITING_CENTER));
    await backend.restart();
    backend.clock.moveForward(DAY);
    await backend.discovery.run();

    expect(backend.guidebook.search("essay")).toEqual([]);
  });

  it("stays hidden after the item has left its Source and come back", async () => {
    const item = await theWritingCenter();
    await backend.report(item.id);
    officeEdits(WRITING_CENTER_PAGE, "Rewritten without it.");
    backend.claude.willReply(nothingFound);
    await backend.discovery.run();
    backend.clock.moveForward(14 * DAY);
    await backend.discovery.run();

    officeEdits(WRITING_CENTER_PAGE, "Back again.");
    backend.claude.willReply(haikuFinds(WRITING_CENTER));
    await backend.discovery.run();

    expect(backend.guidebook.search("essay")).toEqual([]);
  });

  it("tells Haiku the reported name, so that rewording can't bring it back as something new", async () => {
    const item = await theWritingCenter();
    await backend.report(item.id);
    officeEdits(HEADSHOTS_PAGE, "Now rewritten.");
    backend.claude.requests.length = 0;
    backend.claude.willReply(nothingFound);

    await backend.discovery.run();

    expect(JSON.stringify(backend.claude.requests[0]!.messages)).toContain("- Writing Center");
  });

  it("lists once in Activity, in Buddy's words, however many times it's tapped", async () => {
    const item = await theWritingCenter();

    await backend.report(item.id);
    const again = await backend.report(item.id);

    expect(again.status).toBe(204);
    const entries = (await backend.activity()).filter((entry) => entry.kind === "guidebook_report");
    expect(entries).toEqual([
      expect.objectContaining({ title: "You reported Writing Center", detail: "Buddy no longer shows it to any Student." }),
    ]);
  });

  it("says when there's no such item", async () => {
    expect((await backend.report(999)).status).toBe(404);
    expect((await backend.report("nonsense")).status).toBe(404);
  });

  it("needs a paired phone", async () => {
    const item = await theWritingCenter();

    expect((await backend.report(item.id, {})).status).toBe(401);
    expect(backend.guidebook.search("essay")).toHaveLength(1);
  });
});

describe("browsing the Guidebook", () => {
  const COUNSELING = {
    name: "Tuttleman Counseling Services",
    summary: "Counseling for students.",
    search_terms: ["counseling"],
    cost_quote: "Services are free to enrolled students.",
    cost: "free" as const,
  };

  it("lists everything it has, with each item's kind and Sources", async () => {
    await discover([WRITING_CENTER], [COUNSELING]);

    const items = await backend.guidebookItems();

    expect(items.map((item) => item.name).toSorted()).toEqual(["Tuttleman Counseling Services", "Writing Center"]);
    const writingCenter = items.find((item) => item.name === "Writing Center")!;
    expect(writingCenter.kind).toBe("resource");
    expect(writingCenter.sources[0].url).toBe(WRITING_CENTER_PAGE);
  });

  it("puts what costs nothing first, then goes by name", async () => {
    officeEdits(TUTTLEMAN_CONTACT_PAGE, "Services are free to enrolled students.");
    await discover(
      [{ ...WRITING_CENTER, name: "Zebra Tutoring" }, { ...WRITING_CENTER, name: "Algebra Tutoring" }],
      [COUNSELING],
    );

    const costs = (await backend.guidebookItems()).map((item) => [item.name, item.cost === "Free"]);

    const free = costs.filter(([, isFree]) => isFree).map(([name]) => name);
    const rest = costs.filter(([, isFree]) => !isFree).map(([name]) => name);
    expect(free).toEqual(["Tuttleman Counseling Services"]);
    expect(rest).toEqual(["Algebra Tutoring", "Zebra Tutoring"]);
    expect(costs.map(([name]) => name)).toEqual([...free, ...rest]);
  });

  it("leaves out what was reported", async () => {
    await discover();
    const [item] = await backend.guidebookItems();

    await backend.report(item.id);

    expect(await backend.guidebookItems()).toEqual([]);
  });

  it("needs a paired phone", async () => {
    const response = await fetch(`${backend.url}/guidebook/items`);

    expect(response.status).toBe(401);
  });
});

describe("the daily schedule", () => {
  const countReads = () => backend.web.requests.length;

  beforeEach(() => {
    backend.claude.whenScriptRunsOut = nothingFound;
  });

  it("reads right away when it has never read", async () => {
    await backend.discovery.runDue();

    expect(countReads()).toBe(3);
  });

  it("reads once a day on Philadelphia's clock, from 6 a.m.", async () => {
    await backend.discovery.runDue(); // 9 a.m. on Monday, November 2
    backend.clock.moveForward(10 * HOUR);
    await backend.discovery.runDue();
    expect(countReads()).toBe(3);

    backend.clock.moveForward(10 * HOUR); // 5 a.m. on Tuesday
    await backend.discovery.runDue();
    expect(countReads()).toBe(3);

    backend.clock.moveForward(HOUR); // 6 a.m. on Tuesday
    await backend.discovery.runDue();
    expect(countReads()).toBe(6);
  });

  it("remembers its last read across a restart", async () => {
    await backend.discovery.runDue();

    await backend.restart();
    await backend.discovery.runDue();

    expect(countReads()).toBe(3);
  });

  it("reads once when the laptop wakes after missing some days", async () => {
    await backend.discovery.runDue();

    backend.clock.moveForward(5 * DAY);
    await backend.discovery.runDue();
    await backend.discovery.runDue();

    expect(countReads()).toBe(6);
  });

  it("tries again within the hour if the laptop woke before it was back online, and says so once", async () => {
    backend.web.unreachable = true;
    await backend.discovery.runDue();
    expect(countReads()).toBe(3);

    backend.clock.moveForward(HOUR - 60_000);
    await backend.discovery.runDue();
    expect(countReads()).toBe(3);

    backend.clock.moveForward(60_000);
    await backend.discovery.runDue();
    expect(countReads()).toBe(6);

    const failed = (await backend.activity()).filter((entry) => entry.kind === "discovery_read_failed");
    expect(failed).toHaveLength(1);

    backend.web.unreachable = false;
    backend.clock.moveForward(HOUR);
    await backend.discovery.runDue();
    expect(countReads()).toBe(9);
    backend.clock.moveForward(HOUR);
    await backend.discovery.runDue();
    expect(countReads()).toBe(9);
  });

  it("shares one trip when two runs overlap", async () => {
    await Promise.all([backend.discovery.run(), backend.discovery.run()]);

    expect(countReads()).toBe(3);
  });

  it("runs on a real timer once started", async () => {
    backend.discovery.startSchedule(5);

    await expect.poll(countReads).toBe(3);
    backend.discovery.stopSchedule();
  });
});
