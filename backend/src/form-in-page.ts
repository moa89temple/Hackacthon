import type { ElementHandle, Locator, Page, Response } from "playwright-core";
import type { FormSubmission, FormToSubmit } from "./buddys-browser.ts";
import { sameAddress, sameFields, type ArmableGuard } from "./network-guard.ts";

const CLICK_TIMEOUT_MS = 10_000;
/** How long after the press the one request has to leave. A form that's still silent didn't submit. */
const SEND_TIMEOUT_MS = 5_000;
const ANSWER_TIMEOUT_MS = 30_000;

/** Controls that aren't filled in, or pressed: the page itself sets what they send. */
const HIDDEN = "hidden";
const NOT_FILLED_IN = new Set([HIDDEN, "submit", "button", "reset", "image"]);
/** A card can't cover these: Buddy never learns a password and never uploads a file. */
const NEVER_FILLED_IN = new Set(["password", "file", "select-multiple"]);

interface Control {
  name: string;
  type: string;
  value: string;
  /** For a select: the values it offers. */
  options: string[];
}

interface FormOnPage {
  method: string;
  action: string;
  target: string;
  controls: Control[];
}

interface Button {
  /** Its place in the form's list of controls. */
  index: number;
  name: string;
  value: string;
}

/**
 * The part of the form-submit routine that happens on the page. It has a guard armed for only one
 * request, and it only arms it after every check here has passed.
 *
 * The checks: the page is the one on the card, there's exactly one form with that name, it sends to
 * where the card says, its fields are exactly the card's, what's in them after filling is exactly the
 * card's, and exactly one button has that label.
 */
export async function submitFormOnPage(page: Page, form: FormToSubmit, guard: ArmableGuard): Promise<FormSubmission> {
  await page.goto(form.pageUrl, { waitUntil: "load" });
  if (!sameAddress(page.url(), form.pageUrl)) {
    return changed("The page sent Buddy somewhere else, so the form on the card isn't in front of it.");
  }

  const located = page.locator(`form[id=${JSON.stringify(form.form)}], form[name=${JSON.stringify(form.form)}]`);
  const count = await located.count();
  if (count !== 1) return changed(`There are ${count} forms named ${form.form} on the page.`);

  const before = await readForm(located);
  const button = await findButton(located, form);
  if ("problem" in button) return changed(button.problem);

  const problems = differencesFromCard(before, button, form);
  if (problems.length > 0) return { outcome: "form_changed", problems };

  await fillIn(located, before, form);

  const filled = await readEntries(located);
  if (!isWhatTheCardSays(filled, before, form)) {
    return changed("What's in the form after filling it in isn't what the card says.");
  }

  const answer = waitForAnswer(page, form.actionUrl);
  guard.arm({
    method: "POST",
    url: form.actionUrl,
    fields: [...filled, ...(button.name ? [[button.name, button.value] as [string, string]] : [])],
  });
  const handle = (await located.evaluateHandle(
    (element: any, index: number) => element.elements[index],
    button.index,
  )) as ElementHandle<any>;
  await handle.click({ timeout: CLICK_TIMEOUT_MS });

  const deadline = Date.now() + SEND_TIMEOUT_MS;
  while (guard.progress() !== "sent" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (guard.progress() !== "sent") {
    return { outcome: "not_sent", why: "No request went out when Buddy pressed the button, or the guard stopped a different one." };
  }

  const response = await answer;
  if (!response || response.status() >= 400) return { outcome: "no_clear_answer" };
  return { outcome: "submitted", status: response.status() };
}

function changed(problem: string): FormSubmission {
  return { outcome: "form_changed", problems: [problem] };
}

function waitForAnswer(page: Page, actionUrl: string): Promise<Response | null> {
  return page
    .waitForResponse((response) => response.request().method() === "POST" && sameAddress(response.url(), actionUrl), {
      timeout: ANSWER_TIMEOUT_MS,
    })
    .catch(() => null);
}

/** Reads through the form's own list of its controls, so that a field outside the element still counts. */
function readForm(form: Locator): Promise<FormOnPage> {
  return form.evaluate((element: any) => {
    const attribute = (name: string) => element.getAttribute(name) ?? "";
    return {
      method: attribute("method").toLowerCase() || "get",
      action: new URL(attribute("action"), element.ownerDocument.baseURI).href,
      target: attribute("target"),
      controls: [...element.elements]
        .filter((control: any) => control.name && !control.disabled)
        .map((control: any) => ({
          name: control.name,
          type: control.type,
          value: control.value,
          options: control.tagName === "SELECT" ? [...control.options].map((option: any) => option.value) : [],
        })),
    };
  });
}

function readEntries(form: Locator): Promise<[string, string][]> {
  return form.evaluate((element: any) => {
    const entries: [string, string][] = [];
    // FormData is what the browser itself would send.
    new (element.ownerDocument.defaultView.FormData)(element).forEach((value: unknown, name: string) => {
      entries.push([name, typeof value === "string" ? value : "[file]"]);
    });
    return entries;
  });
}

function differencesInNames(found: Set<string>, onCard: Set<string>, kind: string): string[] {
  return [
    ...[...found].filter((name) => !onCard.has(name)).map((name) => `The page has a ${kind} the card doesn't: ${name}.`),
    ...[...onCard].filter((name) => !found.has(name)).map((name) => `The card has a ${kind} the page doesn't: ${name}.`),
  ];
}

function differencesFromCard(found: FormOnPage, button: Button, card: FormToSubmit): string[] {
  const problems: string[] = [];
  if (found.method !== "post") problems.push("The form no longer sends by POST.");
  if (found.action !== card.actionUrl) problems.push("The form now sends somewhere other than the card says.");
  if (found.target !== "" && found.target !== "_self") problems.push("The form now opens somewhere else.");

  const onPage = found.controls.filter(({ type }) => !NOT_FILLED_IN.has(type));
  for (const { name, type } of onPage) {
    if (NEVER_FILLED_IN.has(type)) problems.push(`The form has a field Buddy never fills in: ${name}.`);
  }
  problems.push(
    ...differencesInNames(new Set(onPage.map(({ name }) => name)), new Set(card.fields.map(({ name }) => name)), "field"),
  );
  const pageFills = found.controls.filter(({ type }) => type === HIDDEN).map(({ name }) => name);
  problems.push(
    ...differencesInNames(new Set([...pageFills, ...(button.name ? [button.name] : [])]), new Set(card.pageFills), "hidden field"),
  );

  for (const { name, value } of card.fields) {
    const controls = onPage.filter((control) => control.name === name);
    const [first] = controls;
    if (!first) continue;
    const fits =
      first.type === "radio"
        ? controls.some((control) => control.value === value)
        : first.type === "checkbox"
          ? controls.length === 1 && (value === "" || value === first.value)
          : first.type === "select-one"
            ? first.options.includes(value)
            : controls.length === 1;
    if (!fits) problems.push(`The field ${name} can't take what the card says.`);
  }
  return problems;
}

async function fillIn(form: Locator, found: FormOnPage, card: FormToSubmit): Promise<void> {
  for (const { name, value } of card.fields) {
    const control = found.controls.find((candidate) => candidate.name === name)!;
    const selector = `[name=${JSON.stringify(name)}]`;
    if (control.type === "radio") {
      await form.locator(`${selector}[value=${JSON.stringify(value)}]`).check();
    } else if (control.type === "checkbox") {
      await form.locator(selector).setChecked(value !== "");
    } else if (control.type === "select-one") {
      await form.locator(selector).selectOption({ value });
    } else {
      await form.locator(selector).fill(value);
    }
  }
}

/**
 * Whether the fields the Student can see hold exactly the card's values, and nothing else is there
 * but the page's own hidden ones. The guard only lets through a request carrying these same values.
 */
function isWhatTheCardSays(entries: [string, string][], found: FormOnPage, card: FormToSubmit): boolean {
  const hidden = new Set(found.controls.filter(({ type }) => type === HIDDEN).map(({ name }) => name));
  const shown = entries.filter(([name]) => !hidden.has(name));
  const names = new Set(entries.map(([name]) => name));
  // An unticked checkbox sends nothing, so it doesn't appear in what the form would send.
  const expected = card.fields
    .filter(({ name, value }) => value !== "" || names.has(name))
    .map(({ name, value }): [string, string] => [name, value]);
  return sameFields(shown, expected);
}

function findButton(form: Locator, card: FormToSubmit): Promise<Button | { problem: string }> {
  return form.evaluate(
    (element: any, { label, action }: { label: string; action: string }) => {
      const base = element.ownerDocument.baseURI;
      const isSubmit = (control: any) =>
        (control.tagName === "BUTTON" && control.type === "submit") ||
        (control.tagName === "INPUT" && (control.type === "submit" || control.type === "image"));
      const labelOf = (control: any) => (control.tagName === "BUTTON" ? control.textContent : control.value).trim();
      const all = [...element.elements] as any[];
      const matching = all.filter((control) => isSubmit(control) && !control.disabled && labelOf(control) === label);
      if (matching.length !== 1) return { problem: `There are ${matching.length} buttons labeled ${label}.` };
      const [button] = matching;
      const overrideAction = button.getAttribute("formaction");
      const overrideMethod = (button.getAttribute("formmethod") ?? "post").toLowerCase();
      const overrideTarget = button.getAttribute("formtarget") ?? "";
      if ((overrideAction !== null && new URL(overrideAction, base).href !== action) || overrideMethod !== "post" || (overrideTarget !== "" && overrideTarget !== "_self")) {
        return { problem: "The button now sends somewhere other than the card says." };
      }
      return { index: all.indexOf(button), name: button.name ?? "", value: button.value ?? "" };
    },
    { label: card.button, action: card.actionUrl },
  );
}
