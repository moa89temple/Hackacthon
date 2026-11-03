import { describe, expect, it } from "vitest";
import { findOwnConnector } from "../src/connector-finding.ts";
import { authorizationAddress, challengeFor, findLogin, readLoginReturn, type LoginPlan } from "../src/connector-login.ts";
import { keptToOwnDomain, OffTheServicesDomain } from "../src/connector-web.ts";
import { listTools, readOnlyTools, type McpTool } from "../src/mcp-client.ts";
import { json, MadeUpConnector, SavedConnectors } from "./support/saved-connectors.ts";

/** Copied from what each of these said to a request with no login on 2026-11-03. Nobody has logged in to any of them. */
const REAL_NOTION = {
  challenge: 'Bearer realm="OAuth", resource_metadata="https://mcp.notion.com/.well-known/oauth-protected-resource/mcp", scope="default"',
  resource: { resource: "https://mcp.notion.com/mcp", authorization_servers: ["https://mcp.notion.com"], scopes_supported: ["default"], bearer_methods_supported: ["header"], resource_name: "Notion MCP (Beta)" },
  server: {
    issuer: "https://mcp.notion.com",
    authorization_endpoint: "https://mcp.notion.com/authorize",
    token_endpoint: "https://mcp.notion.com/token",
    registration_endpoint: "https://mcp.notion.com/register",
    scopes_supported: ["default", "ema_issuer:manage"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none", "private_key_jwt"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  },
};

/** A login document only at the root, and no document about the connector at all. */
const REAL_ATLASSIAN = {
  server: {
    issuer: "https://mcp.atlassian.com",
    authorization_endpoint: "https://mcp.atlassian.com/v1/authorize",
    token_endpoint: "https://mcp.atlassian.com/v1/token",
    registration_endpoint: "https://mcp.atlassian.com/v1/register",
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    code_challenge_methods_supported: ["plain", "S256"],
  },
};

/** A login on another host of the same domain, whose issuer has a path. */
const REAL_STRIPE = {
  challenge: 'Bearer resource_metadata="https://mcp.stripe.com/.well-known/oauth-protected-resource"',
  resource: { resource: "https://mcp.stripe.com", scopes_supported: ["mcp"], authorization_servers: ["https://access.stripe.com/mcp"] },
  server: {
    issuer: "https://access.stripe.com/mcp",
    authorization_endpoint: "https://access.stripe.com/mcp/oauth2/authorize",
    token_endpoint: "https://access.stripe.com/mcp/oauth2/token",
    registration_endpoint: "https://access.stripe.com/mcp/oauth2/register",
    response_types_supported: ["code"],
    scopes_supported: ["mcp"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  },
};

const needsLogin = (challenge: string) => ({ status: 401, headers: { "www-authenticate": challenge }, text: "" });

describe("finding a service's own connector", () => {
  it("finds Notion's the way it really answers", async () => {
    const web = new SavedConnectors();
    web.on("POST", "https://mcp.notion.com/mcp", needsLogin(REAL_NOTION.challenge));
    web.on("GET", "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp", json(REAL_NOTION.resource));
    web.on("GET", "https://mcp.notion.com/.well-known/oauth-authorization-server", json(REAL_NOTION.server));

    expect(await findOwnConnector(web, "notion.com")).toEqual({
      url: "https://mcp.notion.com/mcp",
      login: {
        issuer: "https://mcp.notion.com",
        authorizationEndpoint: "https://mcp.notion.com/authorize",
        tokenEndpoint: "https://mcp.notion.com/token",
        registrationEndpoint: "https://mcp.notion.com/register",
        scope: "default",
        resource: "https://mcp.notion.com/mcp",
      },
    });
  });

  it("finds Atlassian's, which has no document about the connector, by its login document", async () => {
    const web = new SavedConnectors();
    web.on("POST", "https://mcp.atlassian.com/v1/mcp", needsLogin('Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token"'));
    web.on("GET", "https://mcp.atlassian.com/.well-known/oauth-authorization-server", json(REAL_ATLASSIAN.server));

    const found = await findOwnConnector(web, "atlassian.com");

    expect(found?.url).toBe("https://mcp.atlassian.com/v1/mcp");
    expect(found?.login?.registrationEndpoint).toBe("https://mcp.atlassian.com/v1/register");
  });

  it("finds Stripe's, whose login is on another host of its own domain", async () => {
    const web = new SavedConnectors();
    web.on("POST", "https://mcp.stripe.com/", needsLogin(REAL_STRIPE.challenge));
    web.on("GET", "https://mcp.stripe.com/.well-known/oauth-protected-resource", json(REAL_STRIPE.resource));
    web.on("GET", "https://access.stripe.com/.well-known/oauth-authorization-server/mcp", json(REAL_STRIPE.server));

    const found = await findOwnConnector(web, "stripe.com");

    expect(found?.url).toBe("https://mcp.stripe.com/");
    expect(found?.login?.tokenEndpoint).toBe("https://access.stripe.com/mcp/oauth2/token");
    expect(found?.login?.resource).toBe("https://mcp.stripe.com");
    expect(found?.login?.scope).toBe("mcp");
  });

  it("finds one with no login, and reads its answer whichever way it streams", async () => {
    const web = new SavedConnectors();
    const connector = new MadeUpConnector(web, "docs.org");
    connector.open = true;

    expect(await findOwnConnector(web, "docs.org")).toEqual({ url: connector.url, login: null });
  });

  it("finds nothing where nothing answers as a connector, such as a web page saying 200", async () => {
    const web = new SavedConnectors();
    web.on("POST", "https://mcp.linkedin.com/mcp", { status: 404, headers: { "content-type": "text/html" }, text: "<html>LinkedIn</html>" });
    web.on("POST", "https://www.linkedin.com/mcp", { status: 200, headers: { "content-type": "text/html" }, text: "<html>Welcome</html>" });

    expect(await findOwnConnector(web, "linkedin.com")).toBeNull();
  });

  it("finds nothing when nothing can be reached", async () => {
    const web = new SavedConnectors();
    new MadeUpConnector(web, "notion.com");
    web.unreachable = true;

    expect(await findOwnConnector(web, "notion.com")).toBeNull();
  });

  it("never asks anywhere but the service's own domain, whatever its documents say", async () => {
    const web = new SavedConnectors();
    new MadeUpConnector(web, "notion.com", {
      document: { resource: "https://evil.example/mcp", authorization_servers: ["https://evil.example"] },
      metadata: { issuer: "https://evil.example", token_endpoint: "https://evil.example/token" },
    });

    await findOwnConnector(web, "notion.com");

    expect(web.hostsAsked.every((host) => host === "notion.com" || host.endsWith(".notion.com"))).toBe(true);
  });
});

describe("what makes a connector one a Student can use alone", () => {
  const found = async (web: SavedConnectors, domain: string) => findOwnConnector(web, domain);

  it.each([
    ["no way to sign up as a client: someone has to set one up", { registration_endpoint: undefined }],
    ["signing up on someone else's domain", { registration_endpoint: "https://thirdparty.example/register" }],
    ["the login page on someone else's domain", { authorization_endpoint: "https://thirdparty.example/authorize" }],
    ["tokens from someone else's domain", { token_endpoint: "https://thirdparty.example/token" }],
    ["a login page on a sister domain", { authorization_endpoint: "https://login.atlassian.net/authorize" }],
    ["clients must have a secret someone gave them", { token_endpoint_auth_methods_supported: ["client_secret_basic"] }],
    ["it doesn't say which clients it takes", { token_endpoint_auth_methods_supported: undefined }],
    ["no protection for the login code", { code_challenge_methods_supported: ["plain"] }],
    ["it doesn't say it protects the login code", { code_challenge_methods_supported: undefined }],
    ["it doesn't do this kind of login", { response_types_supported: ["token"] }],
    ["a document claiming to be someone else's", { issuer: "https://somewhere-else.notion.com" }],
  ])("not when there's %s", async (_, metadata) => {
    const web = new SavedConnectors();
    new MadeUpConnector(web, "notion.com", { metadata });

    expect(await found(web, "notion.com")).toBeNull();
  });

  it.each([
    ["sends logins to someone else's domain", { authorization_servers: ["https://thirdparty.example"] }],
    ["sends logins nowhere", { authorization_servers: [] }],
    ["says it's about another address", { resource: "https://other.notion.com/mcp" }],
    ["says it's about someone else's address", { resource: "https://evil.example/mcp" }],
  ])("not when the document about the connector %s", async (_, document) => {
    const web = new SavedConnectors();
    new MadeUpConnector(web, "notion.com", { document });

    expect(await found(web, "notion.com")).toBeNull();
  });

  it("not when its answer names a document on someone else's domain", async () => {
    const web = new SavedConnectors();
    web.on("POST", "https://mcp.notion.com/mcp", needsLogin('Bearer resource_metadata="https://evil.example/.well-known/oauth-protected-resource"'));

    expect(await found(web, "notion.com")).toBeNull();
    expect(web.hostsAsked).not.toContain("evil.example");
  });

  it("not when it has no login and nothing marked read-only", async () => {
    const web = new SavedConnectors();
    const connector = new MadeUpConnector(web, "docs.org");
    connector.open = true;
    connector.tools = [{ name: "write_it", annotations: { readOnlyHint: false } }];

    expect(await found(web, "docs.org")).toBeNull();
  });
});

describe("which tools Buddy may switch on", () => {
  const tool = (annotations: McpTool["annotations"]): McpTool => ({ name: "a_tool", description: null, inputSchema: {}, annotations });

  it("only one marked read-only", () => {
    expect(readOnlyTools([tool({ readOnlyHint: true })])).toHaveLength(1);
    expect(readOnlyTools([tool({ readOnlyHint: true, destructiveHint: false })])).toHaveLength(1);
  });

  it.each([
    ["no marks at all", null],
    ["marks that don't say", {}],
    ["marked as not read-only", { readOnlyHint: false }],
    ["marked as read-only in words", { readOnlyHint: "true" }],
    ["marked as read-only by a number", { readOnlyHint: 1 }],
    ["marked as destructive", { destructiveHint: true }],
    ["marked as both, which contradicts itself", { readOnlyHint: true, destructiveHint: true }],
  ])("not one with %s", (_, annotations) => {
    expect(readOnlyTools([tool(annotations as McpTool["annotations"])])).toEqual([]);
  });
});

describe("asking a connector for its tools", () => {
  const web = () => new SavedConnectors();
  const send = (saved: SavedConnectors) => keptToOwnDomain(saved, "docs.org");

  it("follows the pages of a long list, and keeps to a limit", async () => {
    const saved = web();
    saved.on("POST", "https://mcp.docs.org/mcp", (request) => {
      const { id, method, params } = JSON.parse(request.body!) as { id: number; method: string; params?: { cursor?: string } };
      if (method === "initialize") return json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18" } });
      if (method !== "tools/list") return { status: 202, headers: {}, text: "" };
      return json({ jsonrpc: "2.0", id, result: { tools: [{ name: `tool_${params?.cursor ?? "first"}`, inputSchema: {} }], nextCursor: "again" } });
    });

    expect(await listTools(send(saved), "https://mcp.docs.org/mcp", null)).toEqual({ kind: "failed" });
    // Ten pages, the greeting and the note that it's been received. A list that never ends can't keep Buddy here.
    expect(saved.requests).toHaveLength(12);
  });

  it("carries the session the connector gave, and the token", async () => {
    const saved = web();
    const connector = new MadeUpConnector(saved, "docs.org");
    connector.goodTokens.add("a-token");

    const answer = await listTools(send(saved), connector.url, "a-token");

    expect(answer.kind).toBe("tools");
    const last = saved.requests.at(-1)!;
    expect(last.headers).toMatchObject({ authorization: "Bearer a-token", "mcp-session-id": "made-up-session", "mcp-protocol-version": "2025-06-18" });
  });

  it("says when the login isn't good, and when someone else has to say yes", async () => {
    const saved = web();
    const connector = new MadeUpConnector(saved, "docs.org");

    expect(await listTools(send(saved), connector.url, "not-a-good-token")).toEqual({ kind: "needs_login" });

    connector.goodTokens.add("a-token");
    connector.toolListStatus = 403;
    expect(await listTools(send(saved), connector.url, "a-token")).toEqual({ kind: "forbidden" });
  });

  it("can't be sent to an address on any other domain", async () => {
    const saved = web();

    await expect(listTools(send(saved), "https://evil.example/mcp", "a-token")).rejects.toThrow(OffTheServicesDomain);
    expect(saved.requests).toEqual([]);
  });
});

describe("the login", () => {
  const plan: LoginPlan = {
    issuer: "https://mcp.notion.com",
    authorizationEndpoint: "https://mcp.notion.com/authorize",
    tokenEndpoint: "https://mcp.notion.com/token",
    registrationEndpoint: "https://mcp.notion.com/register",
    scope: "read",
    resource: "https://mcp.notion.com/mcp",
  };
  const BACK = "http://127.0.0.1:6080/login-done.html";

  it("protects its code the way the standard's own example does", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("asks for the connector by name, and sends only the challenge to the browser", () => {
    const address = new URL(authorizationAddress(plan, "a-client", BACK, { state: "a-state", verifier: "a-verifier" }));

    expect(Object.fromEntries(address.searchParams)).toEqual({
      response_type: "code",
      client_id: "a-client",
      redirect_uri: BACK,
      state: "a-state",
      code_challenge: challengeFor("a-verifier"),
      code_challenge_method: "S256",
      resource: "https://mcp.notion.com/mcp",
      scope: "read",
    });
    expect(address.href).not.toContain("a-verifier");
  });

  it.each([
    ["Linear's, which offers more than reading", 'Bearer scope="read write"', ["read", "write"], "read"],
    ["Sentry's", "Bearer", ["org:read", "project:write", "team:write", "event:write", "alerts:write"], "org:read"],
    ["Notion's, whose one scope is only called default", 'Bearer scope="default"', ["default"], "default"],
  ])("asks only for what a read needs from %s", async (_, challenge, scopes, expected) => {
    const web = new SavedConnectors();
    new MadeUpConnector(web, "linear.app", { document: { scopes_supported: scopes } });

    const login = await findLogin(keptToOwnDomain(web, "linear.app"), "https://mcp.linear.app/mcp", "linear.app", challenge);

    expect(login?.scope).toBe(expected);
  });

  describe("coming back", () => {
    const back = (query: string) => `${BACK}?${query}`;

    it("takes the code when it's the answer to this attempt", () => {
      expect(readLoginReturn(back("code=a-code&state=a-state"), BACK, "a-state", plan.issuer)).toEqual({ kind: "code", code: "a-code" });
      expect(readLoginReturn(back(`code=a-code&state=a-state&iss=${encodeURIComponent(plan.issuer)}`), BACK, "a-state", plan.issuer)).toEqual({ kind: "code", code: "a-code" });
    });

    it.each([
      ["no address", null],
      ["some other page", "https://mcp.notion.com/home?code=a-code&state=a-state"],
      ["another port on this machine", "http://127.0.0.1:9222/login-done.html?code=a-code&state=a-state"],
      ["another attempt's state", back("code=a-code&state=other")],
      ["no state", back("code=a-code")],
      ["no code", back("state=a-state")],
      ["another server's name on it", back("code=a-code&state=a-state&iss=https%3A%2F%2Fevil.example")],
    ])("ignores %s", (_, address) => {
      expect(readLoginReturn(address, BACK, "a-state", plan.issuer)).toEqual({ kind: "nothing" });
    });

    it("says when the service refused, only for this attempt", () => {
      expect(readLoginReturn(back("error=access_denied&state=a-state"), BACK, "a-state", plan.issuer)).toEqual({ kind: "error", error: "access_denied" });
      expect(readLoginReturn(back("error=access_denied&state=other"), BACK, "a-state", plan.issuer)).toEqual({ kind: "nothing" });
    });
  });
});
