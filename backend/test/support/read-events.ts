/** Reads the backend's event stream as the events arrive. */
export async function* readEvents(response: Response): AsyncGenerator<any> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of response.body!) {
    buffer += decoder.decode(bytes, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      yield JSON.parse(frame.replace(/^data: /, ""));
    }
  }
}
