// One comment SSE stream per page, shared by every listener on it, so a slide with several
// text boxes and the comments panel hold one connection between them.

interface Channel {
  listeners: Set<() => void>;
  source: EventSource | null;
  retry: ReturnType<typeof setTimeout> | null;
}

const channels = new Map<string, Channel>();
const RETRY_MS = 5000;

function open(pageId: string, channel: Channel): void {
  if (typeof EventSource === "undefined") return;
  const source = new EventSource(`/api/comments/${encodeURIComponent(pageId)}/stream`, { withCredentials: true });
  channel.source = source;
  const fire = () => channel.listeners.forEach((cb) => cb());
  source.addEventListener("change", fire);
  source.addEventListener("sync", fire);
  source.onerror = () => {
    if (source.readyState !== EventSource.CLOSED || channel.source !== source) return;
    channel.source = null;
    channel.retry = setTimeout(() => {
      channel.retry = null;
      if (channel.listeners.size > 0) open(pageId, channel);
    }, RETRY_MS);
  };
}

export function subscribeCommentNudges(pageId: string, listener: () => void): () => void {
  let channel = channels.get(pageId);
  if (!channel) {
    channel = { listeners: new Set(), source: null, retry: null };
    channels.set(pageId, channel);
  }
  channel.listeners.add(listener);
  if (!channel.source && channel.retry === null) open(pageId, channel);
  const joined = channel;
  return () => {
    joined.listeners.delete(listener);
    if (joined.listeners.size > 0) return;
    joined.source?.close();
    if (joined.retry !== null) clearTimeout(joined.retry);
    channels.delete(pageId);
  };
}
