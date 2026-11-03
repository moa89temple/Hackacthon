import { isIP } from "node:net";
import { parse } from "tldts";

/**
 * The rule for what counts as a service's own connector: one on the service's own domain, which means that
 * domain or a subdomain of it. There's no list of approved pairs, so a sister domain of the same company doesn't
 * count either. Nothing outside this file decides that, so that a page or the model can't talk its way past it.
 *
 * "Domain" here goes by the Public Suffix List, with its section on shared hosting. Anyone can have x.vercel.app, so
 * being under vercel.app proves nothing, and it makes x.vercel.app no more than a site that anyone could have made.
 */

export type ServiceDomain =
  /** `sharedHosting` means it's somewhere anyone can make a site, so it can't have a connector of its own. */
  { ok: true; domain: string; sharedHosting: boolean } | { ok: false };

/** Anything URL would quietly drop or read differently from how it looks. */
const HIDES_SOMETHING = /[\s\\\u0000-\u001f\u007f]/;
const PUNYCODE_LABEL = /(?:^|\.)xn--/;

const ask = (host: string) => parse(host, { allowPrivateDomains: true, extractHostname: false });

/** Whether this is a real name on the open internet, in plain letters, and not a number or a private name. */
function isPlainPublicHost(host: string): boolean {
  if (host === "" || host.endsWith(".") || host.startsWith("[") || isIP(host) !== 0) return false;
  // Other alphabets can look exactly like Latin letters, and that can't be told from here. A service's address is
  // one the Student has to be able to recognize, so these are refused rather than guessed at.
  if (PUNYCODE_LABEL.test(host)) return false;
  return true;
}

/** The address as URL reads it, or null if it isn't a plain https address on the usual port. */
function plainHttpsAddress(address: unknown): URL | null {
  if (typeof address !== "string" || HIDES_SOMETHING.test(address)) return null;
  const url = URL.parse(address);
  if (!url || url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.hash !== "") return null;
  return url;
}

/** The service's domain, from what the Student or the model wrote: a bare name or a whole https address. */
export function serviceDomainFrom(website: unknown): ServiceDomain {
  if (typeof website !== "string") return { ok: false };
  const trimmed = website.trim();
  if (trimmed === "" || HIDES_SOMETHING.test(trimmed)) return { ok: false };
  // Only here does a fragment or a path not matter: all that's kept is the host.
  const url = URL.parse(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (!url || url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return { ok: false };
  if (!isPlainPublicHost(url.hostname)) return { ok: false };
  const { domain, isIcann, isPrivate } = ask(url.hostname);
  if (!domain || !(isIcann || isPrivate)) return { ok: false };
  return { ok: true, domain, sharedHosting: isPrivate === true };
}

/** Whether this address is on the service's own domain, and only there. It says no to anything it isn't sure of. */
export function isServicesOwnAddress(address: string, serviceDomain: string): boolean {
  const url = plainHttpsAddress(address);
  if (!url || !isPlainPublicHost(url.hostname)) return false;
  const { domain, isIcann, isPrivate } = ask(url.hostname);
  if (!isIcann || isPrivate || domain === null) return false;
  return domain === serviceDomain;
}

/** Whether either host holds the other, the way a site's hosts cover their subdomains in network-guard.ts. */
export function hostsOverlap(left: string, right: string): boolean {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}
