const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MB

/**
 * Size-limited replacement for `request.json()`.
 * Returns the parsed body on success, or a 413 Response if the body exceeds `maxBytes`.
 */
export async function safeJson<T>(
  request: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<T | Response> {
  // Fast-reject via Content-Length header when available.
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return new Response(JSON.stringify({ error: "Request body too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Stream-read with byte counting for cases where Content-Length is absent or untrusted.
  const reader = request.body?.getReader();
  if (!reader) {
    return new Response(JSON.stringify({ error: "Missing request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      reader.cancel();
      return new Response(JSON.stringify({ error: "Request body too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(merged)) as T;
}
