import { TakeoverInProgress } from "./browser-access.ts";
import { PageBlocked, type PageReading } from "./buddys-browser.ts";
import { LoginNeeded, ReadProblem, type ConnectionType, type ReadContext } from "./connections.ts";
import { LIST_READY, LISTING_READY, readListingPage, readListPage } from "./handshake-pages.ts";
import { HANDSHAKE_ID, HANDSHAKE_LISTS, HANDSHAKE_NAME, isFromHandshake, isHandshakeLoginPage, kindOfListingAt, type ListingKind } from "./handshake-rules.ts";
import { BackgroundLimitReached } from "./spending.ts";

const LOG_IN = "Buddy needs you to log in to Handshake before it can read it. Tap Log in to Handshake on the You tab.";
const COULD_NOT_OPEN = "Buddy's Browser couldn't open Handshake. Check that it's running. Buddy will try again at its next read, or you can tap Read now.";
const STUDENT_IN_CONTROL = "Buddy didn't finish reading Handshake because a Takeover was open in Buddy's Browser. Once it's finished with Done, tap Read now.";
const COULD_NOT_UNDERSTAND = "Buddy opened Handshake but couldn't make sense of it, so what it already found stays as it was. Handshake may have changed how it works.";
const MISSED_PART = "Buddy couldn't read part of Handshake, so it may have missed some jobs or events. It will try again at its next read, or you can tap Read now.";
const STOPPED_FOR_TODAY = "Buddy has used today's limit for background work, so it will read the rest of Handshake tomorrow. What it already found stays as it was.";

/** Whether a page Buddy opened is somewhere to log in, whichever way it got sent there. */
function failIfLoggedOut(page: PageReading): void {
  if (isHandshakeLoginPage(page.url)) throw new LoginNeeded(LOG_IN);
}

type ListOutcome = { listings: string[] } | { failed: "refused" | "unreachable" | "not_understood" };

async function openList({ browser }: ReadContext, kind: ListingKind): Promise<ListOutcome> {
  let page: PageReading;
  try {
    page = await browser.read(HANDSHAKE_LISTS[kind], { until: LIST_READY[kind] });
  } catch (error) {
    if (error instanceof TakeoverInProgress) throw new ReadProblem(STUDENT_IN_CONTROL);
    return { failed: error instanceof PageBlocked ? "refused" : "unreachable" };
  }
  failIfLoggedOut(page);
  const listings = readListPage(page.html, page.url, kind);
  return listings ? { listings } : { failed: "not_understood" };
}

/** Whether Buddy got what it came for. A failure is counted and doesn't stop the read, unless the login has gone. */
async function takeInListing({ browser, opportunityPages, now }: ReadContext, url: string, kind: ListingKind): Promise<"read" | "missed" | "stopped"> {
  try {
    const page = await browser.read(url, { until: LISTING_READY });
    failIfLoggedOut(page);
    const listing = kindOfListingAt(page.url) === kind ? readListingPage(page.html) : null;
    if (!listing) return "missed";
    await opportunityPages.takeIn({ url, page: listing, oneEvent: kind === "event" }, now);
    return "read";
  } catch (error) {
    if (error instanceof ReadProblem) throw error;
    if (error instanceof TakeoverInProgress) throw new ReadProblem(STUDENT_IN_CONTROL);
    return error instanceof BackgroundLimitReached ? "stopped" : "missed";
  }
}

async function readHandshake(context: ReadContext): Promise<[]> {
  const { opportunityPages, now, reportMissed } = context;
  const jobs = await openList(context, "job");
  const events = await openList(context, "event");

  if ("failed" in jobs && "failed" in events) {
    // Neither page is ever closed to someone logged in, so being refused both means the login has gone.
    if (jobs.failed === "refused" && events.failed === "refused") throw new LoginNeeded(LOG_IN);
    if (jobs.failed === "unreachable" || events.failed === "unreachable") throw new ReadProblem(COULD_NOT_OPEN);
    throw new ReadProblem(COULD_NOT_UNDERSTAND);
  }

  let missed = "failed" in jobs || "failed" in events;
  const listed = [
    ...("failed" in jobs ? [] : jobs.listings.map((url) => ({ url, kind: "job" as const }))),
    ...("failed" in events ? [] : events.listings.map((url) => ({ url, kind: "event" as const }))),
  ];
  // Once the limit has stopped it, it opens no more pages, because Claude can't read them today. Each is still
  // confirmed as being on its list, and it's opened at a later read because nothing says it has been read.
  let stopped = false;
  for (const { url, kind } of listed) {
    if (opportunityPages.confirmIfNothingToAsk(url, now) || stopped) continue;
    const outcome = await takeInListing(context, url, kind);
    if (outcome === "missed") missed = true;
    if (outcome === "stopped") stopped = true;
  }

  // Only the first of each list gets read, so something can drop off the list while its own page, its Source, is still
  // there. So that gets looked at directly. If it's gone, that's no problem to report: it leaves after two weeks.
  const onLists = new Set(listed.map(({ url }) => url));
  for (const url of opportunityPages.pagesNotSeenLately(now)) {
    if (stopped) break;
    const kind = kindOfListingAt(url);
    if (kind && isFromHandshake(url) && !onLists.has(url)) stopped = (await takeInListing(context, url, kind)) === "stopped";
  }

  if (stopped) reportMissed(STOPPED_FOR_TODAY);
  else if (missed) reportMissed(MISSED_PART);
  // What it finds goes to the Opportunities. A job isn't something about the Student, so none of it is a Profile fact.
  return [];
}

/**
 * Handshake, read through Buddy's Browser. Where it may go, and what it assumes about the addresses, is in
 * handshake-rules.ts. What it assumes about the pages is in handshake-pages.ts. Neither has been compared with
 * the real site yet: run `npm run check-handshake` after the Student's first login. Nothing is clicked or sent:
 * the guard refuses anything that isn't a read, and the only pages opened are the ones on the list.
 */
export const handshake: ConnectionType = {
  id: HANDSHAKE_ID,
  name: HANDSHAKE_NAME,
  logsIn: true,
  card: {
    why: "So Buddy can find jobs and events that fit your Goals.",
    reads: [
      "Jobs and internships on Handshake's job list, and events on its events list: the first ones each list shows, and each one's own page.",
      "Those that fit your Goals and have a deadline or a date become Opportunities, each with its date, what it costs, and its Handshake page as its Source.",
    ],
    notes: [
      "Buddy opens only Handshake's job list, its events list and each listing's own page. It doesn't open your applications, your messages, your documents or other students' profiles.",
      "Buddy never applies to a job, never RSVPs or registers for an event, and never sends a message on Handshake, and it doesn't save or follow anything there. Buddy's code stops all of this, so nothing the AI reads can change it.",
      "To see whether a listing fits your Goals, Buddy sends the main part of its page and your Goals to Claude, the AI behind Buddy.",
      "You log in yourself through a Takeover, so Buddy never learns your password. After you give this Read Permission, Buddy asks you to log in if it needs you to, and asks again whenever the login expires.",
      "Buddy reads it at 7 a.m., 1 p.m. and 7 p.m., and when you ask. If your laptop was asleep at one of those times, it reads when the laptop wakes.",
      "They show as Outside Temple, because Handshake isn't Temple's own site, even when it's a Temple event.",
      "You can revoke this at any time on the You tab. That deletes every Opportunity that came only from Handshake, including any you saved, and your login in Buddy's Browser. Temple's sign-on stays as long as another Connection, such as Canvas, still has its Read Permission, so that one keeps working. It goes with the last of them. One you reported stays hidden, so its name stays too. Whatever was already shown to Claude stays in your conversation's history and in Activity until those are deleted, and Buddy is told not to use it.",
    ],
    warning:
      "Temple's Guidelines for Generative AI require approval from its Chief Information Security Officer before non-public data is used with an AI tool, and Buddy doesn't have that. Handshake hasn't approved Buddy either, and Buddy hasn't been able to check whether Handshake's own terms allow reading it with an automated tool. If Handshake or Temple objects, your account could be affected.",
    address: null,
  },

  whileOnTellClaude: "What Buddy finds on it that fits their Goals is among the Opportunities, so find_opportunities gives it, each with its Source.",

  isItsOpportunityPage: isFromHandshake,
  read: readHandshake,
  // No tool asks for this. What's read from Handshake reaches Claude only as Opportunities.
  describeForClaude: () => "What Buddy finds on Handshake is among the Opportunities. Use find_opportunities.",
};
