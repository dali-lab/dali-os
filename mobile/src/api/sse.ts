import { authHeaders, clientConfig } from './client';

export interface SseEvent {
  event: string;
  data: string;
}

const STALL_MS = 90_000;
const MAX_BACKOFF_MS = 30_000;

export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length || event !== 'message') events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

/** Keeps an SSE connection open over XMLHttpRequest (RN fetch can't stream), reconnecting with backoff. */
export function openEventStream(path: string, onEvent: (e: SseEvent) => void): () => void {
  let xhr: XMLHttpRequest | null = null;
  let closed = false;
  let backoff = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => xhr?.abort(), STALL_MS);
  };

  const scheduleReconnect = () => {
    if (closed) return;
    retryTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  function connect() {
    if (closed) return;
    const req = new XMLHttpRequest();
    xhr = req;
    let seen = 0;
    let buffer = '';
    req.open('GET', `${clientConfig().baseUrl}${path}`);
    for (const [k, v] of Object.entries({ ...authHeaders(), Accept: 'text/event-stream', 'Cache-Control': 'no-cache' })) {
      req.setRequestHeader(k, v);
    }
    req.onprogress = () => {
      if (req.status === 200) backoff = 1000;
      armStall();
      buffer += req.responseText.slice(seen);
      seen = req.responseText.length;
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      parsed.events.forEach(onEvent);
    };
    const end = () => {
      if (xhr !== req) return;
      xhr = null;
      if (stallTimer) clearTimeout(stallTimer);
      if (req.status === 401) clientConfig().onUnauthorized();
      else if (req.status !== 404) scheduleReconnect();
    };
    req.onerror = end;
    req.onabort = end;
    req.onload = end;
    armStall();
    req.send();
  }

  connect();
  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (stallTimer) clearTimeout(stallTimer);
    xhr?.abort();
    xhr = null;
  };
}
