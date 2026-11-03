import { describe, expect, it } from "vitest";
import { answerSaysSent, differencesFromApproved, isSendAnswer, whyNotThisEmail, type ComposeContents } from "../src/tumail-rules.ts";
import { madeUpSendRequest } from "./support/outlook-send.ts";

const EMAIL = { to: "student@temple.edu", subject: "Hold on my account", body: "Hello,\n\nCan you help?\n\nThanks" };
const JUST_RIGHT: ComposeContents = { to: "student@temple.edu;", cc: null, bcc: null, subject: EMAIL.subject, body: "Hello,\n\n\nCan you help?\n\nThanks\n" };

describe("reading back the compose window", () => {
  it("finds nothing wrong when it holds exactly what the card says", () => {
    expect(differencesFromApproved(JUST_RIGHT, EMAIL)).toEqual([]);
  });

  it("takes the address from a chip's label, in any case, once or more", () => {
    expect(differencesFromApproved({ ...JUST_RIGHT, to: "A Made-Up Name\nA Made-Up Name <Student@Temple.edu>\nstudent@temple.edu" }, EMAIL)).toEqual([]);
  });

  it.each([
    ["another recipient", { to: "someone-else@temple.edu" }, "The To line"],
    ["a second recipient", { to: "student@temple.edu; someone-else@temple.edu" }, "The To line"],
    ["nobody", { to: "" }, "The To line"],
    ["only a name", { to: "A Made-Up Name" }, "The To line"],
    ["a copy", { cc: "someone-else@temple.edu" }, "The Cc line"],
    ["a blind copy, even with no address", { bcc: "A Made-Up Name" }, "The Bcc line"],
    ["another subject", { subject: "Something else" }, "The subject"],
    ["other words", { body: "Hello, Can you help? Thanks, and more" }, "The message"],
    ["the same words in another order", { body: "Can you help? Hello, Thanks" }, "The message"],
    ["a signature left in", { body: "Hello, Can you help? Thanks Sent from Outlook" }, "The message"],
  ])("won't go on with %s", (_, changes, problem) => {
    const problems = differencesFromApproved({ ...JUST_RIGHT, ...changes }, EMAIL);
    expect(problems.join(" ")).toContain(problem);
  });

  it("says what differs without any of the email's words", () => {
    const problems = differencesFromApproved({ to: "other@temple.edu", cc: "x", bcc: "y", subject: "SECRET", body: "SECRET" }, EMAIL).join(" ");
    expect(problems).not.toMatch(/SECRET|other@temple|student@temple|Hold on|Can you/);
  });

  it("is fine with empty Cc and Bcc lines", () => {
    expect(differencesFromApproved({ ...JUST_RIGHT, cc: "", bcc: " \n" }, EMAIL)).toEqual([]);
  });
});

describe("what a request to send carries", () => {
  it("is read from the body, or from Outlook's header that holds the same thing", () => {
    const request = madeUpSendRequest(EMAIL);
    expect(whyNotThisEmail(request, EMAIL)).toBeNull();
    const { body, ...withoutBody } = request;
    expect(whyNotThisEmail({ ...withoutBody, headers: { "x-owa-urlpostdata": encodeURIComponent(body!) } }, EMAIL)).toBeNull();
  });

  it("is refused when the header can't be read", () => {
    const { body: _, ...withoutBody } = madeUpSendRequest(EMAIL);
    expect(whyNotThisEmail({ ...withoutBody, headers: { "x-owa-urlpostdata": "%E0%A4%A" } }, EMAIL)).not.toBeNull();
  });

  it("goes by the words and not the markup, and ignores styles and scripts", () => {
    const body = '<html><head><style>p { color: red }</style></head><body><div style="x"><p>Hello,</p><br><span>Can&nbsp;you</span> help?<div>Thanks</div></div></body></html>';
    expect(whyNotThisEmail(madeUpSendRequest(EMAIL, { body }), EMAIL)).toBeNull();
  });

  it("doesn't let hidden words in the markup through, because they'd be in the message", () => {
    expect(whyNotThisEmail(madeUpSendRequest(EMAIL, { body: '<div>Hello, Can you help? Thanks</div><div style="display:none">more</div>' }), EMAIL)).not.toBeNull();
  });

  it("says why not without any of the email's words", () => {
    const why = whyNotThisEmail(madeUpSendRequest(EMAIL, { body: "<div>SECRET</div>" }), EMAIL)!;
    expect(why).not.toMatch(/SECRET|Hello|student@temple/);
  });
});

describe("Outlook's answer", () => {
  it("counts as sent only if it clearly says so", () => {
    expect(answerSaysSent(JSON.stringify({ Body: { ResponseMessages: { Items: [{ ResponseClass: "Success" }] } } }))).toBe(true);
  });

  it.each([
    ["", "nothing"],
    ["not json", "not JSON"],
    ["{}", "an empty answer"],
    [JSON.stringify({ Body: { ResponseMessages: { Items: [{ ResponseClass: "Error" }] } } }), "an error"],
    [JSON.stringify({ Body: { ResponseMessages: { Items: [] } } }), "no items"],
    [JSON.stringify({ Body: { ResponseMessages: { Items: [{ ResponseClass: "Success" }, { ResponseClass: "Error" }] } } }), "two items"],
  ])("doesn't for %j, %s", (answer) => {
    expect(answerSaysSent(answer)).toBe(false);
  });

  it("is told from Outlook's other answers", () => {
    expect(isSendAnswer("https://outlook.office.com/owa/service.svc?action=CreateItem&app=Mail")).toBe(true);
    expect(isSendAnswer("https://outlook.office.com/owa/0/service.svc?action=CreateItem")).toBe(true);
    expect(isSendAnswer("https://outlook.office.com/owa/service.svc?action=FindConversation")).toBe(false);
    expect(isSendAnswer("https://outlook.office.com/elsewhere?action=CreateItem")).toBe(false);
  });
});
