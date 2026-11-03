import type { ConnectorRequest, ConnectorResponse, ConnectorWeb } from "../../src/connector-web.ts";

type Answer = ConnectorResponse | ((request: ConnectorRequest) => ConnectorResponse);

const NOT_FOUND: ConnectorResponse = { status: 404, headers: {}, text: "Not found" };

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): ConnectorResponse => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  text: JSON.stringify(body),
});

/** Serves saved answers, and records every request. Everything it hasn't been told about answers 404. */
export class SavedConnectors implements ConnectorWeb {
  readonly requests: ConnectorRequest[] = [];
  readonly #answers = new Map<string, Answer>();
  /** Hosts whose name leads somewhere private. */
  readonly privateHosts = new Set<string>();
  /** Behaves as if the laptop had no connection. */
  unreachable = false;

  on(method: ConnectorRequest["method"], url: string, answer: Answer): void {
    this.#answers.set(`${method} ${url}`, answer);
  }

  async request(request: ConnectorRequest): Promise<ConnectorResponse> {
    this.requests.push(structuredClone({ ...request, enoughWhen: undefined }));
    if (this.unreachable) throw new Error("SavedConnectors: no connection");
    const answer = this.#answers.get(`${request.method} ${request.url}`) ?? NOT_FOUND;
    return typeof answer === "function" ? answer(request) : answer;
  }

  async leadsOnlyToPublicAddresses(host: string): Promise<boolean> {
    if (this.unreachable) throw new Error("SavedConnectors: no connection");
    return !this.privateHosts.has(host);
  }

  get hostsAsked(): string[] {
    return [...new Set(this.requests.map(({ url }) => new URL(url).hostname))];
  }
}

export interface MadeUpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export const READ_TOOL: MadeUpTool = { name: "search_pages", description: "Searches pages.", annotations: { readOnlyHint: true } };
export const OTHER_READ_TOOL: MadeUpTool = { name: "get_me", description: "Who you are.", annotations: { readOnlyHint: true, destructiveHint: false } };
export const WRITE_TOOL: MadeUpTool = { name: "create_page", description: "Makes a page.", annotations: { readOnlyHint: false } };
export const UNMARKED_TOOL: MadeUpTool = { name: "update_page", description: "Changes a page." };
export const DESTRUCTIVE_TOOL: MadeUpTool = { name: "delete_page", description: "Deletes a page.", annotations: { destructiveHint: true } };
export const LYING_TOOL: MadeUpTool = { name: "purge_all", description: "Purges.", annotations: { readOnlyHint: true, destructiveHint: true } };

/**
 * A made-up connector that behaves the way real ones were seen to on 2026-11-03: the shape of each answer here is copied
 * from what mcp.notion.com, mcp.linear.app and docs.mcp.cloudflare.com said to a request with no login. What a
 * real one does after a login hasn't been seen, because nobody has logged in to one.
 */
export class MadeUpConnector {
  readonly web: SavedConnectors;
  readonly domain: string;
  readonly url: string;
  readonly origin: string;
  tools: MadeUpTool[] = [READ_TOOL, OTHER_READ_TOOL, WRITE_TOOL, UNMARKED_TOOL, DESTRUCTIVE_TOOL, LYING_TOOL];
  /** The tokens it takes. */
  readonly goodTokens = new Set<string>();
  /** What a tokenless request gets, for one that takes no login. */
  open = false;
  /** What the token endpoint does next. */
  nextTokens: ConnectorResponse = json({ access_token: "made-up-access-token", token_type: "Bearer", refresh_token: "made-up-refresh-token", expires_in: 3600 });
  registration: ConnectorResponse = json({ client_id: "made-up-client", token_endpoint_auth_method: "none" }, 201);
  toolListStatus = 200;

  constructor(web: SavedConnectors, domain: string, options: { host?: string; document?: Record<string, unknown>; metadata?: Record<string, unknown>; path?: string } = {}) {
    this.web = web;
    this.domain = domain;
    this.origin = `https://${options.host ?? `mcp.${domain}`}`;
    this.url = `${this.origin}${options.path ?? "/mcp"}`;
    const path = new URL(this.url).pathname;
    const metadataAddress = `${this.origin}/.well-known/oauth-protected-resource${path}`;

    web.on("POST", this.url, (request) => this.#answerMcp(request, metadataAddress));
    web.on("GET", metadataAddress, json({ resource: this.url, authorization_servers: [this.origin], scopes_supported: ["read", "write"], bearer_methods_supported: ["header"], ...options.document }));
    web.on(
      "GET",
      `${this.origin}/.well-known/oauth-authorization-server`,
      json({
        issuer: this.origin,
        authorization_endpoint: `${this.origin}/authorize`,
        token_endpoint: `${this.origin}/token`,
        registration_endpoint: `${this.origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
        code_challenge_methods_supported: ["S256"],
        ...options.metadata,
      }),
    );
    web.on("POST", `${this.origin}/register`, () => this.registration);
    web.on("POST", `${this.origin}/token`, () => {
      const answer = this.nextTokens;
      const token = (JSON.parse(answer.text || "{}") as { access_token?: string }).access_token;
      if (answer.status === 200 && token) this.goodTokens.add(token);
      return answer;
    });
  }

  #answerMcp(request: ConnectorRequest, metadataAddress: string): ConnectorResponse {
    const token = request.headers?.authorization?.replace(/^Bearer /, "");
    if (!this.open && !(token && this.goodTokens.has(token))) {
      return { status: 401, headers: { "www-authenticate": `Bearer realm="OAuth", resource_metadata="${metadataAddress}", scope="read write"` }, text: "" };
    }
    const message = JSON.parse(request.body ?? "{}") as { id?: number; method: string };
    if (message.method === "initialize") {
      return { status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "made-up-session" }, text: `event: message\ndata: ${JSON.stringify({ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "made-up", version: "1" } }, jsonrpc: "2.0", id: message.id })}\n\n` };
    }
    if (message.method === "notifications/initialized") return { status: 202, headers: {}, text: "" };
    if (message.method === "tools/list") {
      if (this.toolListStatus !== 200) return { status: this.toolListStatus, headers: {}, text: "" };
      return json({ jsonrpc: "2.0", id: message.id, result: { tools: this.tools.map((tool) => ({ inputSchema: { type: "object", properties: {} }, ...tool })) } });
    }
    return json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  }

  /** Every token request it's had, with its fields. */
  tokenRequests(): URLSearchParams[] {
    return this.web.requests.filter(({ method, url }) => method === "POST" && url === `${this.origin}/token`).map(({ body }) => new URLSearchParams(body));
  }
}
