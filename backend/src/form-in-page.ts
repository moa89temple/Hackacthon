import type { ElementHandle, Locator, Page, Response } from "playwright-core";
import type { FormSubmission, FormToSubmit } from "./buddys-browser.ts";
import type { ArmableGuard } from "./network-guard.ts";

const CLICK_TIMEOUT_MS = 10_000;
/** How long after the press the one request has to leave. A form that's still silent didn't submit. */
const SEND_TIMEOUT_MS = 5_000;
const ANSWER_TIMEOUT_MS = 30_000;

/** Controls that don't count as something the Student fills in. */
const NOT_FILLED_IN = new Set(["hidden", "submit", "button", "reset", "image"]);
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
  if (withoutFragment(page.url()) !== withoutFragment(form.pageUrl)) {
    return changed("The page sent Buddy somewhere else, so the form on the card isn't in front of it.");
  }

  const located = page.locator(`form[id=${JSON.stringify(form.form)}], form[name=${JSON.stringify(form.form)}]`);
  const count = await located.count();
  if (count !== 1) return changed(`There are ${count} forms named ${form.form} on the page.`);

  const before = await readForm(located);
  const problems = differencesFromCard(before, form);
  if (problems.length > 0) return { outcome: "form_changed", problems };

  await fillIn(located, before, form);

  const button = await findButton(located, form);
  if ("problem" in button) return changed(button.problem);

  const hidden = new Set(before.controls.filter(({ type }) => type === "hidden").map(({ name }) => name));
  const filled = await readEntries(located);
  const stillDifferent = differencesInEntries(filled, form, hidden);
  if (stillDifferent.length > 0) return { outcome: "form_changed", problems: stillDifferent };

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

function withoutFragment(address: string): string {
  const url = new URL(address);
  url.hash = "";
  return url.href;
}

function waitForAnswer(page: Page, actionUrl: string): Promise<Response | null> {
  return page
    .waitForResponse(
      (response) => response.request().method() === "POST" && withoutFragment(response.url()) === withoutFragment(actionUrl),
      { timeout: ANSWER_TIMEOUT_MS },
    )
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

function differencesFromCard(found: FormOnPage, card: FormToSubmit): string[] {
  const problems: string[] = [];
  if (found.method !== "post") problems.push("The form no longer sends by POST.");
  if (found.action !== card.actionUrl) problems.push("The form now sends somewhere other than the card says.");
  if (found.target !== "" && found.target !== "_self") problems.push("The form now opens somewhere else.");

  const onPage = found.controls.filter(({ type }) => !NOT_FILLED_IN.has(type));
  for (const { name, type } of onPage) {
    if (NEVER_FILLED_IN.has(type)) problems.push(`The form has a field Buddy never fills in: ${name}.`);
  }
  const names = new Set(onPage.map(({ name }) => name));
  const cardNames = new Set(card.fields.map(({ name }) => name));
  for (const name of names) {
    if (!cardNames.has(name)) problems.push(`The page has a field the card doesn't: ${name}.`);
  }
  for (const name of cardNames) {
    if (!names.has(name)) problems.push(`The card has a field the page doesn't: ${name}.`);
  }
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
 * The fields that aren't hidden must be exactly the card's. Hidden ones, such as a site's anti-forgery
 * token, stay as the page set them, and the guard only lets through a request carrying these same values.
 */
function differencesInEntries(entries: [string, string][], card: FormToSubmit, hidden: Set<string>): string[] {
  const shown = entries.filter(([name]) => !hidden.has(name));
  const expected = card.fields.filter(({ value, name }) => value !== "" || !isUntickedBox(name, entries)).map(({ name, value }) => [name, value]);
  const canonical = (list: string[][]) => JSON.stringify(list.map(([name, value]) => [name, value!.replace(/\r\n/g, "\n")]).sort());
  return canonical(shown) === canonical(expected)
    ? []
    : ["What's in the form after filling it in isn't what the card says."];
}

/** An unticked checkbox sends nothing, so it doesn't appear in what the form would send. */
function isUntickedBox(name: string, entries: [string, string][]): boolean {
  return !entries.some(([entry]) => entry === name);
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
