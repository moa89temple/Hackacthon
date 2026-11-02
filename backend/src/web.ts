export interface WebResponse {
  status: number;
  text: string;
}

/** Fetching from the web. Tests use saved copies instead. See test/support/saved-web.ts. */
export interface Web {
  /** Throws if there's no answer. The error never says which address was asked for. */
  get(url: string): Promise<WebResponse>;
}

const TIMEOUT_MS = 30_000;
/** Years of calendar history can run to several megabytes. This stops a runaway answer. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Sends no cookies or login. It won't follow a redirect, because the address it was given has
 * already been checked and the one it's sent to hasn't. A failure's own error is left behind, so
 * that a secret address can't end up in the logs by way of it.
 */
export function realWeb(): Web {
  return {
    async get(url) {
      try {
        const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
        return { status: response.status, text: await readLimited(response) };
      } catch (error) {
        throw new Error(`The web request failed: ${error instanceof Error ? error.name : "unknown error"}`);
      }
    },
  };
}

async function readLimited(response: Response): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new RangeError("Too large");
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
