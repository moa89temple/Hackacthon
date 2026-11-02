import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { PageBlocked, type BuddysBrowser, type FormSubmission, type FormToSubmit, type PageReading } from "../../src/buddys-browser.ts";
import type { ArmableGuard, RequestGuard } from "../../src/network-guard.ts";

export type RecordedAction =
  | { type: "show"; url: string }
  | { type: "read"; url: string }
  | { type: "submit"; form: FormToSubmit }
  | { type: "clear-screen" }
  | { type: "forget-login"; hosts: string[] };

export interface SavedPage {
  title: string;
  text: string;
  accessibilitySnapshot: string;
  /** Where the page ends up, for pages that redirect. Defaults to the page's own address. */
  finalUrl?: string;
  html?: string;
  /** What the page loads for itself, which the guard is asked about in turn. */
  alsoRequests?: { url: string; method: string }[];
}

/**
 * Serves saved pages and records every action. Its live view is a small server standing in
 * for the container's.
 */
export class RecordingBrowser implements BuddysBrowser {
  readonly actions: RecordedAction[] = [];
  readonly savedPages = new Map<string, SavedPage>();
  readonly liveView = { host: "127.0.0.1", port: 0 };
  /** When set, the browser behaves as if the container were stopped. */
  unreachable = false;
  /** When set, reads wait on this before finishing. */
  holdReads: Promise<void> | undefined;
  /** When set, putting a page on the screen waits on this, and fails if it rejects. */
  holdShows: Promise<void> | undefined;
  /** When set, submitting a form waits on this. */
  holdSubmits: Promise<void> | undefined;
  /** When set, decides what submitting a form does. By default it goes as a real form would. */
  nextSubmit: ((form: FormToSubmit, guard: ArmableGuard) => Promise<FormSubmission>) | undefined;

  #liveViewServer: Server | undefined;
  readonly #liveViewSockets = new Set<Socket>();

  async startLiveView(): Promise<void> {
    this.#liveViewServer = createServer((socket) => {
      this.#liveViewSockets.add(socket);
      socket.on("close", () => this.#liveViewSockets.delete(socket));
      socket.on("error", () => {});
      socket.once("data", (first) => {
        const request = first.toString();
        if (request.includes("Upgrade: websocket")) {
          // The live view itself: echoes everything, starting with the upgrade request.
          socket.write(first);
          socket.pipe(socket);
        } else {
          // The live view's own files: says which path and host it was asked for.
          const path = request.split(" ")[1];
          const body = `served ${path} for ${/^host: (.*)$/im.exec(request)?.[1]?.trim()}`;
          socket.end(`HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body}`);
        }
      });
    });
    await new Promise<void>((resolve) => this.#liveViewServer!.listen(0, "127.0.0.1", resolve));
    this.liveView.port = (this.#liveViewServer.address() as AddressInfo).port;
  }

  async stopLiveView(): Promise<void> {
    for (const socket of this.#liveViewSockets) socket.destroy();
    await new Promise((resolve) => this.#liveViewServer?.close(resolve));
  }

  get liveViewConnections(): number {
    return this.#liveViewSockets.size;
  }

  async show(url: string): Promise<void> {
    this.#failIfUnreachable();
    this.actions.push({ type: "show", url });
    await this.holdShows;
  }

  async read(url: string, guard: RequestGuard): Promise<PageReading> {
    this.#failIfUnreachable();
    this.actions.push({ type: "read", url });
    await this.holdReads;
    const page = this.savedPages.get(url);
    if (!page) throw new Error(`RecordingBrowser: no saved page for ${url}`);
    // What the guard does to a real browser's redirect.
    if (page.finalUrl) {
      const decision = guard.check({ url: page.finalUrl, method: "GET", opensPage: true });
      if (!decision.allowed) throw new PageBlocked(decision.why);
    }
    for (const request of page.alsoRequests ?? []) guard.check({ ...request, opensPage: false });
    return {
      url: page.finalUrl ?? url,
      title: page.title,
      text: page.text,
      accessibilitySnapshot: page.accessibilitySnapshot,
      html: page.html ?? "",
    };
  }

  async submitForm(form: FormToSubmit, guard: ArmableGuard): Promise<FormSubmission> {
    this.#failIfUnreachable();
    this.actions.push({ type: "submit", form });
    await this.holdSubmits;
    if (this.nextSubmit) return this.nextSubmit(form, guard);
    const fields = form.fields.map(({ name, value }): [string, string] => [name, value]);
    guard.arm({ method: "POST", url: form.actionUrl, fields });
    const body = new URLSearchParams(fields).toString();
    const decision = guard.check({
      url: form.actionUrl,
      method: "POST",
      opensPage: false,
      body,
      contentType: "application/x-www-form-urlencoded",
    });
    return decision.allowed ? { outcome: "submitted", status: 200 } : { outcome: "not_sent", why: decision.why };
  }

  async clearScreen(): Promise<void> {
    this.#failIfUnreachable();
    this.actions.push({ type: "clear-screen" });
  }

  async forgetLogin(hosts: string[]): Promise<void> {
    this.#failIfUnreachable();
    this.actions.push({ type: "forget-login", hosts });
  }

  #failIfUnreachable(): void {
    if (this.unreachable) throw new Error("RecordingBrowser: the container is stopped");
  }
}
