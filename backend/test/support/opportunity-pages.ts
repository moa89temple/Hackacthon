import type { BackendHarness } from "./backend-harness.ts";
import { textBlock, type ScriptedReply } from "./scripted-claude.ts";

/** Made up, in the shape of the real pages saved in fixtures/now-temple-pages. */
export function eventsListHtml(...events: { slug: string; date: string; time: string; name: string }[]): string {
  const teasers = events.map(
    ({ slug, date, time, name }) => `
    <section class="teaser teaser__calendar-event"><a href="/events/${date}/${slug}"><div class="content__right">
      <p class="meta__date"><time class="date">${time}</time></p>
      <h2 class="title"> ${name} <i class="las la-angle-right"></i></h2>
    </div></a></section>`,
  );
  return `<html><head><title>Events | Temple Now</title></head><body>${teasers.join("")}</body></html>`;
}

export function eventPageHtml(name: string, words: string): string {
  return `<html><head><title>${name} | Temple Now</title></head><body><main>
    <article class="page page__calendar-event"><p>${words}</p><strong>OPEN TO:</strong> <span>Undergraduate Students</span></article>
  </main><footer>Temple Now. Tuition is $20,000 and the bookstore is free to visit.</footer></body></html>`;
}

/** Long enough to count as a whole page. */
export function outsidePageHtml(title: string, words: string): string {
  return `<html><head><title>${title}</title></head><body><p>${words}</p><p>${"About this organization and what it does for students. ".repeat(6)}</p></body></html>`;
}

export const FLU_CLINIC = { slug: "flu-clinic", date: "2026-11-10", time: "Tue., Nov. 10, 2026 12:00 pm to 1:00 pm", name: "Flu Shot Clinic" };
export const FLU_CLINIC_PAGE = `https://now.temple.edu/events/${FLU_CLINIC.date}/${FLU_CLINIC.slug}`;
export const EVENTS_LIST_PAGE = "https://now.temple.edu/events";

/** Haiku's answer for one page. Whatever an item leaves out is empty, as the schema allows. */
export function haikuFindsOpportunities(...items: Record<string, unknown>[]): ScriptedReply {
  const complete = items.map((item) => ({
    name: "An Opportunity",
    summary: "Helps Students.",
    open_to_students: true,
    date: "2026-12-01",
    end_date: null,
    date_kind: "deadline",
    date_quote: null,
    cost: "not_stated",
    cost_amount: null,
    cost_quote: null,
    worth_it_because: null,
    place: null,
    search_terms: [],
    ...item,
  }));
  return { content: [textBlock(JSON.stringify({ items: complete }))] };
}

const searchResult = (url: string, title = "A result") => ({ type: "web_search_result", url, title, encrypted_content: "made-up", page_age: null });

/** What one web search and its results look like in a reply, as the API docs show them. */
export function searchBlocks(...urls: string[]): any[] {
  const id = `srvtoolu_${urls.length}`;
  return [
    { type: "server_tool_use", id, name: "web_search", input: { query: "made up" } },
    { type: "web_search_tool_result", tool_use_id: id, content: urls.map((url) => searchResult(url)) },
  ];
}

/** Claude searching the web and then picking these pages. */
export function claudeSearches(found: string[], picked: string[] = found): ScriptedReply {
  return { content: [...searchBlocks(...found), textBlock(picked.join("\n"))] as ScriptedReply["content"] };
}

/** What the app's calls to the Opportunities' routes do, for one harness. */
export function opportunityCalls(backend: BackendHarness) {
  const call = (method: string, path: string) => fetch(`${backend.url}${path}`, { method, headers: backend.deviceHeaders });
  return {
    list: async (): Promise<any[]> => ((await (await call("GET", "/opportunities")).json()) as { opportunities: any[] }).opportunities,
    save: (id: unknown) => call("PUT", `/opportunities/${id}/saved`),
    unsave: (id: unknown) => call("DELETE", `/opportunities/${id}/saved`),
    report: (id: unknown) => call("POST", `/opportunities/${id}/report`),
  };
}
