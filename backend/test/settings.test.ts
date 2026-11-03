import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allowedHostsWithTailscale, readFirebaseServiceAccountFile, readTailscaleAddress, settings } from "../src/settings.ts";

describe("the Firebase service account file", () => {
  it("is optional, because Buddy runs without phone notifications", () => {
    expect(readFirebaseServiceAccountFile("")).toBeUndefined();
    expect(readFirebaseServiceAccountFile("  ")).toBeUndefined();
  });

  it("can be anywhere on this laptop", () => {
    const anywhere = resolve("/somewhere/else/account.json");
    expect(readFirebaseServiceAccountFile(` ${anywhere} `)).toBe(anywhere);
  });

  it("goes by the top of the repo when the path is relative, as .env.local is", () => {
    const top = fileURLToPath(new URL("../../", import.meta.url));
    expect(readFirebaseServiceAccountFile("backend/secrets/account.json")).toBe(resolve(top, "backend/secrets/account.json"));
  });
});

describe("the Tailscale address", () => {
  it("is optional, because the emulator doesn't need one", () => {
    expect(readTailscaleAddress("")).toBeUndefined();
    expect(readTailscaleAddress("  ")).toBeUndefined();
  });

  it("comes down to the address itself, however Tailscale printed it", () => {
    expect(readTailscaleAddress(" https://laptop.tail1234.ts.net/ ")).toBe("https://laptop.tail1234.ts.net");
  });

  it.each([["http://laptop.tail1234.ts.net"], ["laptop.tail1234.ts.net"], ["not an address"]])(
    "must be HTTPS: %s",
    (address) => {
      expect(() => readTailscaleAddress(address)).toThrow("https://");
    },
  );

  it("is added to the names the backend answers to", () => {
    expect(allowedHostsWithTailscale("https://laptop.tail1234.ts.net")).toEqual([
      ...settings.allowedHosts,
      "laptop.tail1234.ts.net",
    ]);
  });

  it("leaves those names alone when there isn't one", () => {
    expect(allowedHostsWithTailscale("")).toEqual(settings.allowedHosts);
  });
});
