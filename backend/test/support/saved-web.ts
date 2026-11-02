import type { Web, WebResponse } from "../../src/web.ts";

/** Serves saved copies of what's on the web, and records every address it was asked for. */
export class SavedWeb implements Web {
  readonly requests: string[] = [];
  readonly saved = new Map<string, WebResponse>();
  /** When set, the web behaves as if the laptop had no connection. */
  unreachable = false;
  /** When set, requests wait on this before answering. */
  hold: Promise<void> | undefined;

  save(url: string, text: string, status = 200): void {
    this.saved.set(url, { status, text });
  }

  async get(url: string): Promise<WebResponse> {
    this.requests.push(url);
    const answer = this.saved.get(url);
    await this.hold;
    if (this.unreachable) throw new Error(`SavedWeb: no connection, while asking for ${url}`);
    return answer ?? { status: 404, text: "Not found" };
  }
}
