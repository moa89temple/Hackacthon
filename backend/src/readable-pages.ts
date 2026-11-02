import type { Site } from "./browser-access.ts";
import { isOnSite, type RequestGuard } from "./network-guard.ts";

/**
 * Keeps Buddy's reading to a site's `readablePages`. It only ever refuses more than the guard does,
 * so the guard's own rules come first and nothing here can let through what they refuse.
 *
 * It asks only about a page opening in a tab, including each step of a redirect. What an open page
 * loads stays with the guard and the site's `blockedPages`.
 */
export function keepToReadablePages(guard: RequestGuard, sites: Record<string, Site>): RequestGuard {
  const sitesWithList = Object.values(sites).filter((site) => site.readablePages);

  return {
    check(request) {
      const decision = guard.check(request);
      if (!decision.allowed || !request.opensPage) return decision;

      const url = URL.parse(request.url);
      if (!url) return decision;
      const owners = sitesWithList.filter((site) => isOnSite(url.hostname, site));
      if (owners.length === 0) return decision;
      // The address as it is, undecoded: a list that allows something mustn't match more than it says.
      const listed = owners.some((site) =>
        site.readablePages!.some(
          (page) =>
            page.host === url.hostname &&
            page.path.test(url.pathname) &&
            (page.fragment === undefined || url.hash === "" || page.fragment.test(url.hash)),
        ),
      );
      return listed ? decision : { allowed: false, why: `This isn't one of the pages Buddy reads on ${owners[0]!.name}: ${url.host}` };
    },
  };
}
