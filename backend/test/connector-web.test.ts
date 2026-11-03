import { describe, expect, it } from "vitest";
import { isPrivateAddress, keptToOwnDomain, OffTheServicesDomain, realConnectorWeb } from "../src/connector-web.ts";
import { SavedConnectors } from "./support/saved-connectors.ts";

describe("an address that isn't on the open internet", () => {
  it.each([
    ["0.0.0.0"],
    ["10.1.2.3"],
    ["100.64.0.1"],
    ["100.101.102.103"],
    ["127.0.0.1"],
    ["127.255.255.255"],
    ["169.254.169.254"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.168.1.1"],
    ["198.18.0.1"],
    ["224.0.0.1"],
    ["255.255.255.255"],
    ["::"],
    ["::1"],
    ["fc00::1"],
    ["fd12:3456::1"],
    ["fe80::1"],
    ["ff02::1"],
    ["::ffff:127.0.0.1"],
    ["::ffff:10.0.0.1"],
    ["::ffff:7f00:1"],
    ["::ffff:a9fe:a9fe"],
    ["64:ff9b::7f00:1"],
    ["not an address"],
  ])("%s counts as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([["8.8.8.8"], ["104.18.2.3"], ["172.32.0.1"], ["2606:4700::1111"], ["::ffff:8.8.8.8"]])("%s doesn't", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("the real way of asking", () => {
  const publicName = async () => [{ address: "93.184.216.34", family: 4 }];
  const privateName = async () => [{ address: "127.0.0.1", family: 4 }];
  const mixedName = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ];

  it("says whether a name leads only to public addresses", async () => {
    expect(await realConnectorWeb(publicName).leadsOnlyToPublicAddresses("service.example")).toBe(true);
    expect(await realConnectorWeb(privateName).leadsOnlyToPublicAddresses("service.example")).toBe(false);
    expect(await realConnectorWeb(mixedName).leadsOnlyToPublicAddresses("service.example")).toBe(false);
    expect(await realConnectorWeb(async () => []).leadsOnlyToPublicAddresses("service.example")).toBe(false);
    expect(await realConnectorWeb(publicName).leadsOnlyToPublicAddresses("127.0.0.1")).toBe(false);
  });

  it.each([
    ["this laptop by name", "https://localhost:9/mcp"],
    ["this laptop by number", "https://127.0.0.1:9/mcp"],
    ["IPv6 loopback", "https://[::1]:9/mcp"],
    ["a cloud's metadata service", "https://169.254.169.254/latest/meta-data"],
    ["plain http", "http://service.example/mcp"],
    ["a username", "https://someone@service.example/mcp"],
  ])("won't go to %s, and its error doesn't say where it was going or what it held", async (_, url) => {
    const web = realConnectorWeb(privateName);

    const error = await web.request({ method: "POST", url, headers: { authorization: "Bearer a-secret-token" }, body: "a-secret-body" }).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    const words = String((error as Error).message) + String((error as Error).stack);
    expect(words).not.toContain("a-secret");
    expect(words).not.toContain("meta-data");
  });

  it("won't connect to a name that has come to point at this laptop", async () => {
    const web = realConnectorWeb(privateName);

    await expect(web.request({ method: "GET", url: "https://service.example:9/" })).rejects.toThrow("The connector request failed");
  });

  it("won't connect if even one of a name's addresses is private", async () => {
    const web = realConnectorWeb(mixedName);

    await expect(web.request({ method: "GET", url: "https://service.example:9/" })).rejects.toThrow("The connector request failed");
  });
});

describe("keeping to the service's own domain", () => {
  it("sends what's on it", async () => {
    const web = new SavedConnectors();
    const answer = await keptToOwnDomain(web, "notion.com")({ method: "GET", url: "https://mcp.notion.com/x" });

    expect(answer.status).toBe(404);
    expect(web.requests).toHaveLength(1);
  });

  it.each([["https://evil.example/x"], ["https://notion.com.evil.example/x"], ["https://notion.com@evil.example/x"], ["http://mcp.notion.com/x"], ["https://127.0.0.1/x"]])("sends nothing to %s", async (url) => {
    const web = new SavedConnectors();

    await expect(keptToOwnDomain(web, "notion.com")({ method: "GET", url })).rejects.toThrow(OffTheServicesDomain);
    expect(web.requests).toEqual([]);
  });
});
