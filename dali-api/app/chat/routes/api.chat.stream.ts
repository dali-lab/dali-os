import type { Route } from "./+types/api.chat.stream";
import { requireMobileUser } from "~/lib/mobile-auth.server";
import { subscribeToChat } from "~/chat/lib/chat-stream.server";

const KEEPALIVE_INTERVAL_MS = 25_000;
const SYNC_INTERVAL_MS = 60_000;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireMobileUser(request);
  if (!auth.ok) return auth.response;

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let sync: ReturnType<typeof setInterval> | undefined;
  const teardown = () => {
    unsubscribe();
    if (keepalive) clearInterval(keepalive);
    if (sync) clearInterval(sync);
  };

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // closed; cancel() tears down
        }
      };
      write(": connected\n\n");
      unsubscribe = subscribeToChat(auth.userId, (event, conversationId) =>
        write(`event: ${event}\ndata: ${JSON.stringify({ conversationId })}\n\n`),
      );
      keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_INTERVAL_MS);
      sync = setInterval(() => write("event: sync\ndata: 1\n\n"), SYNC_INTERVAL_MS);
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
