import { subscribe, type BusEvent } from "~/lib/realtime-bus.server";

// The keep-alive comment stops proxies from dropping an idle stream without
// waking the client. For a surface whose every write publishes, `sync` only
// covers a publish lost while Redis was unreachable, so it can be slow; a
// surface that also shows state no write publishes passes a shorter one.
export const KEEPALIVE_INTERVAL_MS = 25_000;
export const DEFAULT_SYNC_INTERVAL_MS = 5 * 60_000;

/**
 * An SSE response that emits `change` whenever any of `topics` is published
 * and `sync` every `syncMs`. A reconnecting EventSource sends
 * Last-Event-ID (set by the `id:` line on connect); it gets an immediate
 * `sync`, since publishes while it was disconnected never reached it.
 */
export function busEventStream(
  request: Request,
  topics: string[],
  { syncMs = DEFAULT_SYNC_INTERVAL_MS }: { syncMs?: number } = {},
): Response {
  const encoder = new TextEncoder();
  const unsubscribes: (() => void)[] = [];
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let sync: ReturnType<typeof setInterval> | undefined;
  const reconnected = request.headers.has("last-event-id");

  const teardown = () => {
    for (const off of unsubscribes.splice(0)) off();
    if (keepalive) clearInterval(keepalive);
    if (sync) clearInterval(sync);
  };

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller closed (client gone); cancel() tears down.
        }
      };
      const send = (event: BusEvent) => write(`event: ${event}\ndata: 1\n\n`);

      write(": connected\nid: 1\n\n");
      if (reconnected) send("sync");

      for (const topic of new Set(topics)) unsubscribes.push(subscribe(topic, send));
      keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_INTERVAL_MS);
      sync = setInterval(() => send("sync"), syncMs);

      request.signal.addEventListener("abort", () => {
        teardown();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel: teardown,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
