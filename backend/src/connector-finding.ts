import { keptToOwnDomain, type ConnectorWeb } from "./connector-web.ts";
import { findLogin, type LoginPlan } from "./connector-login.ts";
import { askWithoutLogin, listTools, readOnlyTools, type Send } from "./mcp-client.ts";

/** What Buddy found. `login` is null for a connector that takes no login at all. */
export type FoundConnector = { url: string; login: LoginPlan | null };

/**
 * The places a service puts its own connector, going by real ones seen on 2026-11-03: mcp.notion.com/mcp,
 * mcp.linear.app/mcp, mcp.stripe.com, mcp.atlassian.com/v1/mcp and mcp.cloudflare.com/mcp. There's no standard for this
 * yet, and the well-known addresses proposed for it answered 404 on all of those, so a service that keeps its connector
 * anywhere else won't be found, and gets Buddy's Browser. Each is made from the service's domain here, never taken from a page
 * or the model, and the older kind that only works by SSE can't be used, because its tools can't be checked this way.
 */
function conventionalAddresses(domain: string): string[] {
  return [
    `https://mcp.${domain}/mcp`,
    `https://mcp.${domain}/`,
    `https://mcp.${domain}/v1/mcp`,
    `https://${domain}/mcp`,
    `https://www.${domain}/mcp`,
    `https://api.${domain}/mcp`,
  ];
}

/** Null if this address isn't a connector Buddy may use. It can't be reached, or it isn't one, and that's the same thing here. */
async function checkAddress(send: Send, url: string, domain: string): Promise<FoundConnector | null> {
  try {
    const first = await askWithoutLogin(send, url);
    if (first.kind === "open") {
      const list = await listTools(send, url, null);
      return list.kind === "tools" && readOnlyTools(list.tools).length > 0 ? { url, login: null } : null;
    }
    if (first.kind !== "needs_login") return null;
    const login = await findLogin(send, url, domain, first.wwwAuthenticate);
    return login ? { url, login } : null;
  } catch {
    return null;
  }
}

/**
 * Looks for the service's own connector, and answers null unless there's one a Student can use alone. All of it is
 * kept to the service's own domain, so nothing a document says can send Buddy anywhere else. It reads nothing of the
 * Student's and sends nothing about them: nobody has logged in yet, and nothing is registered until they tap.
 */
export async function findOwnConnector(web: ConnectorWeb, domain: string): Promise<FoundConnector | null> {
  const send = keptToOwnDomain(web, domain);
  const found = await Promise.all(conventionalAddresses(domain).map((url) => checkAddress(send, url, domain)));
  return found.find((connector) => connector !== null) ?? null;
}
