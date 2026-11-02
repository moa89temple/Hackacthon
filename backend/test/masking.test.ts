import { describe, expect, it } from "vitest";
import { hiddenNote, maskSecrets } from "../src/masking.ts";

const SSN = "[Social Security number hidden]";
const CARD = "[card number hidden]";
const PASSWORD = "[password hidden]";

describe("Social Security numbers", () => {
  it.each([
    ["my ssn is 123-45-6789", `my ssn is ${SSN}`],
    ["123-45-6789", SSN],
    ["it's 123 45 6789.", `it's ${SSN}.`],
    ["(078–05–1120)", `(${SSN})`],
    ["my ssn is 123 - 45 - 6789", `my ssn is ${SSN}`],
  ])("hides one in the usual shapes: %s", (typed, masked) => {
    expect(maskSecrets(typed)).toBe(masked);
  });

  it.each([
    ["my SSN is 123456789", `my SSN is ${SSN}`],
    ["123456789 is my social security number", `${SSN} is my social security number`],
    ["my social is 123456789", `my social is ${SSN}`],
    ["mi seguro social es 123456789", `mi seguro social es ${SSN}`],
    ["SSN123456789", `SSN${SSN}`],
    ["ssn 123 456 789", `ssn ${SSN}`],
    ["ss number 123456789", `ss number ${SSN}`],
  ])("hides nine bare digits when the message says what they are: %s", (typed, masked) => {
    expect(maskSecrets(typed)).toBe(masked);
  });

  it.each([
    "My TUid is 915123456",
    "Call (215) 204-7276",
    "Call 215-204-7276",
    "It's due 2026-11-02",
    "Room 123 at 10:45",
    "I work 20 hours a week",
  ])("leaves other numbers alone: %s", (typed) => {
    expect(maskSecrets(typed)).toBe(typed);
  });
});

describe("card numbers", () => {
  it.each([
    ["visa 4111 1111 1111 1111 thanks", `visa ${CARD} thanks`],
    ["4111-1111-1111-1111", CARD],
    ["4111111111111111", CARD],
    ["amex 378282246310005", `amex ${CARD}`],
    ["amex 3782 822463 10005", `amex ${CARD}`],
    ["diners 30569309025904", `diners ${CARD}`],
    ["4111.1111.1111.1111", CARD],
    ["4111/1111/1111/1111", CARD],
    ["4111_1111_1111_1111", CARD],
    ["4111\u00A01111\u00A01111\u00A01111", CARD],
    ["4111\n1111\n1111\n1111", CARD],
  ])("hides numbers that pass the card checksum: %s", (typed, masked) => {
    expect(maskSecrets(typed)).toBe(masked);
  });

  it.each([
    ["4111 1111 1111 1111 12/28", `${CARD} 12/28`],
    ["4111 1111 1111 1111 123", `${CARD} 123`],
    ["4111111111111111 123", `${CARD} 123`],
    ["order 77 4111 1111 1111 1111", `order 77 ${CARD}`],
  ])("still finds the card when other digits sit right next to it: %s", (typed, masked) => {
    expect(maskSecrets(typed)).toBe(masked);
  });

  it("hides the whole card when a number before it passes the checksum with part of the card", () => {
    for (let prefix = 915000000; prefix < 915000100; prefix++) {
      expect(maskSecrets(`${prefix} 4111 1111 1111 1111`)).not.toContain("1111");
    }
  });

  it.each([
    "4111 1111 1111 1112",
    "1234567812345678",
    "a 12 digit ref 411111111111",
    "411111111111111111111111",
  ])("leaves numbers that aren't card numbers alone: %s", (typed) => {
    expect(maskSecrets(typed)).toBe(typed);
  });
});

describe("typed passwords", () => {
  it.each([
    ["my password is hunter2", `my password is ${PASSWORD}`],
    ["My Password is Hunter2!", `My Password is ${PASSWORD}`],
    ["my canvas password was abc123.", `my canvas password was ${PASSWORD}`],
    ["my password for canvas is abc123", `my password for canvas is ${PASSWORD}`],
    ["password's dragon", `password's ${PASSWORD}`],
    ["i changed my password to Tr0ub4dor", `i changed my password to ${PASSWORD}`],
    ["my pin is 4821", `my pin is ${PASSWORD}`],
    ["passcode is 4821", `passcode is ${PASSWORD}`],
    ["pw is hunter2", `pw is ${PASSWORD}`],
    ["my password is now dragon", `my password is now ${PASSWORD}`],
    ["my password was changed to dragon", `my password was changed to ${PASSWORD}`],
    ["set my password as dragon", `set my password as ${PASSWORD}`],
    ["password for TU Portal is dragon", `password for TU Portal is ${PASSWORD}`],
  ])("hides the word after the password: %s", (typed, masked) => {
    expect(maskSecrets(typed)).toBe(masked);
  });

  it.each([
    ["password: correct horse battery", `password: ${PASSWORD}`],
    ["Password=hunter2", `Password=${PASSWORD}`],
    ["pwd: hunter2\nsee you soon", `pwd: ${PASSWORD}\nsee you soon`],
    ["password is: hunter2", `password is: ${PASSWORD}`],
    ["pass: hunter2", `pass: ${PASSWORD}`],
    ["password for canvas: dragon", `password for canvas: ${PASSWORD}`],
  ])("hides the rest of the line after a colon or an equals sign: %s", (typed, masked) => {
    expect(maskSecrets(typed)).toBe(masked);
  });

  it.each([
    ["password hunter2", `password ${PASSWORD}`],
    ["the password I use is hunter2", `the password I use is ${PASSWORD}`],
    ["my pin 4821 ok", `my pin ${PASSWORD} ok`],
  ])("hides what looks like a secret close after the word, however it's phrased: %s", (typed, masked) => {
    expect(maskSecrets(typed)).toBe(masked);
  });

  it.each([
    ['my password is "correct horse battery" ok', `my password is ${PASSWORD} ok`],
    ["my password is 'two words' ok", `my password is ${PASSWORD} ok`],
    ["my password is “two words” ok", `my password is ${PASSWORD} ok`],
    ['my password is "not working" ok', `my password is ${PASSWORD} ok`],
  ])("hides all of a quoted password: %s", (typed, masked) => {
    expect(maskSecrets(typed)).toBe(masked);
  });

  it.each([
    ["mi contraseña es gato123", `mi contraseña es ${PASSWORD}`],
    ["mon mot de passe est chat123", `mon mot de passe est ${PASSWORD}`],
    ["mein Passwort ist hund123", `mein Passwort ist ${PASSWORD}`],
    ["minha senha é gato123", `minha senha é ${PASSWORD}`],
    ["我的密码是 abc123", `我的密码是 ${PASSWORD}`],
    ["мой пароль это abc123", `мой пароль это ${PASSWORD}`],
  ])("reads other languages too: %s", (typed, masked) => {
    expect(maskSecrets(typed)).toBe(masked);
  });

  it.each([
    "my password is expired",
    "My password is not working",
    "the password is wrong",
    "what password is needed?",
    "my password is too short",
    "my password is still not working",
    "my password was just reset",
    "password reset",
    "I need to reset my password",
    "how do I reset my password to get into Canvas",
    "What is a password manager?",
    "my password",
    "the compass is broken",
    "spin is fun",
    "mi contraseña es incorrecta",
  ])("leaves ordinary talk about passwords alone: %s", (typed) => {
    expect(maskSecrets(typed)).toBe(typed);
  });
});

describe("a message with several secrets", () => {
  it("hides them all and keeps the rest", () => {
    expect(maskSecrets("ssn 123-45-6789, card 4111 1111 1111 1111, password is hunter2, thanks")).toBe(
      `ssn ${SSN}, card ${CARD}, password is ${PASSWORD} thanks`,
    );
  });

  it("hides a card number used as a password just once", () => {
    expect(maskSecrets("my password is 4111111111111111")).toBe(`my password is ${PASSWORD}`);
  });

  it("changes nothing in a message with no secrets", () => {
    const typed = "I'm a sophomore studying biology 🧬 and I work 20 hours a week.\n\nWhat's a hold?";
    expect(maskSecrets(typed)).toBe(typed);
  });

  it("gets the same answer each time, because the patterns keep no state between messages", () => {
    expect(maskSecrets("4111 1111 1111 1111")).toBe(CARD);
    expect(maskSecrets("4111 1111 1111 1111")).toBe(CARD);
  });
});

describe("the note to the Student", () => {
  it("is empty when nothing was hidden", () => {
    expect(hiddenNote("I'm a sophomore")).toBeNull();
  });

  it("says what was hidden, and that it wasn't saved or sent", () => {
    expect(hiddenNote(maskSecrets("my password is hunter2"))).toBe(
      "Buddy hid what looks like a password before saving this or sending it to the AI.",
    );
  });

  it("lists everything that was hidden", () => {
    expect(hiddenNote(maskSecrets("123-45-6789 and 4111 1111 1111 1111 and password: x"))).toBe(
      "Buddy hid what looks like a password, a Social Security number and a card number before saving this or sending it to the AI.",
    );
  });
});
