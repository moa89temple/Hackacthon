import { describe, expect, it } from "vitest";
import {
  addressesIn,
  contactWithAddress,
  isTempleAddress,
  isTumailLoginPage,
  senderAddressIn,
  TUMAIL_APP_HOSTS,
  TUMAIL_READ_ONLY_REQUESTS,
  tumailReadablePages,
} from "../src/tumail-rules.ts";

describe("who an email is from", () => {
  it.each([
    ["jdoe@temple.edu", "jdoe@temple.edu"],
    ["JDoe@Temple.EDU", "jdoe@temple.edu"],
    ["  jdoe@temple.edu  ", "jdoe@temple.edu"],
    ["Jane Doe <jdoe@temple.edu>", "jdoe@temple.edu"],
    ["Doe, Jane <JDOE@temple.edu>", "jdoe@temple.edu"],
    ["Jane Doe", null],
    ["", null],
  ])("reads %j as %j", (written, address) => {
    expect(senderAddressIn(written)).toBe(address);
  });

  it("goes by the address, never by a display name that looks like one", () => {
    expect(senderAddressIn('"dean@temple.edu" <someone@evil.test>')).toBe("someone@evil.test");
    expect(senderAddressIn("dean@temple.edu <someone@evil.test>")).toBe("someone@evil.test");
    expect(senderAddressIn("Dean <dean@temple.edu> <someone@evil.test>")).toBe("someone@evil.test");
  });

  it.each([
    "a@temple.edu@evil.test",
    '"a@temple.edu"@evil.test',
    "a b@temple.edu",
    "a@temple.edu.",
    "a@temple",
    "a@tеmple.edu", // The second letter of "temple" is Cyrillic.
    "a@temple.edu​",
    "<a@temple.edu> and more words",
  ])("doesn't take %j for an address", (written) => {
    expect(senderAddressIn(written)).toBeNull();
  });
});

describe("what counts as a temple.edu address", () => {
  it.each(["jdoe@temple.edu", "jdoe@tuhs.temple.edu", "j.doe+x@a.b.temple.edu"])("%s does", (address) => {
    expect(isTempleAddress(address)).toBe(true);
  });

  it.each(["x@temple.edu.evil.test", "x@eviltemple.edu", "x@temple.edu.", "x@evil.test", "temple.edu@evil.test", "x@temple.education"])(
    "%s doesn't",
    (address) => {
      expect(isTempleAddress(address)).toBe(false);
    },
  );
});

describe("what counts as a Contact's address", () => {
  const contacts = [
    { name: "Made-Up Advisor", email: "Advisor@Elsewhere.test" },
    { name: "Made-Up Office", email: "One@temple.edu or two@temple.edu" },
    { name: "No Email", email: null },
  ];

  it("is the whole address, in any case", () => {
    expect(contactWithAddress("advisor@elsewhere.test", contacts)?.name).toBe("Made-Up Advisor");
    expect(contactWithAddress("x.advisor@elsewhere.test", contacts)).toBeNull();
    expect(contactWithAddress("advisor@elsewhere.test.evil.test", contacts)).toBeNull();
  });

  it("finds each address where a page wrote more than one", () => {
    expect(addressesIn("One@temple.edu or two@temple.edu")).toEqual(["one@temple.edu", "two@temple.edu"]);
    expect(contactWithAddress("two@temple.edu", contacts)?.name).toBe("Made-Up Office");
  });
});

describe("where a login has gone", () => {
  it.each(TUMAIL_APP_HOSTS)("%s is Outlook itself", (host) => {
    expect(isTumailLoginPage(`https://${host}/mail/inbox`)).toBe(false);
  });

  it.each([
    "https://login.microsoftonline.com/common/oauth2/authorize",
    "https://fim.temple.edu/idp/profile/SAML2/POST/SSO",
    "https://api-1234.duosecurity.com/frame",
    "not an address",
  ])("%s is somewhere to log in", (address) => {
    expect(isTumailLoginPage(address)).toBe(true);
  });
});

describe("the pages Buddy opens in Outlook", () => {
  const listed = (path: string) =>
    tumailReadablePages(["outlook.office.com"]).some((page) => page.host === "outlook.office.com" && page.path.test(path));

  it.each(["/mail/", "/mail", "/mail/inbox", "/mail/0/inbox", "/mail/inbox/id/AAQkMadeUp%3D", "/mail/0/inbox/id/AAQkMadeUp%3D", "/owa/"])(
    "include %s",
    (path) => {
      expect(listed(path)).toBe(true);
    },
  );

  it.each([
    "/mail/deeplink/compose",
    "/mail/sentitems",
    "/mail/drafts",
    "/mail/deleteditems",
    "/mail/junkemail",
    "/mail/options",
    "/mail/inbox/id/AAQk/forward",
    "/mail/inbox/id/AAQk%2F..%2Fcompose/more",
    "/calendar/view/month",
    "/people",
  ])("leave out %s", (path) => {
    expect(listed(path)).toBe(false);
  });
});

describe("the requests that read Outlook but look like they change something", () => {
  const known = (path: string, search: string) =>
    TUMAIL_READ_ONLY_REQUESTS.find(
      (request) => request.host === "outlook.office.com" && request.path.test(path) && (request.query?.test(search) ?? true),
    );

  it.each(["?action=FindConversation&app=Mail", "?action=GetConversationItems&app=Mail&n=12", "?action=GetItem", "?ACTION=finditem"])(
    "include %s",
    (search) => {
      expect(known("/owa/service.svc", search)).toBeDefined();
    },
  );

  it.each([
    "",
    "?action=UpdateItem&app=Mail",
    "?action=SendItem",
    "?action=CreateItem",
    "?action=DeleteItem",
    "?action=MoveItem",
    "?action=ApplyConversationAction",
    "?action=MarkAllItemsAsRead",
    "?action=GetItem&action=UpdateItem",
    "?app=Mail&action=GetItem&action=UpdateItem",
    "?action=GetItem&%61ction=UpdateItem",
    "?action=GetItem;action=UpdateItem",
    "?action=GetItemAndDelete",
  ])("leave out %j", (search) => {
    expect(known("/owa/service.svc", search)).toBeUndefined();
  });

  it("doesn't take the address's word when the request's own header says something else", () => {
    const request = known("/owa/service.svc", "?action=GetItem")!;
    expect(request.headers?.action?.test("GetItem")).toBe(true);
    expect(request.headers?.action?.test("UpdateItem")).toBe(false);
  });
});
