/**
 * A minimal SSE reader for the browser side of `/api/voice/turn`.
 *
 * `EventSource` is not usable here: it is GET-only, and the turn route is a POST
 * carrying the transcript. So the adapter reads `response.body` itself and this
 * module does the framing — deliberately client-safe (no `server-only`, no env,
 * no Node APIs) so it can be imported from `adapters/voice/ai.ts`.
 *
 * A malformed frame is skipped rather than thrown: half a call is still a call,
 * and the adapter's own timeout/`ended` handling is what actually terminates it.
 */

export interface ParsedSseEvent {
  readonly event: string;
  readonly data: unknown;
}

/**
 * Yields one parsed event per SSE frame.
 *
 * `signal` is honoured between frames — the reader is cancelled so the fetch is
 * torn down rather than left holding a serverless function open.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ParsedSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        if (signal?.aborted) return;
        boundary = buffer.indexOf("\n\n");
      }
    }

    const trailing = parseFrame(buffer);
    if (trailing) yield trailing;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function parseFrame(frame: string): ParsedSseEvent | null {
  const lines = frame.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(":") || line.trim() === "") continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0) return null;

  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}
