import { describe, expect, it } from "vitest";
import { allowedHostsWithTailscale, readTailscaleAddress, settings } from "../src/settings.ts";

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
