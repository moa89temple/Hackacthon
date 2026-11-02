import type { PagePattern, Site } from "./browser-access.ts";

/**
 * Everything Buddy assumes about TUportal's addresses, in one place. NOTHING HERE HAS BEEN CHECKED AGAINST
 * A REAL LOGIN. `npm run check-tuportal` shows where each guess lands, without showing the Student's records.
 *
 * What Temple's public pages say, as of November 2026:
 * - registrar.temple.edu/course-registration links View Holds at
 *   tuportal.temple.edu/web/home-community/student-record-services?holds?pweb.
 * - its.temple.edu's articles link tuportal6.temple.edu/group/home/student-record-services?contactus?pweb.
 * - bursar.temple.edu and sfs.temple.edu say to log in at tuportal6.temple.edu, and that the live snapshot of
 *   the account is on the Cost & Aid tab, which is also the way into TUpay.
 * - registrar.temple.edu's pages put registration on the Student tab, in its Registration channel, and
 *   add/drop on Student Tools, in its SSB9 Registration channel.
 *
 * What's a guess:
 * - TUPORTAL_HOST as the host the reader starts from, and that logged in, /group/home is the home page.
 * - The addresses of the Cost & Aid and Student tabs in TUPORTAL_PAGES. Only the holds page's is from Temple.
 * - That any of these pages hold what's wanted in the page itself, rather than in a frame from Banner.
 * - BANNER_HOSTS, which come from memory rather than from anything of Temple's that could be read.
 * - The Touchnet hosts behind TUpay.
 */

/** The Connection's id. It's also the site's id, because the guard checks the Read Permission by it. */
export const TUPORTAL_ID = "tuportal";
export const TUPORTAL_HOST = "tuportal6.temple.edu";
export const TUPORTAL_HOME = `https://${TUPORTAL_HOST}/`;
const TUPORTAL_HOSTS = [TUPORTAL_HOST, "tuportal.temple.edu"];
const SIGN_ON_HOST = "fim.temple.edu";
const DUO_HOST = "duosecurity.com";

/** Self-Service Banner. Nothing on it is opened: see TUPORTAL_BLOCKED_PAGES. */
const BANNER_HOSTS = ["prd-wlssb.temple.edu", "prd-xereg.temple.edu"];
/** Where the Student pays. Nothing on them is opened either. */
const PAYMENT_HOSTS = ["tupay.temple.edu", "secure.touchnet.com", "secure.touchnet.net"];

/** The reader opens these and no others, with what each one is for. */
export const TUPORTAL_PAGES = {
  home: "/group/home",
  holds: "/group/home/student-record-services?holds?pweb",
  balance: "/group/home/costs-and-aid",
  registration: "/group/home/student",
};

export type TuportalPage = keyof typeof TUPORTAL_PAGES;

const pathOf = (address: string) => new URL(address, TUPORTAL_HOME).pathname;

/**
 * Whether this address is the page that was asked for, wherever the portal keeps it for someone logged in.
 * A page that ends up anywhere else isn't that page, however much it looks like it.
 */
export function isTuportalPage(page: TuportalPage, address: string): boolean {
  const url = URL.parse(address);
  if (!url) return false;
  const wanted = pathOf(TUPORTAL_PAGES[page]);
  return url.pathname === wanted || url.pathname === wanted.replace(/^\/group\/home/, "/web/home-community");
}

/**
 * The only pages Buddy opens on TUportal. Each is tested by its path as it is, so a page that isn't
 * exactly one of these isn't one of these. The part after the ? isn't tested, which is why it's the
 * blocked pages that deal with an action sent as a link.
 */
export function tuportalReadablePages(hosts: string[] = TUPORTAL_HOSTS): PagePattern[] {
  const paths = Object.values(TUPORTAL_PAGES).map(pathOf);
  return [
    ...hosts.flatMap((host) => [
      // Where a login check starts.
      { host, path: /^\/$/ },
      ...paths.flatMap((path) => [
        { host, path: new RegExp(`^${path}$`) },
        { host, path: new RegExp(`^${path.replace(/^\/group\/home/, "/web/home-community")}$`) },
      ]),
      // Only so that a read can see a login has expired. Nothing is taken from these pages.
      { host, path: /^\/c\/portal\/(?:login|saml(?:\/|$))/ },
    ]),
    { host: SIGN_ON_HOST, path: /^\// },
  ];
}

/** The words that make a page on the portal one Buddy never opens. Each has to be a whole word in the address. */
const NEVER_WORDS = [
  // Paying.
  "tupay|pay|payment|payments|epay|touchnet|checkout|cart|refund|refunds|authorized-payer|e-?check",
  // Changing registration.
  "register|registration|registrations|add-?drop|adddrop|addordrop|classregistration|studentregistrationssb|bwskfreg|bwckcoms|bwckregs|planahead|plan-your-schedule|waitlist|waitlisting|withdraw|withdrawal|drop",
  // Forms, and anything that files something.
  "forms?|submit|apply|application|applications|petition|petitions|declaration|declarations|consent|authorize|authorization|accept|decline|sign|signature|request|requests|update|edit|change|proxy",
  // Logging out would lose the login. It's a plain link, so that nobody has to submit anything.
  "logout|logoff|signout|sign-out|p_logout",
].join("|");
const NEVER_WORD = new RegExp(`(?:^|[/_.;-])(?:${NEVER_WORDS})(?:$|[/_.;-])`);

const everyPageOf = (hosts: string[]): PagePattern[] => hosts.map((host) => ({ host, path: /^/ }));

/**
 * Pages Buddy never opens, reads or submits, even with an approved card. The guard refuses these first,
 * for pages, frames, redirects and everything a page loads. Each names its hosts, because a pattern with
 * none would apply to Temple's sign-on and to Duo too, and neither is TUportal's to limit.
 *
 * Banner is refused whole, because its pages can act on a GET: a registration page can file a change just
 * by being opened, and its addresses don't say which do. If it turns out that the holds or the balance are
 * only on Banner, that's a decision for a person, one exact page at a time, and these are the rules to change.
 */
export function tuportalBlockedPages(hosts: string[] = TUPORTAL_HOSTS): PagePattern[] {
  return [
    ...everyPageOf(BANNER_HOSTS),
    ...everyPageOf(PAYMENT_HOSTS),
    ...hosts.flatMap((host) => [
      { host, path: NEVER_WORD },
      // The portal's own actions are ordinary links, told apart only by this.
      { host, path: /^/, query: /(?:^|[?&])p_p_lifecycle=1(?:&|$)/ },
    ]),
    { host: SIGN_ON_HOST, path: /(?:^|[/_.-])(?:logout|slo)(?:$|[/_.-])/ },
  ];
}

export const TUPORTAL_BLOCKED_PAGES = tuportalBlockedPages();
export const TUPORTAL_READABLE_PAGES = tuportalReadablePages();

/** TUportal sends the browser to one of these when it isn't logged in: anywhere off the portal, or the portal's own way to the sign-on. */
export function isTuportalLoginPage(address: string, hosts: string[] = TUPORTAL_HOSTS): boolean {
  const url = URL.parse(address);
  return !url || !hosts.includes(url.hostname) || /^\/c\/portal\/(?:login|saml(?:\/|$))/.test(url.pathname);
}

export const TUPORTAL_SITE: Site = {
  name: "TUportal",
  // Where Temple tells a Student to log in, so it's what a Takeover opens.
  homeUrl: TUPORTAL_HOME,
  // Temple's single sign-on and Duo are shared with other Connections: see forgetLogin in browser-access.ts.
  // Banner and the payment hosts are listed so that the guard counts them as this site's and refuses them.
  loginHosts: [...TUPORTAL_HOSTS, SIGN_ON_HOST, DUO_HOST, ...BANNER_HOSTS, ...PAYMENT_HOSTS],
  isConnection: true,
  readablePages: TUPORTAL_READABLE_PAGES,
  blockedPages: TUPORTAL_BLOCKED_PAGES,
  isLoginPage: (address) => isTuportalLoginPage(address),
};
