/** What Buddy read from one page. Reading never involves a screenshot. */
export interface PageReading {
  /** Where the page ended up after any redirects. */
  url: string;
  title: string;
  text: string;
  /** The page's accessibility tree, as text. */
  accessibilitySnapshot: string;
}

/**
 * Buddy's Browser, as the backend controls it from outside. It offers no way to click or
 * type: only the Student can do that, through the live view during a Takeover.
 *
 * Use this only through BrowserAccess, which keeps Buddy out during a Takeover.
 */
export interface BuddysBrowser {
  /** Where the backend connects for the live view. The app only ever reaches it through the backend. */
  readonly liveView: { host: string; port: number };
  /** Puts this page on the screen for the Student, without reading anything from it. */
  show(url: string): Promise<void>;
  /** Opens the page out of sight and reads it. */
  read(url: string): Promise<PageReading>;
  /** Takes whatever the Student left on the screen off it. */
  clearScreen(): Promise<void>;
  /** Forgets everything the browser holds for these hosts and their subdomains. */
  forgetLogin(hosts: string[]): Promise<void>;
}
