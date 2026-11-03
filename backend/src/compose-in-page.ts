import type { Locator, Page } from "playwright-core";
import type { EmailSending, EmailToSend } from "./buddys-browser.ts";
import type { SendGuard } from "./network-guard.ts";
import { answerSaysSent, COMPOSE_SELECTORS, differencesFromApproved, isSendAnswer, isTumailLoginPage, TUMAIL_APP_HOSTS, type ComposeContents } from "./tumail-rules.ts";

/** Outlook is a large app, and everything it shows is built by script after it has loaded. */
const COMPOSE_TIMEOUT_MS = 30_000;
const PRESS_TIMEOUT_MS = 10_000;
/**
 * How long after the press the one request has to leave. After this the guard is shut, so nothing more
 * can get out while Buddy is here. UNVERIFIED: that this is long enough, if Outlook holds a message back
 * for an Undo. A press with nothing seen is reported as uncertain, for that reason.
 */
const SEND_TIMEOUT_MS = 10_000;
const ANSWER_TIMEOUT_MS = 30_000;
/** How long the To line gets to turn what was typed into a recipient. */
const RECIPIENT_SETTLE_MS = 500;

const NEEDED = { newEmail: "button to write a new email", to: "To line", subject: "subject line", body: "place for the message", send: "Send button" } as const;

/**
 * The part of the send routine that happens on the page, in order: open a new email, fill it in, read it
 * back, and only if it's exactly the card, record that the send has started, open the guard for that one
 * request, and press Send once. The guard stays shut before that, which also stops Outlook from saving
 * any of it as a Draft, and whoever calls this shuts it again however this ends.
 *
 * What makes this the approved email isn't this code but the guard, which looks at what the request
 * really carries. Reading back is what stops Buddy pressing Send on something that doesn't match.
 *
 * All of this worked against real Outlook in one Practice send on 2026-11-03. Any of it
 * being wrong for another email stops here, with nothing sent. See tumail-rules.ts.
 */
export async function sendEmailOnPage(page: Page, email: EmailToSend, guard: SendGuard, beforePressing: () => string | null): Promise<EmailSending> {
  await page.goto(email.inboxUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(COMPOSE_SELECTORS.inboxReady, { state: "attached", timeout: COMPOSE_TIMEOUT_MS }).catch(() => {});
  if (isTumailLoginPage(page.url(), [new URL(email.inboxUrl).hostname, ...TUMAIL_APP_HOSTS])) return { outcome: "login_needed" };

  const newEmail = page.locator(COMPOSE_SELECTORS.newEmail);
  const newEmailButtons = await newEmail.count();
  if (newEmailButtons !== 1) return { outcome: "not_sent", why: `Outlook's inbox didn't have exactly one ${NEEDED.newEmail}: Buddy found ${newEmailButtons}, so it didn't go on.` };
  await newEmail.click();
  await page.waitForSelector(COMPOSE_SELECTORS.body, { state: "attached", timeout: COMPOSE_TIMEOUT_MS }).catch(() => {});

  const to = page.locator(COMPOSE_SELECTORS.to);
  const subject = page.locator(COMPOSE_SELECTORS.subject);
  const body = page.locator(COMPOSE_SELECTORS.body);
  const send = page.locator(COMPOSE_SELECTORS.send);
  for (const [name, found] of [["to", to], ["subject", subject], ["body", body], ["send", send]] as [keyof typeof NEEDED, Locator][]) {
    const count = await found.count();
    if (count !== 1) return { outcome: "not_sent", why: `Outlook's new email didn't have exactly one ${NEEDED[name]}: Buddy found ${count}, so it didn't go on.` };
  }

  await to.click();
  await page.keyboard.insertText(email.to);
  // Seen once: this turns what's typed into a recipient, with the guard refusing Outlook's lookups.
  await page.keyboard.press(";");
  await page.waitForTimeout(RECIPIENT_SETTLE_MS);
  // Seen once that the editor keeps the lines. UNVERIFIED: that filling replaces a signature. Reading back checks both.
  await subject.fill(email.subject);
  await body.fill(email.body);

  const problems = differencesFromApproved(await readCompose(page), email);
  if (problems.length > 0) return { outcome: "compose_differs", problems };

  const why = beforePressing();
  if (why) return { outcome: "not_sent", why };

  const answer = page
    .waitForResponse((response) => response.request().method() === "POST" && isSendAnswer(response.url()), { timeout: ANSWER_TIMEOUT_MS })
    .catch(() => null);
  guard.open({ to: email.to, subject: email.subject, body: email.body });
  await send.click({ timeout: PRESS_TIMEOUT_MS });

  const deadline = Date.now() + SEND_TIMEOUT_MS;
  while (guard.progress() !== "sent" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  guard.close();
  if (guard.progress() !== "sent") {
    // Losing the guard closes the page, and then a request it was holding may have been let go.
    if (page.isClosed()) throw new Error("The page closed while Buddy was pressing Send");
    const refused = guard.refusals();
    return { outcome: "not_sent", why: refused.length > 0 ? refused.join(" ") : "Nothing went out when Buddy pressed Send." };
  }

  const response = await answer;
  if (!response || response.status() >= 400) return { outcome: "no_clear_answer" };
  const words = await response.text().catch(() => "");
  return answerSaysSent(words) ? { outcome: "sent" } : { outcome: "no_clear_answer" };
}

async function readCompose(page: Page): Promise<ComposeContents> {
  const lineOrNull = async (selector: string) => {
    const line = page.locator(selector);
    return (await line.count()) === 0 ? null : (await readLine(line.first()));
  };
  return {
    to: (await lineOrNull(COMPOSE_SELECTORS.to)) ?? "",
    cc: await lineOrNull(COMPOSE_SELECTORS.cc),
    bcc: await lineOrNull(COMPOSE_SELECTORS.bcc),
    subject: await page.locator(COMPOSE_SELECTORS.subject).inputValue(),
    body: await page.locator(COMPOSE_SELECTORS.body).innerText(),
  };
}

/** What the line shows, and every label and title inside it. UNVERIFIED: that a recipient's chip keeps its address in one of those. */
function readLine(line: Locator): Promise<string> {
  return line.evaluate((element: any) =>
    [
      element.value ?? element.innerText ?? "",
      ...[...element.querySelectorAll("[aria-label], [title]")].flatMap((inside: any) => [inside.getAttribute("aria-label"), inside.getAttribute("title")]),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
