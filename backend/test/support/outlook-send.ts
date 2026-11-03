import type { ApprovedEmail, RequestToCheck } from "../../src/network-guard.ts";

export const SERVICE = "/owa/service.svc";

export interface SendChanges {
  disposition?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  /** The HTML Outlook sends. By default, the approved words, a line to each div. */
  body?: string;
  attachments?: unknown[];
  secondItem?: boolean;
}

const recipients = (addresses: string[]) =>
  addresses.map((address) => ({ Name: address, EmailAddress: address, RoutingType: "SMTP", MailboxType: "OneOff" }));

/**
 * What Buddy assumes Outlook's request to send looks like, made up in that shape, and never sent
 * anywhere: only ever handed to a guard. A real send hasn't been seen yet. See tumail-rules.ts.
 */
export function madeUpSendRequest(email: ApprovedEmail, changes: SendChanges = {}): RequestToCheck {
  const html = changes.body ?? `<html><body>${email.body.split("\n").map((line) => `<div>${line || "<br>"}</div>`).join("")}</body></html>`;
  const item = {
    __type: "Message:#Exchange",
    Subject: changes.subject ?? email.subject,
    Body: { BodyType: "HTML", Value: html },
    ToRecipients: recipients(changes.to ?? [email.to]),
    CcRecipients: recipients(changes.cc ?? []),
    BccRecipients: recipients(changes.bcc ?? []),
    ...(changes.attachments ? { Attachments: changes.attachments } : {}),
  };
  return {
    url: `https://outlook.office.com${SERVICE}?action=CreateItem&app=Mail&n=43`,
    method: "POST",
    opensPage: false,
    headers: { action: "CreateItem" },
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({
      __type: "CreateItemJsonRequest:#Exchange",
      Body: {
        __type: "CreateItemRequest:#Exchange",
        Items: changes.secondItem ? [item, item] : [item],
        MessageDisposition: changes.disposition ?? "SendAndSaveCopy",
      },
    }),
  };
}
