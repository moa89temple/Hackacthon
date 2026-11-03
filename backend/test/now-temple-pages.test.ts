import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readEventPage, readEventsPage } from "../src/now-temple-pages.ts";

const saved = (name: string) => readFileSync(new URL(`./fixtures/now-temple-pages/${name}`, import.meta.url), "utf8");

/** In the shape of the real list, as saved in fixtures/now-temple-pages. */
const teaser = (href: string, time: string, title: string) => `
  <section class="teaser teaser__calendar-event"><a href="${href}"><div class="content__right">
    <p class="meta__date"><time class="date">${time}</time></p>
    <h2 class="title"> ${title} <i class="las la-angle-right"></i></h2>
    <div class="intro"><p class="body">Words about it [...]</p></div>
  </div></a></section>`;

describe("the list of events on now.temple.edu", () => {
  it("reads every event on a real saved page, each with its date, its time and its own address", () => {
    const { events, understood } = readEventsPage(saved("events.html"));

    expect(understood).toBe(true);
    expect(events).toHaveLength(12);
    expect(events[0]).toEqual({
      url: "https://now.temple.edu/events/2026-11-02/temple-university-concert-choir-singing-owls",
      name: "Temple University Concert Choir and Singing Owls",
      date: "2026-11-02",
      endDate: null,
      time: "7:30 pm",
    });
    expect(events[1]).toMatchObject({ name: "Education Expo Prep for All Students", date: "2026-11-03", time: "12:00 pm to 1:00 pm" });
  });

  it("reads an event that runs over several days, as a real one does", () => {
    const { events } = readEventsPage(teaser("/events/2026-11-10/exhibition", "Tue., Nov. 10, 2026 6:00 pm to Thu., Dec. 3, 2026 6:00 pm", "Exhibition"));

    expect(events).toEqual([expect.objectContaining({ date: "2026-11-10", endDate: "2026-12-03", time: null })]);
  });

  it("gives no time for an event that lasts all day", () => {
    const { events } = readEventsPage(teaser("/events/2026-11-06/festival", "Fri., Nov. 6, 2026 12:00 am to 11:59 pm", "Festival"));

    expect(events[0]!.time).toBeNull();
  });

  it("lists an event the page shows twice only once", () => {
    const twice = teaser("/events/2026-11-11/session", "Wed., Nov. 11, 2026 5:30 pm", "Session");

    expect(readEventsPage(twice + twice).events).toHaveLength(1);
  });

  it("leaves out a cancelled event, as Temple names them", () => {
    const { events, understood } = readEventsPage(teaser("/events/2026-11-04/cancelled-ensemble", "Wed., Nov. 4, 2026 5:30 pm", "CANCELLED: Electronic Music Ensemble"));

    expect(understood).toBe(true);
    expect(events).toEqual([]);
  });

  it("says which addresses a cancelled event has or had, because Temple's can gain the word", () => {
    const { cancelled } = readEventsPage(teaser("/events/2026-11-04/cancelled-ensemble", "Wed., Nov. 4, 2026 5:30 pm", "CANCELLED: Electronic Music Ensemble"));

    expect(cancelled).toEqual(["https://now.temple.edu/events/2026-11-04/cancelled-ensemble", "https://now.temple.edu/events/2026-11-04/ensemble"]);
  });

  it("leaves out an event whose address and date disagree, because neither can be trusted", () => {
    const { events } = readEventsPage(teaser("/events/2026-11-05/session", "Wed., Nov. 4, 2026 5:30 pm", "Session"));

    expect(events).toEqual([]);
  });

  it("leaves out a link that goes anywhere but one of the site's own events", () => {
    const html = teaser("https://elsewhere.test/events/2026-11-04/session", "Wed., Nov. 4, 2026 5:30 pm", "Session") + teaser("/news/2026-11-04/story", "Wed., Nov. 4, 2026 5:30 pm", "Story");

    expect(readEventsPage(html).events).toEqual([]);
  });

  it("says it doesn't recognize a page with no events on it, such as one a script hasn't built yet", () => {
    expect(readEventsPage("<html><body><div id='app'>Please wait</div></body></html>")).toEqual({ events: [], cancelled: [], understood: false });
  });
});

describe("one event's page on now.temple.edu", () => {
  it("keeps the words of the event and leaves out the rest of the site", () => {
    const page = readEventPage(saved("temple-university-chorale-singers-voices.html"))!;

    expect(page.title).toContain("Temple University Chorale");
    expect(page.text).toContain("This event is free and open to the public.");
    expect(page.text).toContain("OPEN TO:");
    expect(page.text).not.toContain("Temple Now");
  });

  it("reads a real event that sends Students elsewhere to register, and says nothing about its cost", () => {
    const page = readEventPage(saved("education-expo-prep-all-students.html"))!;

    expect(page.text).toContain("Gain the tools you need to navigate the Ed Expo.");
    expect(page.text).toContain("Register via");
    expect(page.text).not.toMatch(/\$|\bfree\b/i);
  });

  it("says it doesn't recognize a page with no event on it", () => {
    expect(readEventPage("<html><body><div id='app'>Please wait</div></body></html>")).toBeNull();
  });
});
