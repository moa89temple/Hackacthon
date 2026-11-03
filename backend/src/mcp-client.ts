import type { ConnectorRequest, ConnectorResponse } from "./connector-web.ts";

/**
 * The little of the MCP protocol Buddy speaks itself, over Streamable HTTP. Claude's MCP connector does the actual
 * reading, but its list of a server's tools leaves out the marks that say which ones only read, so Buddy has to
 * ask for itself. Only tools the server marks read-only ever get switched on: see readOnlyTools.
 *
 * Answers come back as JSON or as one or more server-sent events. Both were seen from real servers on 2026-11-03.
 */

export type Send = (request: ConnectorRequest) => Promise<ConnectorResponse>;

const PROTOCOL_VERSION = "2025-06-18";
/** A server can have many pages of tools, but not that many, and a page mustn't be able to keep Buddy here. */
const MOST_PAGES = 10;
const MOST_TOOLS = 300;

export interface McpTool {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: unknown; destructiveHint?: unknown } | null;
}

export type FirstAnswer =
  /** It answers with no login at all. */
  | { kind: "open" }
  /** It wants a login, and this is what it said about where to get one. */
  | { kind: "needs_login"; wwwAuthenticate: string | null }
  /** It's there, and it won't have Buddy. */
  | { kind: "forbidden" }
  /** Whatever this is, it isn't speaking MCP. */
  | { kind: "not_a_connector" };

export type ToolList =
  | { kind: "tools"; tools: McpTool[] }
  /** The token isn't good, so a new one is needed. */
  | { kind: "needs_login" }
  /** The login is good and this still isn't allowed, which means someone else has to say yes. */
  | { kind: "forbidden" }
  /** It didn't answer properly just now. */
  | { kind: "failed" };

interface Session {
  id: string | null;
  protocol: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Each event's data, in order. */
function eventsIn(text: string): unknown[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n"),
    )
    .filter((data) => data !== "")
    .map(parseJson);
}

const answerTo = (id: number, messages: unknown[]) => messages.find((message) => isRecord(message) && message.id === id && ("result" in message || "error" in message));

/** The answer to this request, however it came. */
function findAnswer(id: number, response: ConnectorResponse): Record<string, unknown> | null {
  const type = (response.headers["content-type"] ?? "").toLowerCase();
  const messages = type.includes("text/event-stream") ? eventsIn(response.text) : [parseJson(response.text)].flat();
  const answer = answerTo(id, messages);
  return isRecord(answer) ? answer : null;
}

function requestFor(url: string, token: string | null, session: Session | null, message: unknown, waitFor?: number): ConnectorRequest {
  return {
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": session?.protocol ?? PROTOCOL_VERSION,
      ...(session?.id ? { "mcp-session-id": session.id } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(message),
    // A stream can stay open long after it has said what was asked.
    ...(waitFor === undefined ? {} : { enoughWhen: (text: string) => answerTo(waitFor, eventsIn(text)) !== undefined }),
  };
}

const initializeMessage = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Buddy", version: "1" } },
};

const looksInitialized = (answer: Record<string, unknown> | null): answer is { result: { protocolVersion: string } } =>
  isRecord(answer?.result) && typeof answer.result.protocolVersion === "string";

/** What a connector says to someone who walks up with no login. */
export async function askWithoutLogin(send: Send, url: string): Promise<FirstAnswer> {
  const response = await send(requestFor(url, null, null, initializeMessage, 1));
  if (response.status === 401) return { kind: "needs_login", wwwAuthenticate: response.headers["www-authenticate"] ?? null };
  if (response.status === 403) return { kind: "forbidden" };
  if (response.status !== 200) return { kind: "not_a_connector" };
  return looksInitialized(findAnswer(1, response)) ? { kind: "open" } : { kind: "not_a_connector" };
}

function toTool(raw: unknown): McpTool | null {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name === "" || !isRecord(raw.inputSchema)) return null;
  return {
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : null,
    inputSchema: raw.inputSchema,
    annotations: isRecord(raw.annotations) ? raw.annotations : null,
  };
}

/** Throws if the connector can't be reached at all, which is no more than a read that failed. */
export async function listTools(send: Send, url: string, token: string | null): Promise<ToolList> {
  const refusal = (status: number): ToolList | null => (status === 401 ? { kind: "needs_login" } : status === 403 ? { kind: "forbidden" } : null);

  const started = await send(requestFor(url, token, null, initializeMessage, 1));
  const refusedAtTheDoor = refusal(started.status);
  if (refusedAtTheDoor) return refusedAtTheDoor;
  const greeting = started.status === 200 ? findAnswer(1, started) : null;
  if (!looksInitialized(greeting)) return { kind: "failed" };
  const session: Session = { id: started.headers["mcp-session-id"] ?? null, protocol: greeting.result.protocolVersion };

  await send(requestFor(url, token, session, { jsonrpc: "2.0", method: "notifications/initialized" }));

  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MOST_PAGES; page++) {
    const id = page + 2;
    const response = await send(requestFor(url, token, session, { jsonrpc: "2.0", id, method: "tools/list", params: cursor ? { cursor } : {} }, id));
    const refused = refusal(response.status);
    if (refused) return refused;
    const answer = response.status === 200 ? findAnswer(id, response) : null;
    if (!isRecord(answer?.result) || !Array.isArray(answer.result.tools)) return { kind: "failed" };
    tools.push(...answer.result.tools.flatMap((raw) => toTool(raw) ?? []));
    if (tools.length > MOST_TOOLS) return { kind: "failed" };
    if (typeof answer.result.nextCursor !== "string" || answer.result.nextCursor === "") return { kind: "tools", tools };
    cursor = answer.result.nextCursor;
  }
  return { kind: "failed" };
}

/**
 * A Read Permission only lets Buddy read (ADR 0001), so this denies by default. A tool gets through only if the server
 * says outright that it only reads. No mark means no, and so does any mark but true. A tool that's also marked as
 * destructive contradicts itself, and that's no too. The marks are the service's own word: Buddy can't check them, which
 * is why only a connector on the service's own domain gets this far.
 */
export function readOnlyTools(tools: McpTool[]): McpTool[] {
  return tools.filter(({ annotations }) => annotations?.readOnlyHint === true && annotations.destructiveHint !== true);
}
