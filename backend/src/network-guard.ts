import type { KnownRequest, Site } from "./browser-access.ts";

/** One request Buddy's Browser is about to make. */
export interface RequestToCheck {
  url: string;
  method: string;
  /** True when it opens a page in a tab, rather than being something an open page loads. */
  opensPage: boolean;
  body?: string;
  contentType?: string;
  /** By lower-case name. */
  headers?: Record<string, string>;
}

export type GuardDecision = { allowed: true } | { allowed: false; why: string };

/** What Buddy's Browser asks about every request while Buddy is working in it. */
export interface RequestGuard {
  check(request: RequestToCheck): GuardDecision;
}

/** The one request an approved step may make, with every field it may carry. */
export interface ApprovedRequest {
  method: string;
  url: string;
  fields: [name: string, value: string][];
}

/**
 * How far an approved step has got. "sent" means the one request has left, so whatever happens
 * afterwards, it mustn't be tried again.
 */
export type StepProgress = "disarmed" | "armed" | "sent";

export interface ArmableGuard extends RequestGuard {
  /** Lets through exactly one request that matches this exactly. Then it's disarmed for good. */
  arm(request: ApprovedRequest): void;
  progress(): StepProgress;
}

/** Exactly what the Student approved sending. */
export interface ApprovedEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * How far one send has got. "closed" means it was opened and nothing went through, and "sent" means the
 * one request has been let go, so whatever happens afterwards, it mustn't be tried again.
 */
export type SendProgress = "shut" | "open" | "closed" | "sent";

export interface SendGuard extends RequestGuard {
  /** Opens the exception, for one request that carries exactly this. It can only ever be opened once. */
  open(email: ApprovedEmail): void;
  /** Shuts it for good. Safe at any time, however many times. */
  close(): void;
  progress(): SendProgress;
  /** Why what looked like the send was refused, in Buddy's words, with none of the email's. */
  refusals(): string[];
}

export interface GuardPolicy {
  /** For everything Buddy reads. It has no way to be armed, so nothing it guards can change anything. */
  forReading(): RequestGuard;
  /**
   * For the read that proves a login right after a Takeover. It's the one way into a site with no
   * Read Permission, it's for that site alone, and it still can't change anything.
   */
  forLoginCheck(siteId: string): RequestGuard;
  /**
   * For reading one public page that's on no list, such as a search result. It may open only that page's
   * exact host, it only ever reads, and it stays out of every Connection and sign-on, even one with a
   * Read Permission, because those logins are in this browser and the page could be anyone's.
   */
  forPublicPage(address: string): RequestGuard;
  /** For one approved step. Only the gate in BrowserAccess asks for this. */
  forApprovedStep(): ArmableGuard;
  /**
   * For the one routine that sends an email. Only the gate in BrowserAccess asks for this. It starts
   * shut, it's a new one for each send, and nothing else in Buddy has a way to open it.
   */
  forSending(siteId: string): SendGuard;
  /** Whether this is a page Buddy never opens, whatever a card says. */
  isBlockedPage(url: string): boolean;
}

export interface GuardPolicyDeps {
  /** Each site's own rules are data on the site. See Site in browser-access.ts. */
  sites: Record<string, Site>;
  /** Hosts Buddy may open as public pages. Each means that exact host and not its subdomains. */
  publicHosts: string[];
  hasReadPermission: (siteId: string) => boolean;
}

/** Methods that only read. Anything else counts as changing something, whatever it's called. */
const READING_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** These never leave the browser. */
const LOCAL_SCHEMES = new Set(["about:", "data:", "blob:"]);
const WEB_SCHEMES = new Set(["http:", "https:"]);
/** Names that only mean something on a private network. Docker's address for this laptop is one. */
const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet"];

/** A page can ask for anything any number of times, and this ends up in Activity. */
const MOST_NOTED_REFUSALS = 8;
/** Only an address plain enough that it can't be holding anything of the Student's. */
const PLAIN_PATH = /^\/[A-Za-z0-9_./-]{0,80}$/;
const PLAIN_ACTION = /^[A-Za-z]{1,40}$/;

const allow: GuardDecision = { allowed: true };
const refuse = (why: string): GuardDecision => ({ allowed: false, why });

/**
 * Decides what Buddy's Browser may do while Buddy is working in it. In order, the rules are:
 *
 * 1. A page on a site's `blockedPages` is refused, always. Nothing gets past this: not a Read
 *    Permission, not the read-only list, and not an approved card.
 * 2. Only the web, and only the Student's Connections and public pages. A Connection counts once it
 *    has its Read Permission. Anywhere else may only serve what an open page loads, like a font, unless
 *    it's on a site's `signOnDomains`, where nothing unlisted is loaded.
 * 3. Requests that only read go through.
 * 4. The one approved request goes through, once, if it matches exactly.
 * 5. A request on the site's `readOnlyRequests` goes through. Anything else that changes something
 *    is refused.
 *
 * An approved card only ever affects rule 4, and only for its one request. A send has its own guard
 * with a rule of its own in that place: see forSending below.
 *
 * During a Takeover none of this runs, because Buddy isn't attached to the browser at all: see
 * BrowserAccess. Whatever Buddy does after the Student taps Done is guarded again.
 */
export function createGuardPolicy({ sites, publicHosts, hasReadPermission }: GuardPolicyDeps): GuardPolicy {
  const siteEntries = Object.entries(sites);
  const publicHostSet = new Set(publicHosts);

  function isBlockedPage(url: string): boolean {
    const parsed = URL.parse(url);
    if (!parsed) return false;
    return siteEntries.some(
      ([, site]) =>
        isOnSite(parsed.hostname, site) &&
        (site.blockedPages ?? []).some(
          (page) =>
            (page.host === undefined || page.host === withoutFinalDot(parsed.hostname)) &&
            page.path.test(decodedAndLower(parsed.pathname)) &&
            (page.query === undefined || page.query.test(decodedAndLower(parsed.search))) &&
            (page.fragment === undefined || page.fragment.test(decodedAndLower(parsed.hash))),
        ),
    );
  }

  function isKnownReadOnly(url: URL, method: string, headers: Record<string, string> = {}): boolean {
    return siteEntries.some(
      ([, site]) => isOnSite(url.hostname, site) && (site.readOnlyRequests ?? []).some((known) => isKnownRequest(known, url, method, headers)),
    );
  }

  function isOnSignOnDomain(hostname: string): boolean {
    const name = withoutFinalDot(hostname);
    return siteEntries.some(([, site]) => (site.signOnDomains ?? []).some((domain) => name === domain || name.endsWith(`.${domain}`)));
  }

  /** Rules 1 and 2. */
  function placeDecision(url: URL, request: RequestToCheck, mayEnter: (siteId: string) => boolean): GuardDecision {
    if (isBlockedPage(request.url)) return refuse(`Buddy never opens this page, even with an approved card: ${url.host}`);
    const owners = siteEntries.filter(([, site]) => isOnSite(url.hostname, site));
    if (owners.length > 0) {
      if (owners.some(([id]) => mayEnter(id))) return allow;
      return refuse(`There's no Read Permission for ${owners.map(([, site]) => site.name).join(" or ")}: ${url.host}`);
    }
    if (publicHostSet.has(url.hostname)) return allow;
    if (!request.opensPage && !isOnSignOnDomain(url.hostname) && isPublicAddress(url.hostname)) return allow;
    return refuse(`This isn't one of the Student's Connections or a public page: ${url.host}`);
  }

  function checkRequest(
    request: RequestToCheck,
    mayEnter: (siteId: string) => boolean,
    takeApprovedRequest: (request: RequestToCheck) => boolean,
  ): GuardDecision {
    const url = URL.parse(request.url);
    if (!url) return refuse("That isn't an address");
    if (LOCAL_SCHEMES.has(url.protocol)) return allow;
    if (!WEB_SCHEMES.has(url.protocol)) return refuse(`Buddy's Browser only goes on the web, not to ${url.protocol}`);

    const place = placeDecision(url, request, mayEnter);
    if (!place.allowed) return place;

    const method = request.method.toUpperCase();
    if (READING_METHODS.has(method)) return allow;
    // Before the read-only list, so that an approved step always counts as having been sent.
    if (takeApprovedRequest(request)) return allow;
    if (isKnownReadOnly(url, method, request.headers)) return allow;
    return refuse(`A ${method} request changes something, and this one has no Action Permission: ${url.host}`);
  }

  const neverApproved = () => false;

  return {
    isBlockedPage,

    forReading: () => ({ check: (request) => checkRequest(request, hasReadPermission, neverApproved) }),

    forLoginCheck: (siteId) => ({
      check: (request) => checkRequest(request, (id) => id === siteId || hasReadPermission(id), neverApproved),
    }),

    forPublicPage(address) {
      const openedHost = withoutFinalDot(URL.parse(address)?.hostname ?? "");
      return {
        check(request) {
          const url = URL.parse(request.url);
          if (!url) return refuse("That isn't an address");
          if (LOCAL_SCHEMES.has(url.protocol)) return allow;
          if (!WEB_SCHEMES.has(url.protocol)) return refuse(`Buddy's Browser only goes on the web, not to ${url.protocol}`);
          if (!READING_METHODS.has(request.method.toUpperCase())) return refuse(`A public page only gets read, so a ${request.method} request is refused: ${url.host}`);
          if (siteEntries.some(([, site]) => isOnSite(url.hostname, site))) return refuse(`A public page stays out of the Student's Connections: ${url.host}`);
          // Before the list below, because what the tab ends up on gets kept as having come from the address asked for.
          if (request.opensPage && withoutFinalDot(url.hostname) !== openedHost) return refuse(`This page may only open its own host: ${url.host}`);
          if (publicHostSet.has(url.hostname)) return allow;
          if (isOnSignOnDomain(url.hostname)) return refuse(`A public page stays out of a single sign-on's domain: ${url.host}`);
          if (!isPublicAddress(url.hostname)) return refuse(`This isn't a public address: ${url.host}`);
          return allow;
        },
      };
    },

    forApprovedStep() {
      let approved: ApprovedRequest | null = null;
      let progress: StepProgress = "disarmed";
      return {
        arm(request) {
          // Armed once only: a step that's been sent can't be sent again by arming it again.
          if (progress !== "disarmed") throw new Error("This step has already been armed");
          approved = request;
          progress = "armed";
        },
        progress: () => progress,
        check: (request) =>
          checkRequest(request, hasReadPermission, (candidate) => {
            if (!approved || !isTheApprovedRequest(candidate, approved)) return false;
            approved = null;
            progress = "sent";
            return true;
          }),
      };
    },

    /**
     * Sending's narrow exception. Rules 1 and 2 stay as they are, and so does the read-only list. On top
     * of them, a page only opens if it's one a read may open or the page to write an email, and exactly
     * one request of the site's sendRequests goes through, while it's open, if it carries exactly the
     * approved email. It shuts the moment that has gone, and nothing keeps this object afterwards.
     */
    forSending(siteId) {
      const site = Object.hasOwn(sites, siteId) ? sites[siteId] : undefined;
      const rules = site?.sending;
      const pages = [...(site?.readablePages ?? []), ...(rules?.pages ?? [])];
      let approved: ApprovedEmail | null = null;
      let progress: SendProgress = "shut";
      const refusals: string[] = [];

      /** What was stopped while open, by its place and action only, so that a real send shows what Outlook really did. */
      function noteWhatWasStopped(request: RequestToCheck): void {
        const url = URL.parse(request.url);
        if (progress !== "open" || !url || READING_METHODS.has(request.method.toUpperCase()) || !isOnSite(url.hostname, site!)) return;
        if (refusals.length >= MOST_NOTED_REFUSALS || !PLAIN_PATH.test(url.pathname)) return;
        const action = url.searchParams.get("action");
        refusals.push(`The guard stopped a ${request.method} to ${url.pathname}${action && PLAIN_ACTION.test(action) ? ` for ${action}` : ""}.`);
      }

      function takeTheSend(request: RequestToCheck): boolean {
        if (!approved || !rules) return false;
        const url = new URL(request.url);
        const method = request.method.toUpperCase();
        if (!rules.sendRequests.some((known) => isKnownRequest(known, url, method, request.headers))) return false;
        const why = rules.whyNotThisEmail(request, approved);
        if (why) {
          refusals.push(why);
          return false;
        }
        approved = null;
        progress = "sent";
        return true;
      }

      return {
        open(email) {
          if (!rules) throw new Error("This site has no rule for sending");
          if (progress !== "shut") throw new Error("This send has already been opened");
          approved = email;
          progress = "open";
        },
        close() {
          approved = null;
          if (progress === "open") progress = "closed";
        },
        progress: () => progress,
        refusals: () => [...refusals],
        check(request) {
          const decision = checkRequest(request, hasReadPermission, takeTheSend);
          if (!decision.allowed) noteWhatWasStopped(request);
          if (!decision.allowed || !request.opensPage) return decision;
          const url = URL.parse(request.url);
          if (!url || !WEB_SCHEMES.has(url.protocol)) return decision;
          const listed = pages.some((page) => page.host === url.hostname && page.path.test(url.pathname));
          return listed ? decision : refuse(`This isn't a page the send routine opens: ${url.host}`);
        },
      };
    },
  };
}

function isKnownRequest(known: KnownRequest, url: URL, method: string, headers: Record<string, string> = {}): boolean {
  return (
    known.method.toUpperCase() === method &&
    known.host === url.hostname &&
    // The address as it is, undecoded: a list that allows something mustn't match more than it says.
    known.path.test(url.pathname) &&
    (known.query === undefined || known.query.test(url.search)) &&
    Object.entries(known.headers ?? {}).every(([name, value]) => headers[name] === undefined || value.test(headers[name]))
  );
}

/** Whether a host is one of this site's: its home page's, or any that holds part of its login. */
export function isOnSite(hostname: string, site: Site): boolean {
  const name = withoutFinalDot(hostname);
  return [new URL(site.homeUrl).hostname, ...site.loginHosts].some((host) => name === host || name.endsWith(`.${host}`));
}

/** "canvas.test." reaches the same place as "canvas.test", so it mustn't pass for somewhere else. */
function withoutFinalDot(hostname: string): string {
  return hostname.replace(/\.+$/, "");
}

/** Decoded and in lower case, so that a page can't be reached by spelling its address another way. */
function decodedAndLower(part: string): string {
  try {
    return decodeURIComponent(part).toLowerCase();
  } catch {
    // It can't be read, so it can't be shown not to be a blocked page. The raw address has to do.
    return part.toLowerCase();
  }
}

/**
 * Whether a host name could be on the open internet. An address given as numbers is never one here:
 * it's how a page would reach this laptop or a cloud's metadata service, and URL has already turned
 * the other spellings of those, such as 2130706433, into plain numbers.
 */
export function isPublicAddress(hostname: string): boolean {
  const name = withoutFinalDot(hostname);
  if (name.startsWith("[") || /^\d+(\.\d+){3}$/.test(name)) return false;
  if (!name.includes(".")) return false;
  return !PRIVATE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function isTheApprovedRequest(request: RequestToCheck, approved: ApprovedRequest): boolean {
  if (request.method.toUpperCase() !== approved.method.toUpperCase()) return false;
  if (!sameAddress(request.url, approved.url)) return false;
  const sent = fieldsInBody(request);
  return sent !== null && sameFields(sent, approved.fields);
}

/** Whether these go to the same place. A fragment never leaves the browser, so it doesn't count. */
export function sameAddress(left: string, right: string): boolean {
  const withoutFragment = (address: string) => {
    const url = new URL(address);
    url.hash = "";
    return url.href;
  };
  return withoutFragment(left) === withoutFragment(right);
}

/** Null when the body isn't one a form makes, so that nothing unreadable passes for the card's content. */
function fieldsInBody({ body, contentType }: RequestToCheck): [string, string][] | null {
  if (body === undefined || !contentType) return null;
  const [type, ...parameters] = contentType.split(";").map((part) => part.trim());
  if (type?.toLowerCase() === "application/x-www-form-urlencoded") return [...new URLSearchParams(body)];
  if (type?.toLowerCase() === "multipart/form-data") {
    const boundary = parameters.find((parameter) => /^boundary=/i.test(parameter))?.slice("boundary=".length);
    return boundary ? fieldsInMultipart(body, boundary.replace(/^"|"$/g, "")) : null;
  }
  return null;
}

function fieldsInMultipart(body: string, boundary: string): [string, string][] | null {
  const fields: [string, string][] = [];
  for (const part of body.split(`--${boundary}`).slice(1, -1)) {
    const match = /^\r\n([\s\S]*?)\r\n\r\n([\s\S]*)\r\n$/.exec(part);
    const name = match && /^content-disposition: *form-data; *name="([^"]*)"\s*$/im.exec(match[1]!)?.[1];
    // A file, or anything else this doesn't understand, isn't what a card covers.
    if (name === undefined || name === null) return null;
    fields.push([name, match![2]!]);
  }
  return fields;
}

/** In any order, and with a textarea's line endings either way, as the browser changes them to send. */
export function sameFields(left: [string, string][], right: [string, string][]): boolean {
  const canonical = (fields: [string, string][]) =>
    JSON.stringify(fields.map(([name, value]) => [name, value.replace(/\r\n/g, "\n")]).sort());
  return canonical(left) === canonical(right);
}
