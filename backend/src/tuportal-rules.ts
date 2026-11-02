import type { PagePattern, Site } from "./browser-access.ts";

/**
 * Everything Buddy assumes about TUportal's addresses, in one place. `npm run check-tuportal` shows where
 * each one lands, without showing the Student's records.
 *
 * What a real login showed, on 2026-11-02:
 * - Logged in, tuportal6.temple.edu/group/home is the home page, and the holds, Cost & Aid and Student
 *   addresses in TUPORTAL_PAGES are all real pages.
 * - The balance is in a frame on Cost & Aid: see TUPORTAL_FRAMES.
 * - The portal has no holds on it. Its registrar's Dashboard sends the Student on to Banner's
 *   bwskoacc.P_ViewHold, and that's the page the reader opens: see BANNER_PAGES.
 * - Banner's sign-on has to end on its main menu, or Banner says the session has ended. So a read goes
 *   through the sign-on first, and only then opens View Holds.
 * - That Dashboard's ajax.jsp is one address for everything it does, including amending a record and
 *   re-enrolling, chosen by a field in the body. It must never go on a read-only list by its address.
 * - The Student tab has no registration status on it, so Buddy doesn't read one.
 *
 * What Temple's public pages say, as of November 2026:
 * - its.temple.edu's articles link tuportal6.temple.edu/group/home/student-record-services?contactus?pweb.
 * - bursar.temple.edu and sfs.temple.edu say to log in at tuportal6.temple.edu, and that the live snapshot of
 *   the account is on the Cost & Aid tab, which is also the way into TUpay.
 *
 * What's a guess:
 * - BANNER_HOSTS, which come from memory rather than from anything of Temple's that could be read.
 * - The Touchnet hosts behind TUpay.
 */

/** The Connection's id. It's also the site's id, because the guard checks the Read Permission by it. */
export const TUPORTAL_ID = "tuportal";
const TUPORTAL_HOST = "tuportal6.temple.edu";
export const TUPORTAL_HOME = `https://${TUPORTAL_HOST}/`;
const TUPORTAL_HOSTS = [TUPORTAL_HOST, "tuportal.temple.edu"];
const SIGN_ON_HOST = "fim.temple.edu";
const DUO_HOST = "duosecurity.com";

/** Self-Service Banner, where opening a page can be enough to change something. Almost nothing on it is opened: see BANNER_PAGES. */
const BANNER_HOST = "prd-wlssb.temple.edu";
const BANNER_REGISTRATION_HOST = "prd-xereg.temple.edu";
const BANNER_HOSTS = [BANNER_HOST, BANNER_REGISTRATION_HOST];
export const BANNER_HOME = `https://${BANNER_HOST}/`;

/**
 * The only pages of Banner's Buddy opens. The Student chose this on 2026-11-02, for View Holds and the two
 * steps it takes to get there, and any other page of Banner's is a decision for a person, one page at a time.
 * The main menu is only a list of links, and nothing is read from it.
 */
export const BANNER_PAGES = {
  signOn: "/ssomanager/c/SSB",
  menu: "/prod8/twbkwbis.P_GenMenu",
  holds: "/prod8/bwskoacc.P_ViewHold",
};
/** The one thing the menu page may be asked for: its own name for the main menu. Decoded and in lower case, as the guard tests it. */
const BANNER_MAIN_MENU_QUERY = "?name=bmenu.p_mainmnu";
/** Where the Student pays. Nothing on them is opened either. */
const PAYMENT_HOSTS = ["tupay.temple.edu", "secure.touchnet.com", "secure.touchnet.net"];

/** The reader opens these and no others, with what each one is for. */
export const TUPORTAL_PAGES = {
  home: "/group/home",
  holds: BANNER_PAGES.holds,
  balance: "/group/home/costs-and-aid",
};

export type TuportalPage = keyof typeof TUPORTAL_PAGES;
/** A page that has something of the Student's on it, as the home page doesn't. */
export type TuportalReadPage = Exclude<TuportalPage, "home">;

/**
 * Where on its page the wanted part really is, for a page that keeps it in a frame. A real login showed the
 * Cost & Aid tab keeping "Your Current Balance" in this one. A page like this says nothing outside its frame.
 */
export const TUPORTAL_FRAMES: Partial<Record<TuportalReadPage, RegExp>> = {
  balance: /^\/html\/[^/]+\/apps\/tup\/Channels\/index\.jsp$/,
};

/** Temple links the same page under both of these, and which a logged-in browser ends up on isn't known. */
const pathsOf = (address: string) => {
  const { pathname } = new URL(address, TUPORTAL_HOME);
  return [pathname, pathname.replace(/^\/group\/home/, "/web/home-community")];
};

/** The portal's own way to the sign-on. */
const WAY_TO_SIGN_ON = /^\/c\/portal\/(?:login|saml(?:\/|$))/;

/**
 * Whether this address is the page that was asked for, wherever the portal keeps it for someone logged in.
 * A page that ends up anywhere else isn't that page, however much it looks like it.
 */
export function isTuportalPage(page: TuportalPage, address: string, bannerHost = BANNER_HOST): boolean {
  const url = URL.parse(address);
  if (!url) return false;
  // Banner's View Holds, on any other host, isn't Banner's View Holds.
  if (page === "holds") return url.hostname === bannerHost && url.pathname === BANNER_PAGES.holds;
  return pathsOf(TUPORTAL_PAGES[page]).includes(url.pathname);
}

/**
 * The only pages Buddy opens on TUportal. Each is tested by its path as it is, so a page that isn't
 * exactly one of these isn't one of these. The part after the ? isn't tested, which is why it's the
 * blocked pages that deal with an action sent as a link.
 */
export function tuportalReadablePages(hosts: string[] = TUPORTAL_HOSTS, bannerHost = BANNER_HOST): PagePattern[] {
  const paths = [TUPORTAL_PAGES.home, TUPORTAL_PAGES.balance].flatMap(pathsOf);
  return [
    ...Object.values(BANNER_PAGES).map((path) => ({ host: bannerHost, path: new RegExp(`^${path.replaceAll(".", "\\.")}$`) })),
    ...hosts.flatMap((host) => [
      // Where a login check starts.
      { host, path: /^\/$/ },
      ...paths.map((path) => ({ host, path: new RegExp(`^${path}$`) })),
      // Only so that a read can see a login has expired. Nothing is taken from these pages.
      { host, path: WAY_TO_SIGN_ON },
    ]),
    { host: SIGN_ON_HOST, path: /^\// },
  ];
}

/** Words that make a page on the portal one Buddy never opens, wherever they are in the address. */
const NEVER_ANYWHERE = new RegExp(
  [
    // Paying.
    "tupay|payment|epay|touchnet|checkout|refund|authorized-?payer",
    // Changing registration.
    "regist|enroll|add-?drop|addordrop|bwskfreg|bwckcoms|bwckregs|planahead|plan-your-schedule|waitlist|withdraw|classes?/+(?:add|drop)",
    // Forms, and anything that files something.
    "petition|declaration|consent|authoriz|signature",
    // Logging out would lose the login. It's a plain link, so that nobody has to submit anything.
    "logout|logoff|signout|sign-out",
  ].join("|"),
);
/** Words too short to look for inside another, such as "pay" in "display". These have to stand alone in the address. */
const NEVER_WHOLE_WORDS = "pay|cart|e-?check|drop|forms?|submit|apply|applications?|accept|decline|sign|requests?|update|edit|change|proxy";
const NEVER_WORD = new RegExp(`(?:^|[/_.;-])(?:${NEVER_WHOLE_WORDS})(?:$|[/_.;-])`);

const everyPageOf = (hosts: string[]): PagePattern[] => hosts.map((host) => ({ host, path: /^/ }));

/**
 * Pages Buddy never opens, reads or submits, even with an Action Permission. The guard refuses these first,
 * for pages, frames, redirects and everything a page loads. Each names its hosts, because a pattern with
 * none would apply to Temple's sign-on and to Duo too, and neither is TUportal's to limit.
 *
 * Banner is refused but for BANNER_PAGES, because its pages can act on a GET: a registration page can file a
 * change just by being opened, and its addresses don't say which do. Adding to them is a decision for a
 * person, one exact page at a time. Its registration app, on a host of its own, is refused whole.
 */
export function tuportalBlockedPages(hosts: string[] = TUPORTAL_HOSTS, bannerHost = BANNER_HOST): PagePattern[] {
  const allowedOnBanner = Object.values(BANNER_PAGES).map((path) => path.toLowerCase().replaceAll(".", "\\.")).join("|");
  return [
    { host: bannerHost, path: new RegExp(`^(?!(?:${allowedOnBanner})$)`) },
    // Each of these is opened as it is, with nothing added that could ask it for something else.
    { host: bannerHost, path: /^\/prod8\/twbkwbis\.p_genmenu$/, query: new RegExp(`^(?!${BANNER_MAIN_MENU_QUERY.replaceAll("?", "\\?").replaceAll(".", "\\.")}$)`) },
    { host: bannerHost, path: /^\/prod8\/bwskoacc\.p_viewhold$/, query: /./ },
    ...everyPageOf([BANNER_REGISTRATION_HOST]),
    ...everyPageOf(PAYMENT_HOSTS),
    ...hosts.flatMap((host) => [
      { host, path: NEVER_ANYWHERE },
      { host, path: NEVER_WORD },
      // The portal's own actions are ordinary links, told apart only by this.
      { host, path: /^/, query: /(?:^|[?&])p_p_lifecycle=1(?:&|$)/ },
    ]),
    { host: SIGN_ON_HOST, path: /(?:^|[/_.-])(?:logout|slo)(?:$|[/_.-])/ },
  ];
}

/** TUportal sends the browser to one of these when it isn't logged in: anywhere off the portal, or the portal's own way to the sign-on. */
export function isTuportalLoginPage(address: string, hosts: string[] = TUPORTAL_HOSTS, bannerHost = BANNER_HOST): boolean {
  const url = URL.parse(address);
  if (!url) return true;
  // Where Banner's sign-on ends, and the page it leads to. Stuck on the sign-on itself isn't logged in.
  if (url.hostname === bannerHost && (url.pathname === BANNER_PAGES.menu || url.pathname === BANNER_PAGES.holds)) return false;
  return !hosts.includes(url.hostname) || WAY_TO_SIGN_ON.test(url.pathname);
}

export const TUPORTAL_SITE: Site = {
  name: "TUportal",
  // Where Temple tells a Student to log in, so it's what a Takeover opens.
  homeUrl: TUPORTAL_HOME,
  // Temple's single sign-on and Duo are shared with other Connections: see forgetLogin in browser-access.ts.
  // Banner and the payment hosts are listed so that the guard counts them as this site's and refuses them.
  loginHosts: [...TUPORTAL_HOSTS, SIGN_ON_HOST, DUO_HOST, ...BANNER_HOSTS, ...PAYMENT_HOSTS],
  isConnection: true,
  signOnDomains: ["temple.edu"],
  readablePages: tuportalReadablePages(),
  blockedPages: tuportalBlockedPages(),
  appHosts: TUPORTAL_HOSTS,
  isLoginPage: (address) => isTuportalLoginPage(address),
};
