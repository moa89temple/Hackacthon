import type { ApprovedEmail, ArmableGuard, RequestGuard, SendGuard } from "./network-guard.ts";
import type { SendingMode } from "./sending-store.ts";

/** What Buddy read from one page. Reading never involves a screenshot. */
export interface PageReading {
  /** Where the page ended up after any redirects. */
  url: string;
  title: string;
  text: string;
  /** The page's accessibility tree, as text. */
  accessibilitySnapshot: string;
  /** The page as it stood once it had loaded, after its own scripts ran. */
  html: string;
  /** What the server told the page's own scripts, if the read asked for any. See ReadOptions. */
  answers?: PageAnswer[];
  /** The frames inside the page, because `text` and `html` stop at a frame's edge. A portal may keep everything in them. */
  frames?: FrameReading[];
  /** The page after each step down its list, if the read asked for that. See ReadOptions. */
  scrolled?: string[];
}

/** One frame inside a page, read the same way. Each stands alone: nothing says a frame's words are the page's. */
export interface FrameReading {
  url: string;
  text: string;
  html: string;
}

/** What a page's own script got back from a server. Nothing extra is asked for to get this. */
export interface PageAnswer {
  url: string;
  status: number;
  body: string;
}

export interface AnswersToKeep {
  /** Each means that host and its subdomains. A page can load anything from anywhere, so this is what says it's the app's. */
  hosts: string[];
  paths: RegExp[];
}

export interface ReadOptions {
  /** For an app that builds its page long after loading. See PageWait. */
  until?: string;
  /**
   * For an app that builds its pages by script: the requests the page's scripts make for themselves whose
   * answers to keep. The read waits for one of each path, for a little while, before it finishes.
   */
  answersFrom?: AnswersToKeep;
  /**
   * For a list that only draws what's in view, and drops what's scrolled past: moves it down this many
   * times and gives the page after each. Scrolling is all it does, and anything the page asks for as a
   * result goes through the guard like everything else.
   */
  scrollList?: { item: string; times: number };
}

/**
 * For an app that builds its page with script long after loading. The page is read once something
 * matching this CSS selector is there or the wait runs out, in which case it's read as it stands, so
 * that the reader can say it doesn't recognize it.
 */
export interface PageWait {
  until: string;
}

/** Exactly what the Student approved: one form, its fields and the one button to press. */
export interface FormToSubmit {
  /** The page that has the form. */
  pageUrl: string;
  /** Where the form sends what's in it. */
  actionUrl: string;
  /** The form's id or name. */
  form: string;
  /** The label of the button to press. */
  button: string;
  /** Every field the Student can see. A checkbox left unticked has an empty value. */
  fields: { name: string; value: string }[];
  /**
   * The names the page sends values for by itself: its hidden fields, and the button's own name if it
   * has one. Their values aren't on the card, because a site's anti-forgery token differs on every
   * load, but a page with any other names doesn't match the card.
   */
  pageFills: string[];
}

/** The kind of Action card that submits a form. */
export const SUBMIT_FORM = "submit_form";

/** What a card to submit a form holds. Nothing else about the step can vary. */
export interface FormStep extends FormToSubmit {
  /** Which of Buddy's sites the form is on. */
  site: string;
}

/** How the form-submit routine ended. Only "submitted" means it worked. */
export type FormSubmission =
  /** The one request left and the site answered that it took it. */
  | { outcome: "submitted"; status: number }
  /** The form isn't what the card shows, so nothing was sent. */
  | { outcome: "form_changed"; problems: string[] }
  /** The button was pressed but no request went out, or the guard stopped it. */
  | { outcome: "not_sent"; why: string }
  /** The request left, and there's no knowing whether it worked. It must never be tried again. */
  | { outcome: "no_clear_answer" };

/** The kind of Action card that sends an email from the Student's TUmail. */
export const SEND_EMAIL = "send_email";

/** What a card to send an email holds. Nothing else about the step can vary. */
export interface EmailStep extends ApprovedEmail {
  /** Which of Buddy's sites sends it. */
  site: string;
  /** The Draft it was made from, to see whether it has been edited since. */
  draftId: number;
  /** The mode when the card was made. If that changes, the card stops working. */
  mode: SendingMode;
  /** Who the Draft is for. In Practice mode this isn't who it goes to, which is `to`. */
  contactName: string;
  contactAddress: string;
}

export interface EmailToSend extends ApprovedEmail {
  /** Where to write a new email. */
  composeUrl: string;
}

/** How the send routine ended. Only "sent" means it worked. */
export type EmailSending =
  /** The one request left, and Outlook answered that it took it. */
  | { outcome: "sent" }
  /** Outlook asked for a login, so nothing was filled in and nothing was sent. */
  | { outcome: "login_needed" }
  /** What was in the new email isn't what the card shows, so Send wasn't pressed. */
  | { outcome: "compose_differs"; problems: string[] }
  /** Send wasn't pressed, or the guard stopped everything it led to. */
  | { outcome: "not_sent"; why: string }
  /** The request may have left, and there's no knowing whether it worked. It must never be tried again. */
  | { outcome: "no_clear_answer" };

/** The guard wouldn't let Buddy's Browser open this page. */
export class PageBlocked extends Error {
  constructor(why: string) {
    super(why);
  }
}

/**
 * Buddy's Browser, as the backend controls it from outside. The only ways for Buddy to click or type
 * in it are submitForm and sendEmail, each for one approved step. Everything else on a page is only the
 * Student's to do, through the live view during a Takeover.
 *
 * Whatever Buddy does here is under a guard that's asked about every request. show is the exception,
 * because it's for the Student: from then on Buddy isn't attached until the Student taps Done.
 *
 * Use this only through BrowserAccess, which keeps Buddy out during a Takeover and is the gate in
 * front of submitForm and sendEmail.
 */
export interface BuddysBrowser {
  /** Where the backend connects for the live view. The app only ever reaches it through the backend. */
  readonly liveView: { host: string; port: number };
  /** Puts this page on the screen for the Student, without reading anything from it. */
  show(url: string): Promise<void>;
  /**
   * Opens the page out of sight and reads it. Throws PageBlocked if the guard refuses the page. A page
   * its script builds after it has loaded can say what to wait for. See ReadOptions.
   */
  read(url: string, guard: RequestGuard, options?: ReadOptions): Promise<PageReading>;
  /** Takes whatever the Student left on the screen off it. */
  clearScreen(guard: RequestGuard): Promise<void>;
  /**
   * Opens the page, checks the form still matches, fills it in and presses its button once, having
   * armed the guard for that one request. If it throws and the guard was armed, the request may have
   * left, so it must never be tried again.
   */
  submitForm(form: FormToSubmit, guard: ArmableGuard): Promise<FormSubmission>;
  /**
   * Opens a new email, fills it in, reads it back and presses Send once, having opened the guard for that
   * one request. `beforePressing` comes right before opening the guard: if it says why not, or throws,
   * Send isn't pressed. If this throws and the guard had been opened, the request may have left, so it
   * must never be tried again. See compose-in-page.ts.
   */
  sendEmail(email: EmailToSend, guard: SendGuard, beforePressing: () => string | null): Promise<EmailSending>;
  /** Forgets everything the browser holds for these hosts and their subdomains. */
  forgetLogin(hosts: string[]): Promise<void>;
}
