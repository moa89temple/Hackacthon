import { randomBytes } from "node:crypto";
import { fingerprintOf } from "./action-cards.ts";
import { loginChecked } from "./activity.ts";
import {
  PageBlocked,
  SUBMIT_FORM,
  type BuddysBrowser,
  type FormStep,
  type FormSubmission,
  type FormToSubmit,
  type PageReading,
  type PageWait,
  type ReadOptions,
} from "./buddys-browser.ts";
import type { Clock } from "./clock.ts";
import type { GuardPolicy, RequestGuard } from "./network-guard.ts";
import { keepToReadablePages } from "./readable-pages.ts";
import { THE_STUDENT, type Store, type StoredTakeover } from "./store.ts";

/** Some pages of a site. */
export interface PagePattern {
  /** One exact host. Left out, it means any of the site's hosts. */
  host?: string;
  path: RegExp;
  /**
   * Only with this in the part of the address after the ?, for a site whose actions are ordinary links.
   * Only blockedPages looks at this. It's tested decoded and in lower case, like the path.
   */
  query?: RegExp;
  /**
   * The part after the #, for an app that keeps its pages there. A browser never sends this part, so
   * it's only ever tested against the address Buddy asks for, before anything opens. In `blockedPages`
   * it's tested decoded and in lower case, and in `readablePages` an address with none passes it.
   */
  fragment?: RegExp;
}

/** A request that looks like it changes something but only reads, such as a search sent by POST. */
export interface KnownRequest {
  method: string;
  /** One exact host. */
  host: string;
  /** Tested against the address's path exactly as sent, so write it to match nothing extra. */
  path: RegExp;
  /** Tested against all that follows the path, question mark included, for an address that serves many things. */
  query?: RegExp;
  /** By lower-case name. A request that carries one of these must carry a value that matches. */
  headers?: Record<string, RegExp>;
}

export interface Site {
  name: string;
  /** The page a Takeover opens, and the page read to check a login. */
  homeUrl: string;
  /** Every host that holds part of this site's login, including its single sign-on. */
  loginHosts: string[];
  /**
   * Domains this site's single sign-on works across. Any other host on them is refused unless it's a
   * site's or a listed public page, even as a frame or something a page loads, because the sign-on could
   * log it in to a Temple system with no Read Permission. This doesn't make the domain one of the site's.
   */
  signOnDomains?: string[];
  /** Other hosts a logged-in home page can end up on, for a site that moves between them. */
  appHosts?: string[];
  /** What to wait for when reading the home page to check a login, for an app built by script. */
  loginCheckWait?: PageWait;
  /** What the network guard lets through for this site without an Action Permission. See network-guard.ts. */
  readOnlyRequests?: KnownRequest[];
  /**
   * Pages Buddy never opens, reads or submits, even with an approved card, such as quizzes and rosters.
   * The path is tested decoded and in lower case, so write it in lower case.
   */
  blockedPages?: PagePattern[];
  /**
   * The only pages Buddy opens to read, with each one's exact host. Any page on any of the site's hosts
   * that isn't here is refused. Left out, the site's pages aren't limited this way. See readable-pages.ts.
   */
  readablePages?: PagePattern[];
  /**
   * This site is a Connection with the same id, so a Takeover and a login check both need its Read
   * Permission first (ADR 0001). A site without this stays as it was.
   */
  isConnection?: boolean;
  /** The only pages where Buddy may ask to submit a form. With none, it can't ask to on this site. */
  formPages?: PagePattern[];
  /**
   * Whether this address is somewhere to log in, for a site where that isn't only its /login pages, such
   * as an app that only changes the part after the #, or one that sends a login to another host.
   */
  isLoginPage?: (address: string) => boolean;
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

/** The Read Permission comes before the login, because a login is for reading. See ADR 0001. */
export class NoReadPermissionForLogin extends Error {
  constructor(siteName: string) {
    super(`Give the Read Permission for ${siteName} before logging in to it`);
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

/** The browser's submit step was reached without an approved card behind it. */
export class NoActionPermission extends Error {
  constructor() {
    super("There's no Action Permission for this step");
  }
}

/**
 * The one way into Buddy's Browser. While the Student is in control, it keeps Buddy out.
 * Nothing Buddy does overlaps with anything else in the browser, so a read can never see
 * a screen the Student has started using.
 *
 * The network guard works the same way round. It's on for everything Buddy does here, and it isn't
 * there during a Takeover because Buddy isn't: the Student's requests go straight out. From the moment
 * the Student taps Done, Buddy is only ever back in the browser under the guard.
 */
export interface BrowserAccess {
  /**
   * Reads a page. Throws TakeoverInProgress while the Student is in control, and PageBlocked unless
   * it's a public page or a Connection with its Read Permission.
   */
  read(url: string, options?: ReadOptions): Promise<PageReading>;
  /**
   * Reads one public page that needs a full browser, such as a search result built by script, under the
   * guard's forPublicPage. Throws TakeoverInProgress while the Student is in control, and PageBlocked for
   * anything but a public page.
   */
  readPublicPage(url: string): Promise<PageReading>;
  /**
   * Reads a site's home page to see whether the login works, and for nothing else. Throws PageBlocked
   * for a site that's a Connection with no Read Permission. For any other site it's the one read that
   * needs none. It's for the moments right after the Student logs in, so the Student can be told it
   * worked. Nothing from the page should be kept beyond its title and address.
   */
  readToCheckLogin(site: string): Promise<PageReading>;
  /**
   * The browser's submit step, and the last gate in front of it. It takes only a card's id and reads
   * the form from the stored card, so it can only ever submit exactly what was approved. It refuses,
   * with NoActionPermission, anything but a card whose Approve tap has just started it, whose content
   * still matches what the Student saw, and that hasn't already come through here.
   *
   * An approved card only gets a step through here. The guard still refuses a site's blockedPages, and
   * a page or site with no Read Permission.
   *
   * If this throws, nothing can have left the browser.
   */
  submitApprovedForm(cardId: number): Promise<FormSubmission>;
  currentTakeover(): Takeover | null;
  /**
   * Gives the Student control. Asking again for the same site returns the Takeover under way. Throws
   * NoReadPermissionForLogin for a site that's a Connection with no Read Permission.
   */
  startTakeover(site: string): Promise<Takeover>;
  /** Hands control back to Buddy, then checks the login by reading the site. */
  finishTakeover(): Promise<FinishedTakeover>;
  /**
   * Forgets one site's login, apart from any host another Connection with a Read Permission logs in
   * through too. Throws TakeoverInProgress while the Student is in control.
   */
  forgetLogin(site: string): Promise<void>;
  /** Whether this token belongs to a Takeover whose screen is now the Student's. */
  isLiveViewOpen(token: string): boolean;
}

export interface BrowserAccessDeps {
  browser: BuddysBrowser;
  clock: Clock;
  store: Store;
  sites: Record<string, Site>;
  guards: GuardPolicy;
  /** Called the moment the Student's control ends, before Buddy touches the browser again. */
  onControlEnded: () => void;
  logError: (error: unknown) => void;
}

export function createBrowserAccess(deps: BrowserAccessDeps): BrowserAccess {
  const { browser, clock, store, sites, guards, onControlEnded, logError } = deps;
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

  async function readUnderGuard(url: string, guard: RequestGuard, options?: ReadOptions): Promise<PageReading> {
    failIfStudentInControl();
    return oneAtATime(() => {
      // A Takeover may have started while this read was waiting its turn.
      failIfStudentInControl();
      failIfGuardRefuses(guard, url);
      return browser.read(url, guard, options);
    });
  }

  const read = (url: string, options?: ReadOptions) => readUnderGuard(url, keepToReadablePages(guards.forReading(), sites), options);

  function lacksReadPermission(id: string, site: Site): boolean {
    return site.isConnection === true && store.readPermission(THE_STUDENT, id) === null;
  }

  /**
   * The site's hosts, without those another Connection still needs. Temple's single sign-on and Duo are
   * shared, and clearing them would log that Connection out too, for no reason it could tell the Student.
   * That can't let this site in: the guard refuses its own pages with no Read Permission, however logged
   * in the sign-on is. Once the last Connection using them goes, they go with it.
   */
  function hostsToForget(id: string, site: Site): string[] {
    const stillNeeded = new Set(
      Object.entries(sites).flatMap(([otherId, other]) =>
        otherId !== id && other.isConnection === true && store.readPermission(THE_STUDENT, otherId) !== null ? other.loginHosts : [],
      ),
    );
    // The site's own address too: its storage belongs to that exact origin, whether or not a cookie is left.
    return [...new Set([new URL(site.homeUrl).hostname, ...site.loginHosts])].filter((host) => !stillNeeded.has(host));
  }

  /**
   * For a site that's a Connection, this needs the Read Permission like any other read. For any other
   * site it's the way in that has no Read Permission behind it, so it's named for the one thing it's for.
   */
  const readToCheckLogin = async (id: string) => {
    const site = siteWithId(id);
    if (lacksReadPermission(id, site)) throw new PageBlocked(`There's no Read Permission for ${site.name}`);
    return readUnderGuard(site.homeUrl, keepToReadablePages(guards.forLoginCheck(id), sites), site.loginCheckWait);
  };

  /**
   * The form on a card that's just had its Approve tap, and only once for that card. Throws
   * NoActionPermission for anything else, or if what's stored isn't what the Student saw.
   */
  function takeApprovedForm(cardId: number): FormToSubmit {
    const card = store.actionCard(THE_STUDENT, cardId);
    if (
      !card ||
      card.kind !== SUBMIT_FORM ||
      card.status !== "running" ||
      card.approvedFingerprint === null ||
      card.approvedFingerprint !== card.fingerprint ||
      card.fingerprint !== fingerprintOf(card.kind, card.content) ||
      !store.takeActionCardToBrowser(THE_STUDENT, cardId, clock.now())
    ) {
      throw new NoActionPermission();
    }
    const { site: _, ...form } = JSON.parse(card.content) as FormStep;
    return form;
  }

  async function submitApprovedForm(cardId: number): Promise<FormSubmission> {
    failIfStudentInControl();
    return oneAtATime(async () => {
      // A Takeover may have started while this step was waiting its turn.
      failIfStudentInControl();
      const form = takeApprovedForm(cardId);
      const guard = guards.forApprovedStep();
      failIfGuardRefuses(guard, form.pageUrl);
      try {
        return await browser.submitForm(form, guard);
      } catch (error) {
        if (guard.progress() === "disarmed") throw error;
        // It may have left the browser, so nobody may ever think it's safe to try again.
        logError(error);
        return { outcome: "no_clear_answer" as const };
      }
    });
  }

  async function checkLogin(id: string, site: Site): Promise<{ signedIn: boolean; title?: string }> {
    let page: PageReading;
    try {
      page = await readToCheckLogin(id);
    } catch (error) {
      logError(error);
      return { signedIn: false };
    }
    try {
      // Only that it happened: what was on the page stays out of the record.
      store.addActivity(THE_STUDENT, loginChecked(site.name, clock.now()));
    } catch (error) {
      // The Student's login is fine whether or not this could be saved.
      logError(error);
    }
    return { signedIn: isOnSiteAndPastLogin(page.url, site), title: page.title };
  }

  return {
    read,
    readPublicPage: (url) => readUnderGuard(url, guards.forPublicPage(url)),
    readToCheckLogin,
    submitApprovedForm,
    currentTakeover,

    async startTakeover(id) {
      const site = siteWithId(id);
      const underWay = currentTakeover();
      if (underWay?.site === id) return underWay;
      if (underWay) throw new TakeoverInProgress();
      if (lacksReadPermission(id, site)) throw new NoReadPermissionForLogin(site.name);

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
        // Buddy is back from here on, so the guard is too.
        await oneAtATime(() => browser.clearScreen(guards.forReading()));
      } catch (error) {
        logError(error);
      }
      return { site: stored.site, siteName: site.name, ...(await checkLogin(stored.site, site)) };
    },

    async forgetLogin(id) {
      const site = siteWithId(id);
      failIfStudentInControl();
      try {
        await oneAtATime(async () => {
          failIfStudentInControl();
          // A page left open could otherwise write its login straight back.
          await browser.clearScreen(guards.forReading());
          await browser.forgetLogin(hostsToForget(id, site));
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

/** Saves a trip to the browser, and gives a page the guard would refuse a clear answer. */
function failIfGuardRefuses(guard: RequestGuard, url: string): void {
  const decision = guard.check({ url, method: "GET", opensPage: true });
  if (!decision.allowed) throw new PageBlocked(decision.why);
}

function isOnSiteAndPastLogin(finalUrl: string, site: Site): boolean {
  const final = new URL(finalUrl);
  if (site.isLoginPage?.(finalUrl)) return false;
  return [new URL(site.homeUrl).hostname, ...(site.appHosts ?? [])].includes(final.hostname) && !final.pathname.startsWith("/login");
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
