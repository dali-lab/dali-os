import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { isPrivateAddress } from "~/lib/pdf/render-guard.server";

export const publicOnlyLookup: typeof dnsLookup = ((host: string, options: unknown, cb: unknown) => {
  const callback = (typeof options === "function" ? options : cb) as (err: Error | null, address?: unknown, family?: number) => void;
  const opts = typeof options === "function" ? {} : (options as { all?: boolean });
  dnsLookup(host, { all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error("Blocked address"));
    }
    if (opts.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}) as typeof dnsLookup;

export type PinnedRequestOptions = {
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
};

export function pinnedRequest(url: URL, opts: PinnedRequestOptions): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(url, { lookup: publicOnlyLookup, timeout: opts.timeoutMs, headers: opts.headers }, resolve);
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
    const { signal } = opts;
    if (!signal) return;
    const abort = () => {
      req.destroy();
      reject(new Error("Timed out"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function pinnedFetch(url: URL, opts: PinnedRequestOptions): Promise<Response> {
  const res = await pinnedRequest(url, opts);
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const status = res.statusCode ?? 0;
  const hasBody = status >= 200 && ![204, 205, 304].includes(status);
  if (!hasBody) {
    res.resume();
    return new Response(null, { status, headers });
  }
  return new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers });
}
