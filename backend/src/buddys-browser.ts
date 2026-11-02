import type { ArmableGuard, RequestGuard } from "./network-guard.ts";

/** What Buddy read from one page. Reading never involves a screenshot. */
export interface PageReading {
  /** Where the page ended up after any redirects. */
  url: string;
  title: string;
  text: string;
  /** The page's accessibility tree, as text. */
  accessibilitySnapshot: string;
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

/** The guard wouldn't let Buddy's Browser open this page. */
export class PageBlocked extends Error {
  constructor(why: string) {
    super(why);
  }
}

/**
 * Buddy's Browser, as the backend controls it from outside. The only way for Buddy to click or type
 * in it is submitForm, for one approved step. Everything else on a page is only the Student's to do,
 * through the live view during a Takeover.
 *
 * Whatever Buddy does here is under a guard that's asked about every request. show is the exception,
 * because it's for the Student: from then on Buddy isn't attached until the Student taps Done.
 *
 * Use this only through BrowserAccess, which keeps Buddy out during a Takeover and is the gate in
 * front of submitForm.
 */
export interface BuddysBrowser {
  /** Where the backend connects for the live view. The app only ever reaches it through the backend. */
  readonly liveView: { host: string; port: number };
  /** Puts this page on the screen for the Student, without reading anything from it. */
  show(url: string): Promise<void>;
  /** Opens the page out of sight and reads it. Throws PageBlocked if the guard refuses the page. */
  read(url: string, guard: RequestGuard): Promise<PageReading>;
  /** Takes whatever the Student left on the screen off it. */
  clearScreen(guard: RequestGuard): Promise<void>;
  /**
   * Opens the page, checks the form still matches, fills it in and presses its button once, having
   * armed the guard for that one request. If it throws and the guard was armed, the request may have
   * left, so it must never be tried again.
   */
  submitForm(form: FormToSubmit, guard: ArmableGuard): Promise<FormSubmission>;
  /** Forgets everything the browser holds for these hosts and their subdomains. */
  forgetLogin(hosts: string[]): Promise<void>;
}
