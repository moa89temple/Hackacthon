import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendHarness } from "./support/backend-harness.ts";

/**
 * The Claude API refuses a request whose strict tools go over these, and every reply then fails. A scripted
 * Claude can't see that, so this holds the published limits. The API also has an unpublished limit on the
 * grammar they compile to, which only `npm run smoke` can catch: run it after adding a tool.
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 */
const MOST_STRICT_TOOLS = 20;
const MOST_OPTIONAL_PARAMETERS = 24;
const MOST_UNION_PARAMETERS = 16;

function count(schema: any): { optional: number; unions: number } {
  const total = { optional: 0, unions: 0 };
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    for (const [name, property] of Object.entries<any>(node.properties ?? {})) {
      if (!(node.required ?? []).includes(name)) total.optional += 1;
      if (Array.isArray(property.type) || property.anyOf) total.unions += 1;
      walk(property);
    }
    walk(node.items);
  };
  walk(schema);
  return total;
}

describe("the tools Claude is given", () => {
  let backend: BackendHarness;

  beforeEach(async () => {
    backend = await BackendHarness.start();
  });

  afterEach(async () => {
    await backend.stop();
  });

  it("stay within the API's published limits on strict tools", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });
    await backend.sendAndCollect("Hello");

    const strict = (backend.claude.requests[0]!.tools as any[]).filter((tool) => tool.strict === true);
    const counts = strict.map((tool) => count(tool.input_schema));

    expect(strict.length).toBeLessThanOrEqual(MOST_STRICT_TOOLS);
    expect(counts.reduce((sum, { optional }) => sum + optional, 0)).toBeLessThanOrEqual(MOST_OPTIONAL_PARAMETERS);
    expect(counts.reduce((sum, { unions }) => sum + unions, 0)).toBeLessThanOrEqual(MOST_UNION_PARAMETERS);
  });

  it("leave out strict on the two with the biggest schemas, or the real API refuses them all", async () => {
    backend.claude.willReply({ chunks: ["Hi."] });
    await backend.sendAndCollect("Hello");

    const named = (name: string) => (backend.claude.requests[0]!.tools as any[]).find((tool) => tool.name === name);
    expect(named("propose_roadmap").strict).toBeUndefined();
    expect(named("suggest_roadmap_change").strict).toBeUndefined();
  });
});
