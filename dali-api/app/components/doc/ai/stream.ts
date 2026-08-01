// SSE streaming client for /api/ai/doc.
// parseSseEvents is extracted as a pure function so it can be unit-tested.

export interface SseEvent {
  data: string;
}

/**
 * Parse complete SSE events from a text buffer.
 * Returns {events, rest} where rest is the incomplete tail not yet terminated by \n\n.
 * Each event.data is the raw data payload string after the "data: " prefix.
 * Handles split-across-chunks lines correctly.
 */
export function parseSseEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split("\n\n");
  // The last element is either empty (trailing \n\n) or an incomplete block.
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) {
        events.push({ data: line.slice(6) });
      }
    }
  }
  return { events, rest };
}

export interface StreamAiOptions {
  instruction: string;
  history?: { role: "user" | "assistant"; content: string }[];
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}

/**
 * Fetch /api/ai/doc with stream:true and drive SSE callbacks.
 * Non-200 responses before the stream starts are handled as errors.
 * The server may fall back to a single-delta response — that is transparent here.
 */
export async function streamAi(opts: StreamAiOptions): Promise<void> {
  const { instruction, history, signal, onDelta, onDone, onError } = opts;

  let response: Response;
  try {
    response = await fetch("/api/ai/doc", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction, history, stream: true }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    onError("Connection failed. Please try again.");
    return;
  }

  if (!response.ok) {
    if (signal.aborted) return;
    let msg = "AI request failed. Please try again.";
    try {
      const body = await response.json() as { aiEnabled?: false; error?: string };
      if (body.aiEnabled === false) msg = "AI is not configured on this server.";
      else if (body.error) msg = body.error;
    } catch { /* use default msg */ }
    onError(msg);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError("AI response body unavailable.");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseEvents(buffer);
      buffer = rest;
      for (const event of events) {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch { continue; }
        if (typeof payload.delta === "string") onDelta(payload.delta);
        else if (payload.done === true) { onDone(); return; }
        else if (typeof payload.error === "string") { onError(payload.error); return; }
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* ignore */ }
  }

  if (!signal.aborted) {
    // Stream ended without done event — treat as done.
    onDone();
  }
}
