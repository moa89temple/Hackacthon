import { chromium, type BrowserContext } from "playwright-core";
import type { BuddysBrowser, PageReading } from "./buddys-browser.ts";

const PAGE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

export interface ContainerBrowserSettings {
  /** The container's control port. See browser/compose.yaml. */
  controlUrl: string;
  liveView: { host: string; port: number };
}

/**
 * Drives the container from outside. It connects for each piece of work and then lets go, so
 * nothing is attached to the browser while the Student is using it.
 */
export function containerBrowser(settings: ContainerBrowserSettings): BuddysBrowser {
  async function whileConnected<T>(work: (context: BrowserContext) => Promise<T>): Promise<T> {
    const browser = await chromium.connectOverCDP(settings.controlUrl, { timeout: CONNECT_TIMEOUT_MS });
    try {
      // The default context is the one that uses the saved profile, and so the logins.
      const context = browser.contexts()[0];
      if (!context) throw new Error("Buddy's Browser has no default context");
      return await work(context);
    } finally {
      await browser.close();
    }
  }

  return {
    liveView: settings.liveView,

    show(url) {
      return whileConnected(async (context) => {
        const [screen, ...others] = context.pages();
        const page = screen ?? (await context.newPage());
        await Promise.all(others.map((other) => other.close()));
        await page.bringToFront();
        await page.goto(url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "commit" });
      });
    },

    read(url) {
      return whileConnected(async (context): Promise<PageReading> => {
        const page = await context.newPage();
        try {
          await page.goto(url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "load" });
          return {
            url: page.url(),
            title: await page.title(),
            text: await page.locator("body").innerText({ timeout: PAGE_TIMEOUT_MS }),
            accessibilitySnapshot: await page.locator("body").ariaSnapshot({ timeout: PAGE_TIMEOUT_MS }),
          };
        } finally {
          await page.close();
        }
      });
    },

    clearScreen() {
      return whileConnected(async (context) => {
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
