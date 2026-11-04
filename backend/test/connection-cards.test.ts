import { describe, expect, it } from "vitest";
import { settings } from "../src/settings.ts";

describe("the Read Permission cards of Buddy's own Connections", () => {
  for (const type of settings.connectionTypes) {
    it(`${type.name} says what the Student gets from saying yes`, () => {
      expect(type.card.why).toMatch(/^So Buddy can /);
    });
  }
});
