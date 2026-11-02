import type { AnswersToKeep, PageAnswer } from "./buddys-browser.ts";

/** Far more than a list of a Student's team could be, so that nothing huge is held in memory. */
const MOST_CHARACTERS = 2_000_000;
const CHECK_EVERY_MS = 50;
/** How long an answer that has started arriving gets once the time is up. */
const LAST_BODY_MS = 1_000;
/** Only what a page's scripts asked for. An image or a script could come from anything the page chose to load. */
const ASKED_FOR_BY_A_SCRIPT = new Set(["fetch", "xhr"]);

/** The little of a browser's response that this needs. */
export interface ResponseSeen {
  url(): string;
  status(): number;
  request(): { method(): string; resourceType(): string };
  text(): Promise<string>;
}

export interface WatchedAnswers {
  /** Waits until there's an answer for each path, or until the time is up, whichever comes first. */
  arrived(timeoutMs: number): Promise<void>;
  kept(): PageAnswer[];
}

export function hasPath(address: string, path: RegExp): boolean {
  return path.test(URL.parse(address)?.pathname ?? "");
}

/** On one of the hosts or their subdomains, and at one of the paths. */
export function isAnswerToKeep(address: string, { hosts, paths }: AnswersToKeep): boolean {
  const hostname = URL.parse(address)?.hostname ?? "";
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)) && paths.some((path) => hasPath(address, path));
}

/**
 * Keeps what the server tells a page's own scripts, for an app that draws its pages where a page's HTML
 * doesn't show them. This only listens: no request is made or changed, and what the guard refuses
 * never gets an answer to keep. Start it before the page opens, because the answers can come at any point.
 */
export function watchForAnswers(
  page: { on(event: "response", listener: (response: ResponseSeen) => void): unknown },
  wanted: AnswersToKeep | undefined,
): WatchedAnswers {
  const kept: PageAnswer[] = [];
  const stillReading = new Set<Promise<void>>();

  if (wanted) {
    page.on("response", (response) => {
      const request = response.request();
      if (request.method() !== "GET" || !ASKED_FOR_BY_A_SCRIPT.has(request.resourceType()) || !isAnswerToKeep(response.url(), wanted)) return;
      const reading: Promise<void> = response
        .text()
        .then((body) => {
          if (body.length <= MOST_CHARACTERS) kept.push({ url: response.url(), status: response.status(), body });
        })
        // A redirect has no body to read, and neither has a page that's gone. Either way, there's no answer.
        .catch(() => {})
        .finally(() => stillReading.delete(reading));
      stillReading.add(reading);
    });
  }

  const allThere = () => (wanted?.paths ?? []).every((path) => kept.some((answer) => hasPath(answer.url, path)));

  return {
    async arrived(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (!allThere() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, CHECK_EVERY_MS));
      }
      // Never for long: everything else in the browser, including deleting a login, waits behind a read.
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([Promise.all(stillReading), new Promise((resolve) => (timer = setTimeout(resolve, LAST_BODY_MS)))]);
      clearTimeout(timer);
    },
    kept: () => [...kept],
  };
}
