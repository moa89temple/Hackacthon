import { describe, expect, it } from "vitest";
import { hostsOverlap, isServicesOwnAddress, serviceDomainFrom } from "../src/service-domain.ts";

describe("a connector counts as the service's own", () => {
  it.each([
    ["the service's domain itself", "https://notion.so/mcp", "notion.so"],
    ["a subdomain of it", "https://mcp.notion.so/mcp", "notion.so"],
    ["a deeper subdomain", "https://a.b.notion.so/mcp", "notion.so"],
    ["an address with the root path", "https://mcp.stripe.com", "stripe.com"],
    ["mixed case", "HTTPS://MCP.Notion.SO/mcp", "notion.so"],
    ["the default port spelled out", "https://mcp.notion.so:443/mcp", "notion.so"],
    ["a country-code domain", "https://mcp.service.co.uk/mcp", "service.co.uk"],
  ])("on %s", (_, address, domain) => {
    expect(isServicesOwnAddress(address, domain)).toBe(true);
  });
});

describe("a connector made by anyone else is refused", () => {
  it.each([
    ["a lookalike with the name in front", "https://notion.so.evil.com/mcp", "notion.so"],
    ["a lookalike with the name at the end", "https://evilnotion.so/mcp", "notion.so"],
    ["a lookalike with a hyphen", "https://mcp-notion.so/mcp", "notion.so"],
    ["the same name on another ending", "https://mcp.notion.com/mcp", "notion.so"],
    ["the name only in the path", "https://evil.com/mcp.notion.so", "notion.so"],
    ["the name only in the fragment", "https://evil.com/#mcp.notion.so", "notion.so"],
    ["the name only in the query", "https://evil.com/?host=mcp.notion.so", "notion.so"],
    ["a sister domain of the same company", "https://mcp.atlassian.com/v1/mcp", "jira.com"],
    ["another company's connector for this service", "https://notion-mcp.vercel.app/mcp", "notion.so"],
  ])("%s", (_, address, domain) => {
    expect(isServicesOwnAddress(address, domain)).toBe(false);
  });
});

describe("an address that hides where it goes is refused", () => {
  it.each([
    ["the service's name as the username", "https://notion.so@evil.com/mcp"],
    ["the service's name as the username and password", "https://notion.so:mcp@evil.com/mcp"],
    ["a username on the service's own host", "https://someone@mcp.notion.so/mcp"],
    ["a password on the service's own host", "https://someone:secret@mcp.notion.so/mcp"],
    ["a backslash before the host", "https://evil.com\\@mcp.notion.so/mcp"],
    ["a space in it", "https://mcp.notion.so /mcp"],
    ["a tab in the host, which the parser would drop", "https://mcp.not\tion.so/mcp"],
    ["a newline in the host, which the parser would drop", "https://mcp.not\nion.so/mcp"],
    ["a trailing dot", "https://mcp.notion.so./mcp"],
    ["two trailing dots", "https://mcp.notion.so../mcp"],
    ["a fragment", "https://mcp.notion.so/mcp#there"],
  ])("%s", (_, address) => {
    expect(isServicesOwnAddress(address, "notion.so")).toBe(false);
  });

  it.each([["nothing"], ["not an address"], ["//mcp.notion.so/mcp"], ["mcp.notion.so/mcp"]])("something that isn't a whole address: %s", (address) => {
    expect(isServicesOwnAddress(address, "notion.so")).toBe(false);
  });

  it("anything that isn't words", () => {
    expect(isServicesOwnAddress(undefined as unknown as string, "notion.so")).toBe(false);
  });
});

describe("the way it's reached", () => {
  it.each([
    ["plain http", "http://mcp.notion.so/mcp"],
    ["another port", "https://mcp.notion.so:8443/mcp"],
    ["a websocket", "wss://mcp.notion.so/mcp"],
    ["a file", "file:///mcp.notion.so"],
  ])("%s is refused", (_, address) => {
    expect(isServicesOwnAddress(address, "notion.so")).toBe(false);
  });
});

describe("this laptop and private networks", () => {
  it.each([
    ["localhost", "https://localhost/mcp", "localhost"],
    ["a name under localhost", "https://mcp.localhost/mcp", "localhost"],
    ["loopback", "https://127.0.0.1/mcp", "127.0.0.1"],
    ["loopback as one number", "https://2130706433/mcp", "2130706433"],
    ["loopback in hex", "https://0x7f.0.0.1/mcp", "0x7f.0.0.1"],
    ["a private address", "https://192.168.1.10/mcp", "192.168.1.10"],
    ["another private address", "https://10.0.0.5/mcp", "10.0.0.5"],
    ["a cloud's metadata service", "https://169.254.169.254/mcp", "169.254.169.254"],
    ["IPv6 loopback", "https://[::1]/mcp", "::1"],
    ["IPv4 inside IPv6", "https://[::ffff:7f00:1]/mcp", "::ffff:7f00:1"],
    ["a private name", "https://mcp.corp.internal/mcp", "corp.internal"],
    ["another private name", "https://printer.local/mcp", "printer.local"],
    ["Docker's name for this laptop", "https://host.docker.internal/mcp", "docker.internal"],
  ])("%s is refused", (_, address, domain) => {
    expect(isServicesOwnAddress(address, domain)).toBe(false);
  });
});

describe("punycode lookalikes", () => {
  // These are Cyrillic letters that look like Latin ones. The URL parser turns them into xn-- names.
  it("a connector whose name only looks like the service's is refused", () => {
    expect(isServicesOwnAddress("https://mcp.nоtion.so/mcp", "notion.so")).toBe(false);
    expect(isServicesOwnAddress("https://mcp.xn--ntion-4nf.so/mcp", "notion.so")).toBe(false);
  });

  it("a subdomain spelled in punycode is refused even on the service's own domain", () => {
    expect(isServicesOwnAddress("https://xn--mcp-4cd.notion.so/mcp", "notion.so")).toBe(false);
  });

  it("a service whose own name is in punycode can't have a connector", () => {
    expect(isServicesOwnAddress("https://mcp.xn--ntion-4nf.so/mcp", "xn--ntion-4nf.so")).toBe(false);
  });
});

describe("shared hosting, where being a subdomain proves nothing", () => {
  it.each([
    ["vercel", "https://x.vercel.app/mcp", "x.vercel.app"],
    ["vercel's suffix as the service", "https://x.vercel.app/mcp", "vercel.app"],
    ["GitHub Pages", "https://x.github.io/mcp", "x.github.io"],
    ["GitHub Pages' suffix as the service", "https://x.github.io/mcp", "github.io"],
    ["Notion's public pages", "https://x.notion.site/mcp", "notion.site"],
    ["Blogger", "https://x.blogspot.com/mcp", "blogspot.com"],
    ["a public suffix itself", "https://mcp.co.uk/mcp", "co.uk"],
    ["an ending anyone can register under", "https://mcp.com/mcp", "com"],
  ])("%s is refused", (_, address, domain) => {
    expect(isServicesOwnAddress(address, domain)).toBe(false);
  });

  it("a service can't name a subdomain as its own domain", () => {
    expect(isServicesOwnAddress("https://mcp.notion.so/mcp", "mcp.notion.so")).toBe(false);
  });

  it("an ending nobody publishes is refused", () => {
    expect(isServicesOwnAddress("https://mcp.notion.madeup/mcp", "notion.madeup")).toBe(false);
  });
});

describe("what the Student or the model calls the service's address", () => {
  it.each([
    ["a bare domain", "notion.so", "notion.so"],
    ["a subdomain", "www.notion.so", "notion.so"],
    ["a whole address", "https://www.notion.so/product?x=1#y", "notion.so"],
    ["mixed case", "WWW.Notion.SO", "notion.so"],
    ["spaces round it", "  notion.so ", "notion.so"],
    ["a country-code domain", "www.service.co.uk", "service.co.uk"],
  ])("comes down to the domain from %s", (_, website, domain) => {
    expect(serviceDomainFrom(website)).toEqual({ ok: true, domain, sharedHosting: false });
  });

  it.each([
    ["vercel", "x.vercel.app"],
    ["GitHub Pages", "x.github.io"],
    ["Notion's public pages", "https://x.notion.site/page"],
  ])("says when it's on shared hosting: %s", (_, website) => {
    const answer = serviceDomainFrom(website);
    expect(answer).toMatchObject({ ok: true, sharedHosting: true });
  });

  it.each([
    ["nothing", ""],
    ["words", "my notes app"],
    ["a username", "https://notion.so@evil.com"],
    ["plain http", "http://notion.so"],
    ["another scheme", "ftp://notion.so"],
    ["a port", "notion.so:8443"],
    ["a trailing dot", "notion.so."],
    ["loopback", "127.0.0.1"],
    ["one number", "2130706433"],
    ["IPv6", "[::1]"],
    ["localhost", "localhost"],
    ["a private name", "printer.local"],
    ["Docker's name for this laptop", "host.docker.internal"],
    ["a public suffix", "co.uk"],
    ["a shared host's own suffix", "vercel.app"],
    ["an ending nobody publishes", "notion.madeup"],
    ["punycode", "xn--ntion-4nf.so"],
    ["a lookalike in another alphabet", "nоtion.so"],
    ["a backslash", "evil.com\\@notion.so"],
  ])("is refused: %s", (_, website) => {
    expect(serviceDomainFrom(website).ok).toBe(false);
  });

  it("is refused when it isn't words", () => {
    expect(serviceDomainFrom(42).ok).toBe(false);
    expect(serviceDomainFrom(null).ok).toBe(false);
  });
});

describe("whether two hosts share any part of the web", () => {
  it.each([
    ["the same", "temple.edu", "temple.edu"],
    ["a subdomain of it", "temple.edu", "fim.temple.edu"],
    ["the other way round", "fim.temple.edu", "temple.edu"],
    ["a deeper one", "office.com", "a.outlook.office.com"],
  ])("they do when it's %s", (_, left, right) => {
    expect(hostsOverlap(left, right)).toBe(true);
  });

  it.each([
    ["only the ending matches", "eviltemple.edu", "temple.edu"],
    ["only the start matches", "temple.edu.evil.com", "temple.edu"],
    ["they're unrelated", "notion.so", "temple.edu"],
  ])("they don't when %s", (_, left, right) => {
    expect(hostsOverlap(left, right)).toBe(false);
  });
});
