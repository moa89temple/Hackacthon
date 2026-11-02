import type { BackendHarness } from "./backend-harness.ts";
import { toolUseBlock } from "./scripted-claude.ts";

/** What the app's calls to the Roadmap's routes do, for one harness. */
export function roadmapCalls(backend: BackendHarness) {
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${backend.url}${path}`, {
      method,
      headers: { ...backend.deviceHeaders, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    call,
    goals: async (): Promise<any[]> => ((await (await call("GET", "/goals")).json()) as { goals: any[] }).goals,
    addGoal: (text: unknown) => call("POST", "/goals", { text }),
    editGoal: (id: unknown, text: unknown) => call("PATCH", `/goals/${id}`, { text }),
    removeGoal: (id: unknown) => call("DELETE", `/goals/${id}`),
    roadmap: async (): Promise<any[]> => ((await (await call("GET", "/roadmap")).json()) as { milestones: any[] }).milestones,
    accept: (cardId: unknown) => call("POST", `/roadmap/cards/${cardId}/accept`),
    notNow: (cardId: unknown) => call("POST", `/roadmap/cards/${cardId}/not-now`),
    addMilestone: (milestone: unknown) => call("POST", "/roadmap/milestones", milestone),
    setDone: (id: unknown, done: unknown) => call("PATCH", `/roadmap/milestones/${id}`, { done }),
    removeMilestone: (id: unknown) => call("DELETE", `/roadmap/milestones/${id}`),
    reorder: (ids: unknown) => call("PUT", "/roadmap/order", { ids }),
  };
}

/** Claude calling one tool in a round of its turn. */
export const toolCall = (name: string, input: unknown) => ({ content: [toolUseBlock(name, input)], stopReason: "tool_use" as const });
