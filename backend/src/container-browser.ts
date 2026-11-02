import { chromium, type BrowserContext, type Page } from "playwright-core";
import { PageBlocked, type BuddysBrowser, type PageReading } from "./buddys-browser.ts";
import { submitFormOnPage } from "./form-in-page.ts";
import { attachGuard, type GuardConnection } from "./guard-connection.ts";
import type { RequestGuard } from "./network-guard.ts";
import { watchForAnswers } from "./page-answers.ts";

const PAGE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** How long a page's own scripts get to finish loading what it shows, on top of the page itself. */
const SETTLE_TIMEOUT_MS = 10_000;
/** How long an app built by script gets to show what the reader is waiting for. */
const APP_TIMEOUT_MS = 30_000;
/** Once it has, what's left to come is small, and an app like this may never go quiet. */
const APP_SETTLE_TIMEOUT_MS = 3_000;
const BLOCKED_ERROR = "net::ERR_BLOCKED_BY_CLIENT";

export interface ContainerBrowserSettings {
  /** The container's control port. See browser/compose.yaml. */
  controlUrl: string;
  liveView: { host: string; port: number };
}

/**
 * Drives the container from outside. It connects for each piece of work and then lets go, so
 * nothing is attached to the browser while the Student is using it. That's how the network guard
 * steps aside during a Takeover, too: it's only ever attached for a piece of Buddy's work.
 */
export function containerBrowser(settings: ContainerBrowserSettings): BuddysBrowser {
  async function whileConnected<T>(
    work: (context: BrowserContext) => Promise<T>,
    alsoEndIf: Promise<never> = new Promise(() => {}),
  ): Promise<T> {
    const browser = await chromium.connectOverCDP(settings.controlUrl, { timeout: CONNECT_TIMEOUT_MS });
    // Closing the connection makes whatever the work does next fail, so it can't go on unguarded.
    alsoEndIf.catch(() => browser.close());
    try {
      // The default context is the one that uses the saved profile, and so the logins.
      const context = browser.contexts()[0];
      if (!context) throw new Error("Buddy's Browser has no default context");
      return await work(context);
    } finally {
      await browser.close();
    }
  }

  /** The guard goes on first and comes off last, and losing it ends the work. */
  async function whileGuarded<T>(
    guard: RequestGuard,
    work: (context: BrowserContext, guarded: GuardConnection) => Promise<T>,
  ): Promise<T> {
    const guarded = await attachGuard(settings.controlUrl, guard);
    try {
      return await whileConnected((context) => work(context, guarded), guarded.lost);
    } finally {
      guarded.close();
    }
  }

  /** A new tab with the guard already watching it. */
  async function guardedPage(context: BrowserContext, guarded: GuardConnection): Promise<Page> {
    const page = await context.newPage();
    try {
      const session = await context.newCDPSession(page);
      const { targetInfo } = await session.send("Target.getTargetInfo");
      await session.detach();
      await guarded.cover(targetInfo.targetId);
      return page;
    } catch (error) {
      await page.close();
      throw error;
    }
  }

  function blockedByGuard(error: unknown, guarded: GuardConnection): unknown {
    return error instanceof Error && error.message.includes(BLOCKED_ERROR)
      ? new PageBlocked(guarded.lastPageRefusal() ?? "The guard wouldn't let Buddy's Browser open this page")
      : error;
  }

  return {
    liveView: settings.liveView,

    // No guard, because this is for the Student, who's in control from here until they tap Done.
    show(url) {
      return whileConnected(async (context) => {
        const [screen, ...others] = context.pages();
        const page = screen ?? (await context.newPage());
        await Promise.all(others.map((other) => other.close()));
        await page.bringToFront();
        await page.goto(url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "commit" });
      });
    },

    read(url, guard, options = {}) {
      return whileGuarded(guard, async (context, guarded): Promise<PageReading> => {
        const page = await guardedPage(context, guarded);
        const answers = watchForAnswers(page, options.answersFrom);
        try {
          if (options.until) {
            // An app may never finish loading in the sense "load" means, and it says itself when it's ready.
            await page.goto(url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
            await page.waitForSelector(options.until, { state: "attached", timeout: APP_TIMEOUT_MS }).catch(() => {});
            await page.waitForLoadState("networkidle", { timeout: APP_SETTLE_TIMEOUT_MS }).catch(() => {});
          } else {
            await page.goto(url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "load" });
            // Some pages only fetch their content once they've loaded. A page that never goes quiet is read as it stands.
            await page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
          }
          await answers.arrived(SETTLE_TIMEOUT_MS);
          return {
            ...(options.answersFrom ? { answers: answers.kept() } : {}),
            url: page.url(),
            title: await page.title(),
            text: await page.locator("body").innerText({ timeout: PAGE_TIMEOUT_MS }),
            accessibilitySnapshot: await page.locator("body").ariaSnapshot({ timeout: PAGE_TIMEOUT_MS }),
            html: await page.content(),
          };
        } catch (error) {
          throw blockedByGuard(error, guarded);
        } finally {
          await page.close();
        }
      });
    },

    submitForm(form, guard) {
      return whileGuarded(guard, async (context, guarded) => {
        const page = await guardedPage(context, guarded);
        page.setDefaultTimeout(PAGE_TIMEOUT_MS);
        try {
          return await submitFormOnPage(page, form, guard);
        } catch (error) {
          throw blockedByGuard(error, guarded);
        } finally {
          await page.close();
        }
      });
    },

    clearScreen(guard) {
      return whileGuarded(guard, async (context) => {
        await Promise.all(context.pages().map((page) => page.goto("about:blank", { timeout: PAGE_TIMEOUT_MS })));
      });
    },

    forgetLogin(hosts) {
      return whileConnected(async (context) => {
        const cookies = await context.cookies();
        const domains = new Set(
          cookies.map((cookie) => cookie.domain).filter((domain) => hosts.some((host) => cookieReaches(domain, host))),
        );
        for (const domain of domains) await context.clearCookies({ domain });

        // Storage belongs to each exact origin, so clear every one the login could have used.
        const session = await context.newCDPSession(context.pages()[0] ?? (await context.newPage()));
        const origins = new Set([...hosts, ...[...domains].map((domain) => domain.replace(/^\./, ""))]);
        for (const host of origins) {
          for (const scheme of ["https", "http"]) {
            await session.send("Storage.clearDataForOrigin", {
              origin: `${scheme}://${host}`,
              storageTypes: "all",
            });
          }
        }
        await session.detach();
      });
    },
  };
}

/**
 * Whether a cookie belongs to this host's login: set on the host, on one of its subdomains, or
 * on a parent domain that the browser sends it to. Temple's sign-on could use any of them.
 */
function cookieReaches(cookieDomain: string, host: string): boolean {
  const cookieHost = cookieDomain.replace(/^\./, "");
  return (
    cookieHost === host ||
    cookieHost.endsWith(`.${host}`) ||
    (cookieDomain.startsWith(".") && host.endsWith(cookieDomain))
  );
}
