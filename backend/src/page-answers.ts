import type { PageAnswer } from "./buddys-browser.ts";

/** Far more than a list of a Student's team could be, so that nothing huge is held in memory. */
const MOST_CHARACTERS = 2_000_000;
const CHECK_EVERY_MS = 50;

/** The little of a browser's response that this needs. */
export interface ResponseSeen {
  url(): string;
  status(): number;
  request(): { method(): string };
  text(): Promise<string>;
}

export interface WatchedAnswers {
  /** Waits until there's an answer for each path, or until the time is up, whichever comes first. */
  arrived(timeoutMs: number): Promise<void>;
  kept(): PageAnswer[];
}

/**
 * Keeps what the server tells a page's own scripts, for an app that draws its pages where a page's HTML
 * doesn't show them. This only listens: no request is made or changed, and what the guard refuses
 * never gets an answer to keep. Start it before the page opens, because the answers can come at any point.
 */
export function watchForAnswers(
  page: { on(event: "response", listener: (response: ResponseSeen) => void): unknown },
  paths: RegExp[],
): WatchedAnswers {
  const kept: PageAnswer[] = [];
  const stillReading = new Set<Promise<void>>();
  const pathOf = (address: string) => URL.parse(address)?.pathname ?? "";

  if (paths.length > 0) {
    page.on("response", (response) => {
      if (response.request().method() !== "GET" || !paths.some((path) => path.test(pathOf(response.url())))) return;
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

  const allThere = () => paths.every((path) => kept.some((answer) => path.test(pathOf(answer.url))));

  return {
    async arrived(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (!allThere() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, CHECK_EVERY_MS));
      }
      await Promise.all(stillReading);
    },
    kept: () => [...kept],
  };
}
