import { ActionRefused, type ActionRoutine, type CardDescription, type StepResult } from "./action-cards.ts";
import { NoActionPermission, TakeoverInProgress, type BrowserAccess, type Site } from "./browser-access.ts";
import { PageBlocked, SUBMIT_FORM, type FormStep, type FormSubmission, type FormToSubmit } from "./buddys-browser.ts";
import { isOnSite, type GuardPolicy } from "./network-guard.ts";

const NOT_RUN = "not_run";
const NOTHING_SENT = "Nothing was sent.";

export interface FormSubmitDeps {
  sites: Record<string, Site>;
  guards: GuardPolicy;
  browserAccess: Pick<BrowserAccess, "submitApprovedForm" | "currentTakeover">;
  logError: (error: unknown) => void;
}

/**
 * The form-submit routine: opens the page, checks the form still matches the card, fills it with
 * exactly what the card says, and presses its button once. The browser does that part. See
 * BrowserAccess.submitApprovedForm, the gate in front of it, and BuddysBrowser.submitForm.
 */
export function formSubmitRoutine({ sites, guards, browserAccess, logError }: FormSubmitDeps): ActionRoutine {
  return {
    kind: SUBMIT_FORM,

    isAvailable: () => Object.values(sites).some((site) => (site.formPages ?? []).length > 0),

    prepare(input): FormStep {
      const { site: siteId, page_url: pageUrl, action_url: actionUrl, form, button, fields } = input as Record<string, unknown>;
      if (typeof siteId !== "string" || !Object.hasOwn(sites, siteId)) throw new ActionRefused("Buddy doesn't know that site.");
      const site = sites[siteId]!;
      const page = siteAddress(pageUrl, site);
      const action = siteAddress(actionUrl, site);
      if (!page || !action) throw new ActionRefused(`page_url and action_url must both be addresses on ${site.name}.`);
      // Checked here for a clear answer. The guard refuses these again in the browser, whatever a card says.
      if (guards.isBlockedPage(page.href) || guards.isBlockedPage(action.href)) {
        throw new ActionRefused("Buddy never opens that page or submits to it, even with the Student's Approve tap.");
      }
      if (!(site.formPages ?? []).some((pattern) => matches(pattern, page))) {
        throw new ActionRefused(`Buddy can't submit forms on that page of ${site.name}.`);
      }
      if (typeof form !== "string" || form === "") throw new ActionRefused("form must name the form.");
      if (typeof button !== "string" || button === "") throw new ActionRefused("button must be the label of the button to press.");
      return { site: siteId, pageUrl: page.href, actionUrl: action.href, form, button, fields: checkedFields(fields) };
    },

    describe(content): CardDescription {
      const step = content as FormStep;
      return {
        title: `Submit a form on ${sites[step.site]?.name ?? step.site}`,
        shows: [
          { label: "Page", value: step.pageUrl },
          { label: "Sent to", value: step.actionUrl },
          { label: "Button Buddy presses", value: step.button },
          ...step.fields.map(({ name, value }) => ({ label: name, value })),
        ],
      };
    },

    whyNotNow: () =>
      browserAccess.currentTakeover() ? "You're in control of Buddy's Browser. Tap Done first, then Approve." : null,

    async run(cardId): Promise<StepResult> {
      try {
        return describeSubmission(await browserAccess.submitApprovedForm(cardId));
      } catch (error) {
        // submitApprovedForm only throws when nothing can have left the browser.
        if (error instanceof NoActionPermission || error instanceof TakeoverInProgress || error instanceof PageBlocked) {
          return { status: NOT_RUN, outcome: NOTHING_SENT, detail: error.message };
        }
        // The rest could hold addresses and internals, which aren't for the Student's card.
        logError(error);
        return { status: NOT_RUN, outcome: `Buddy's Browser couldn't do this. ${NOTHING_SENT}` };
      }
    },
  };
}

function describeSubmission(submission: FormSubmission): StepResult {
  switch (submission.outcome) {
    case "submitted":
      return { status: "done", outcome: `Buddy submitted the form, and the site answered ${submission.status}.` };
    case "form_changed":
      return {
        status: NOT_RUN,
        outcome: `The form on the page no longer matches this card, so Buddy didn't submit it. ${NOTHING_SENT}`,
        detail: submission.problems.join(" "),
      };
    case "not_sent":
      return { status: NOT_RUN, outcome: `Buddy didn't submit the form. ${NOTHING_SENT}`, detail: submission.why };
    case "no_clear_answer":
      return {
        status: "unknown",
        outcome: "The form was sent, but the site gave no clear answer, so Buddy can't tell whether it worked. It won't try again, so please check.",
      };
  }
}

function checkedFields(fields: unknown): FormToSubmit["fields"] {
  if (!Array.isArray(fields)) throw new ActionRefused("fields must be a list.");
  const checked = fields.map((field) => {
    const { name, value } = (field ?? {}) as { name?: unknown; value?: unknown };
    if (typeof name !== "string" || name === "" || typeof value !== "string") {
      throw new ActionRefused("Each field needs a name and a value.");
    }
    return { name, value };
  });
  if (new Set(checked.map(({ name }) => name)).size < checked.length) {
    throw new ActionRefused("Each field can appear only once.");
  }
  return checked;
}

/** On the site, the same way its home page is reached, and with no login in the address. */
function siteAddress(address: unknown, site: Site): URL | null {
  const url = typeof address === "string" ? URL.parse(address) : null;
  if (!url || url.protocol !== new URL(site.homeUrl).protocol || url.username || url.password) return null;
  return isOnSite(url.hostname, site) ? url : null;
}

function matches(pattern: { host?: string; path: RegExp }, url: URL): boolean {
  return (pattern.host === undefined || pattern.host === url.hostname) && pattern.path.test(url.pathname);
}
