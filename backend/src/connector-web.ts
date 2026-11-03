import { lookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isServicesOwnAddress } from "./service-domain.ts";

export interface ConnectorRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /**
   * For an answer that's a stream the server may hold open: says when enough has come. Without it, the
   * request waits for the whole answer.
   */
  enoughWhen?: (textSoFar: string) => boolean;
}

export interface ConnectorResponse {
  status: number;
  /** By lower-case name. */
  headers: Record<string, string>;
  text: string;
}

/**
 * Talking to a service's own connector and its login documents. It's separate from Web because it needs
 * POST, headers and a guard on where a name really leads. Tests use saved copies: see test/support/saved-connectors.ts.
 */
export interface ConnectorWeb {
  /**
   * Throws if there's no answer. A redirect is an answer like any other and is never followed. The error never says
   * which address was asked for or what was sent, because a token may be among it.
   */
  request(request: ConnectorRequest): Promise<ConnectorResponse>;
  /** Whether this name leads only to addresses on the open internet. Throws if it can't be looked up. */
  leadsOnlyToPublicAddresses(host: string): Promise<boolean>;
}

const TIMEOUT_MS = 15_000;
/** A login document or a list of tools is small. This stops a runaway answer. */
const MAX_BYTES = 5 * 1024 * 1024;

const NOT_ON_THE_INTERNET = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  // Tailscale's addresses, among others, and this laptop is on Tailscale.
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NOT_ON_THE_INTERNET.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // NAT64, which reaches IPv4 addresses, including private ones.
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  NOT_ON_THE_INTERNET.addSubnet(network, prefix, "ipv6");
}

/** Anything that couldn't be a stranger's server on the open internet, such as this laptop or a cloud's metadata service. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const family = isIP(mapped ?? address);
  if (family === 0) return true;
  if (family === 4) return NOT_ON_THE_INTERNET.check(mapped ?? address, "ipv4");
  // ::ffff:7f00:1 is the same thing written in hex.
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hexMapped) {
    const [high, low] = [parseInt(hexMapped[1]!, 16), parseInt(hexMapped[2]!, 16)];
    return NOT_ON_THE_INTERNET.check(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, "ipv4");
  }
  return NOT_ON_THE_INTERNET.check(address, "ipv6");
}

type Resolve = (host: string) => Promise<LookupAddress[]>;

const resolveWithSystem: Resolve = (host) =>
  new Promise((resolve, reject) => lookup(host, { all: true }, (error, addresses) => (error ? reject(error) : resolve(addresses))));

/**
 * Checks where a name leads at the moment of connecting, on the address that's actually connected to, so that a name
 * that points somewhere public when it's checked and at this laptop a second later still can't get there.
 */
function guardedLookup(resolve: Resolve): RequestOptions["lookup"] {
  return (host, options, callback) => {
    resolve(host).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
          (callback as (error: Error) => void)(new Error("That name doesn't lead to the open internet"));
        } else if ((options as { all?: boolean }).all) {
          (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, addresses);
        } else {
          (callback as unknown as (error: null, address: string, family: number) => void)(null, addresses[0]!.address, addresses[0]!.family);
        }
      },
      (error: Error) => (callback as (error: Error) => void)(error),
    );
  };
}

/**
 * The real thing. It only goes to plain https addresses, only connects to public addresses, and sends no cookies.
 * A failure's own error stays behind, so that nothing about the request can end up in the logs.
 */
export function realConnectorWeb(resolve: Resolve = resolveWithSystem): ConnectorWeb {
  return {
    request({ method, url, headers = {}, body, enoughWhen }) {
      return new Promise((settle, fail) => {
        const failed = (reason: string) => fail(new Error(`The connector request failed: ${reason}`));
        const parsed = URL.parse(url);
        if (!parsed || parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hostname.startsWith("[") || isIP(parsed.hostname) !== 0) {
          failed("not a plain https address");
          return;
        }
        const request = httpsRequest(
          parsed,
          { method, headers, lookup: guardedLookup(resolve), signal: AbortSignal.timeout(TIMEOUT_MS) },
          (response) => {
            const decoder = new TextDecoder();
            let text = "";
            let bytes = 0;
            const finish = () =>
              settle({
                status: response.statusCode ?? 0,
                headers: Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : (value ?? "")])),
                text,
              });
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > MAX_BYTES) {
                request.destroy();
                failed("too large");
                return;
              }
              text += decoder.decode(chunk, { stream: true });
              if (enoughWhen?.(text)) {
                finish();
                request.destroy();
              }
            });
            response.on("end", () => {
              text += decoder.decode();
              finish();
            });
            response.on("error", () => failed("the answer broke off"));
          },
        );
        request.on("error", (error) => failed(error.name));
        request.end(body);
      });
    },

    async leadsOnlyToPublicAddresses(host) {
      if (isIP(host) !== 0) return false;
      const addresses = await resolve(host);
      return addresses.length > 0 && !addresses.some(({ address }) => isPrivateAddress(address));
    },
  };
}

/**
 * What every part of finding and using a connector talks through, so that none of them can be pointed at anywhere but
 * the service's own domain, whatever a document or an answer says. Anything else throws before it's sent.
 */
export function keptToOwnDomain(web: ConnectorWeb, serviceDomain: string): ConnectorWeb["request"] {
  return (request) => {
    if (!isServicesOwnAddress(request.url, serviceDomain)) {
      return Promise.reject(new OffTheServicesDomain());
    }
    return web.request(request);
  };
}

export class OffTheServicesDomain extends Error {
  constructor() {
    super("That address isn't on the service's own domain");
  }
}
