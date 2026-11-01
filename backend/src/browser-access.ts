import { randomBytes } from "node:crypto";
import type { BuddysBrowser, PageReading } from "./buddys-browser.ts";
import type { Clock } from "./clock.ts";
import { THE_STUDENT, type Store, type StoredTakeover } from "./store.ts";

export interface Site {
  name: string;
  /** The page a Takeover opens, and the page read to check a login. */
  homeUrl: string;
  /** Every host that holds part of this site's login, including its single sign-on. */
  loginHosts: string[];
}

export interface Takeover {
  site: string;
  siteName: string;
  liveViewPath: string;
}

export interface FinishedTakeover {
  site: string;
  siteName: string;
  signedIn: boolean;
  /** The title of the page Buddy read to check, when it could read one. */
  title?: string;
}

/** The Student is in control, so Buddy has to stay out. */
export class TakeoverInProgress extends Error {
  constructor() {
    super("The Student is in control of Buddy's Browser");
  }
}

export class NoTakeover extends Error {
  constructor() {
    super("There is no Takeover to finish");
  }
}

export class UnknownSite extends Error {
  constructor() {
    super("Buddy doesn't know that site");
  }
}

export class BrowserUnreachable extends Error {
  constructor(cause: unknown) {
    super("Buddy's Browser can't be reached", { cause });
  }
}

/**
 * The one way into Buddy's Browser. While the Student is in control, it keeps Buddy out.
 * Nothing Buddy does overlaps with anything else in the browser, so a read can never see
 * a screen the Student has started using.
 */
export interface BrowserAccess {
  /** Reads a page. Throws TakeoverInProgress while the Student is in control. */
  read(url: string): Promise<PageReading>;
  currentTakeover(): Takeover | null;
  /** Gives the Student control. Asking again for the same site returns the Takeover under way. */
  startTakeover(site: string): Promise<Takeover>;
  /** Hands control back to Buddy, then checks the login by reading the site. */
  finishTakeover(): Promise<FinishedTakeover>;
  /** Forgets one site's login. Throws TakeoverInProgress while the Student is in control. */
  forgetLogin(site: string): Promise<void>;
  /** Whether this token belongs to a Takeover whose screen is now the Student's. */
  isLiveViewOpen(token: string): boolean;
}

export interface BrowserAccessDeps {
  browser: BuddysBrowser;
  clock: Clock;
  store: Store;
  sites: Record<string, Site>;
  /** Called the moment the Student's control ends, before Buddy touches the browser again. */
  onControlEnded: () => void;
  logError: (error: unknown) => void;
}

export function createBrowserAccess(deps: BrowserAccessDeps): BrowserAccess {
  const { browser, clock, store, sites, onControlEnded, logError } = deps;
  const oneAtATime = serialized();
  /** The Takeover whose site is still being put on the screen. It isn't the Student's yet. */
  let tokenBeingShown: string | null = null;

  function siteWithId(id: string): Site {
    if (Object.hasOwn(sites, id)) return sites[id]!;
    throw new UnknownSite();
  }

  function describeTakeover(stored: StoredTakeover): Takeover {
    return {
      site: stored.site,
      siteName: siteWithId(stored.site).name,
      liveViewPath: `/takeover/live/${stored.liveViewToken}/takeover.html`,
    };
  }

  function failIfStudentInControl(): void {
    if (store.currentTakeover(THE_STUDENT)) throw new TakeoverInProgress();
  }

  function currentTakeover(): Takeover | null {
    const stored = store.currentTakeover(THE_STUDENT);
    return stored && describeTakeover(stored);
  }

  async function read(url: string): Promise<PageReading> {
    failIfStudentInControl();
    return oneAtATime(() => {
      // A Takeover may have started while this read was waiting its turn.
      failIfStudentInControl();
      return browser.read(url);
    });
  }

  async function checkLogin(site: Site): Promise<{ signedIn: boolean; title?: string }> {
    try {
      const page = await read(site.homeUrl);
      return { signedIn: isOnSiteAndPastLogin(page.url, site), title: page.title };
    } catch (error) {
      logError(error);
      return { signedIn: false };
    }
  }

  return {
    read,
    currentTakeover,

    async startTakeover(id) {
      const site = siteWithId(id);
      const underWay = currentTakeover();
      if (underWay?.site === id) return underWay;
      if (underWay) throw new TakeoverInProgress();

      // Buddy is locked out from this line on, even if the backend restarts. Anything
      // already in the browser finishes before the Student gets the screen.
      const takeover: StoredTakeover = {
        site: id,
        liveViewToken: randomBytes(32).toString("base64url"),
        startedAt: clock.now(),
      };
      store.beginTakeover(THE_STUDENT, takeover);
      tokenBeingShown = takeover.liveViewToken;
      try {
        await oneAtATime(() => browser.show(site.homeUrl));
      } catch (error) {
        // The Student may have given up on this one and started another by now.
        if (store.currentTakeover(THE_STUDENT)?.liveViewToken === takeover.liveViewToken) {
          store.endTakeover(THE_STUDENT);
        }
        throw new BrowserUnreachable(error);
      } finally {
        if (tokenBeingShown === takeover.liveViewToken) tokenBeingShown = null;
      }
      return describeTakeover(takeover);
    },

    async finishTakeover() {
      const stored = store.currentTakeover(THE_STUDENT);
      if (!stored) throw new NoTakeover();
      const site = siteWithId(stored.site);

      onControlEnded();
      store.endTakeover(THE_STUDENT);

      try {
        await oneAtATime(() => browser.clearScreen());
      } catch (error) {
        logError(error);
      }
      return { site: stored.site, siteName: site.name, ...(await checkLogin(site)) };
    },

    async forgetLogin(id) {
      const site = siteWithId(id);
      failIfStudentInControl();
      try {
        await oneAtATime(async () => {
          failIfStudentInControl();
          // A page left open could otherwise write its login straight back.
          await browser.clearScreen();
          await browser.forgetLogin(site.loginHosts);
        });
      } catch (error) {
        if (error instanceof TakeoverInProgress) throw error;
        throw new BrowserUnreachable(error);
      }
    },

    isLiveViewOpen(token) {
      return token !== tokenBeingShown && store.currentTakeover(THE_STUDENT)?.liveViewToken === token;
    },
  };
}

function isOnSiteAndPastLogin(finalUrl: string, site: Site): boolean {
  const final = new URL(finalUrl);
  return final.hostname === new URL(site.homeUrl).hostname && !final.pathname.startsWith("/login");
}

/** Runs each piece of work only after everything before it has finished, whether it worked or not. */
function serialized(): <T>(work: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return (work) => {
    const result = last.then(work, work);
    last = result.catch(() => {});
    return result;
  };
}
