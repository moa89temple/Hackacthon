import { createHash, randomBytes } from "node:crypto";
import { OffTheServicesDomain } from "./connector-web.ts";
import type { Send } from "./mcp-client.ts";
import { isServicesOwnAddress } from "./service-domain.ts";

/**
 * How a Student logs in to a connector without Buddy learning a password. Claude's MCP connector takes an access
 * token and leaves getting one to Buddy, so Buddy runs the login the MCP specification lays out: OAuth 2.1 with PKCE,
 * found through the connector's own documents and registered dynamically. The Student's part is in a Takeover.
 *
 * "Works without anyone else's approval" is decided here. A connector qualifies only if a stranger can sign up as a
 * client with no secret, and every step of it is on the service's own domain. Anything else means Buddy's Browser.
 */

/** Everything about how to log in. None of it is secret. */
export interface LoginPlan {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  /** Only what a read needs, or null to ask for the service's default. */
  scope: string | null;
  /** The connector, as the token will be tied to it. */
  resource: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  /** How many seconds it lasts, if the service said. */
  expiresIn: number | null;
}

export type TokenAnswer =
  | { kind: "tokens"; tokens: Tokens }
  /** The service said no, which no amount of trying again will change. */
  | { kind: "refused" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const withoutFinalSlash = (address: string) => address.replace(/\/+$/, "");

async function getDocument(send: Send, url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await send({ method: "GET", url, headers: { accept: "application/json" } });
    return response.status === 200 ? parseObject(response.text) : null;
  } catch (error) {
    // A document pointing elsewhere is just a document Buddy won't read. Failing to reach one is for the caller.
    if (error instanceof OffTheServicesDomain) return null;
    throw error;
  }
}

/** Only what's named in the header, and only if it's quoted plainly. */
function headerParameter(wwwAuthenticate: string | null, name: string): string | null {
  return wwwAuthenticate ? (new RegExp(`(?:^|[\\s,])${name}="([^"]*)"`, "i").exec(wwwAuthenticate)?.[1] ?? null) : null;
}

/** RFC 9728: at the root of the host with the connector's path after the well-known part. */
function protectedResourceAddresses(connector: URL): string[] {
  const path = connector.pathname === "/" ? "" : connector.pathname;
  return [...new Set([`${connector.origin}/.well-known/oauth-protected-resource${path}`, `${connector.origin}/.well-known/oauth-protected-resource`])];
}

/** RFC 8414 and OpenID Connect, in the order the MCP specification gives. Stripe's issuer has a path, so this matters. */
function serverMetadataAddresses(issuer: URL): string[] {
  const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  return path === ""
    ? [`${issuer.origin}/.well-known/oauth-authorization-server`, `${issuer.origin}/.well-known/openid-configuration`]
    : [`${issuer.origin}/.well-known/oauth-authorization-server${path}`, `${issuer.origin}/.well-known/openid-configuration${path}`, `${issuer.origin}${path}/.well-known/openid-configuration`];
}

const listed = (value: unknown, wanted: string) => Array.isArray(value) && value.includes(wanted);
const WRITES = /write|admin|manage|delete|create|edit|update|send|full/i;

/** A Read Permission only reads, so a scope that sounds like more isn't asked for. The tools are held to reading anyway. */
function scopeForReading(advertised: string | null, supported: unknown, serverSupported: unknown): string | null {
  const offered = advertised !== null ? advertised.split(/\s+/) : Array.isArray(supported) ? supported.filter((scope): scope is string => typeof scope === "string") : [];
  const reading = offered.filter((scope) => scope !== "" && !WRITES.test(scope));
  // Without this, some services give no way to keep the login past the first token.
  if (listed(serverSupported, "offline_access") && !reading.includes("offline_access")) reading.push("offline_access");
  return reading.length > 0 ? reading.join(" ") : null;
}

/**
 * Works out how to log in to this connector, or returns null if it needs anyone else's approval or leaves the
 * service's own domain at any step. Throws only if something couldn't be reached.
 */
export async function findLogin(send: Send, connectorUrl: string, serviceDomain: string, wwwAuthenticate: string | null): Promise<LoginPlan | null> {
  const connector = new URL(connectorUrl);

  const named = headerParameter(wwwAuthenticate, "resource_metadata");
  if (named !== null && !isServicesOwnAddress(named, serviceDomain)) return null;
  let protectedResource: Record<string, unknown> | null = null;
  for (const address of named !== null ? [named] : protectedResourceAddresses(connector)) {
    protectedResource = await getDocument(send, address);
    if (protectedResource) break;
  }

  let issuer = connector.origin;
  let resource = withoutFinalSlash(connectorUrl);
  if (protectedResource) {
    // RFC 9728 says to reject a document about something other than the address it was fetched for.
    const about = protectedResource.resource;
    if (typeof about !== "string" || !isServicesOwnAddress(about, serviceDomain) || !`${withoutFinalSlash(connectorUrl)}/`.startsWith(`${withoutFinalSlash(about)}/`)) return null;
    const servers = protectedResource.authorization_servers;
    const own = Array.isArray(servers) ? servers.filter((server): server is string => typeof server === "string" && isServicesOwnAddress(server, serviceDomain)) : [];
    if (own.length === 0) return null;
    issuer = own[0]!;
    resource = withoutFinalSlash(about);
  }

  let metadata: Record<string, unknown> | null = null;
  for (const address of serverMetadataAddresses(new URL(issuer))) {
    metadata = await getDocument(send, address);
    if (metadata) break;
  }
  if (!metadata || withoutFinalSlash(String(metadata.issuer)) !== withoutFinalSlash(issuer)) return null;

  const { authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, registration_endpoint: registrationEndpoint } = metadata;
  // No registration means a client someone has to set up by hand, and that isn't a Student on their own.
  if (typeof authorizationEndpoint !== "string" || typeof tokenEndpoint !== "string" || typeof registrationEndpoint !== "string") return null;
  if (![authorizationEndpoint, tokenEndpoint, registrationEndpoint].every((endpoint) => isServicesOwnAddress(endpoint, serviceDomain))) return null;
  if (!listed(metadata.response_types_supported, "code")) return null;
  // The MCP specification says to refuse a server that doesn't say it does this.
  if (!listed(metadata.code_challenge_methods_supported, "S256")) return null;
  // Buddy is a client with no secret. Any other way in is a client someone has to be given.
  if (!listed(metadata.token_endpoint_auth_methods_supported, "none")) return null;

  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    scope: scopeForReading(headerParameter(wwwAuthenticate, "scope"), protectedResource?.scopes_supported ?? metadata.scopes_supported, metadata.scopes_supported),
    resource,
  };
}

/** Signs Buddy up as a client, or returns null if the service won't have a stranger. Throws if it can't be reached. */
export async function registerClient(send: Send, plan: LoginPlan, redirectUri: string): Promise<string | null> {
  const response = await send({
    method: "POST",
    url: plan.registrationEndpoint,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Buddy",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(plan.scope ? { scope: plan.scope } : {}),
    }),
  });
  if (response.status >= 500) throw new Error("The connector's registration didn't answer properly");
  if (response.status !== 200 && response.status !== 201) return null;
  const client = parseObject(response.text);
  if (typeof client?.client_id !== "string" || client.client_id === "") return null;
  // A client given a secret isn't what was asked for, and Buddy has no way of using one.
  if (client.token_endpoint_auth_method !== undefined && client.token_endpoint_auth_method !== "none") return null;
  return client.client_id;
}

/** Made fresh for each login, and kept by the backend. Only the challenge goes to the browser. */
export function newLoginAttempt(): { state: string; verifier: string } {
  return { state: randomBytes(32).toString("base64url"), verifier: randomBytes(32).toString("base64url") };
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The page where the Student logs in and says yes, which goes on the screen in a Takeover. */
export function authorizationAddress(plan: LoginPlan, clientId: string, redirectUri: string, attempt: { state: string; verifier: string }): string {
  const address = new URL(plan.authorizationEndpoint);
  const parameters = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: attempt.state,
    code_challenge: challengeFor(attempt.verifier),
    code_challenge_method: "S256",
    resource: plan.resource,
    ...(plan.scope ? { scope: plan.scope } : {}),
  };
  for (const [name, value] of Object.entries(parameters)) address.searchParams.set(name, value);
  return address.href;
}

export type LoginReturn =
  | { kind: "code"; code: string }
  /** The service sent the Student back with a refusal. It says which kind, in OAuth's words. */
  | { kind: "error" }
  /** It isn't an answer to this attempt, or there's none. */
  | { kind: "nothing" };

/** Where the Student's browser ended up, if it's the page the service sends them back to. */
export function readLoginReturn(address: string | null, redirectUri: string, expectedState: string, issuer: string): LoginReturn {
  const url = address ? URL.parse(address) : null;
  const back = new URL(redirectUri);
  if (!url || url.origin !== back.origin || url.pathname !== back.pathname) return { kind: "nothing" };
  // Anything could have put this address on the screen. Only the state ties it to the attempt Buddy started.
  if (url.searchParams.get("state") !== expectedState) return { kind: "nothing" };
  const namedIssuer = url.searchParams.get("iss");
  if (namedIssuer !== null && withoutFinalSlash(namedIssuer) !== withoutFinalSlash(issuer)) return { kind: "nothing" };
  if (url.searchParams.has("error")) return { kind: "error" };
  const code = url.searchParams.get("code");
  return code ? { kind: "code", code } : { kind: "nothing" };
}

async function askForTokens(send: Send, plan: LoginPlan, form: Record<string, string>): Promise<TokenAnswer> {
  const response = await send({
    method: "POST",
    url: plan.tokenEndpoint,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ ...form, resource: plan.resource }).toString(),
  });
  if (response.status >= 500) throw new Error("The connector's login didn't answer properly");
  if (response.status !== 200) return { kind: "refused" };
  const answer = parseObject(response.text);
  if (typeof answer?.access_token !== "string" || answer.access_token === "") return { kind: "refused" };
  if (typeof answer.token_type === "string" && answer.token_type.toLowerCase() !== "bearer") return { kind: "refused" };
  return {
    kind: "tokens",
    tokens: {
      accessToken: answer.access_token,
      refreshToken: typeof answer.refresh_token === "string" && answer.refresh_token !== "" ? answer.refresh_token : null,
      expiresIn: typeof answer.expires_in === "number" && answer.expires_in > 0 ? answer.expires_in : null,
    },
  };
}

export const exchangeCode = (send: Send, plan: LoginPlan, clientId: string, code: string, verifier: string, redirectUri: string): Promise<TokenAnswer> =>
  askForTokens(send, plan, { grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri });

export const refreshTokens = (send: Send, plan: LoginPlan, clientId: string, refreshToken: string): Promise<TokenAnswer> =>
  askForTokens(send, plan, { grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });
