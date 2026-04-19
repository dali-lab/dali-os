import { describe, it, expect } from "vitest";
import { safeJson } from "~/lib/safe-json";

function makeRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/test", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("safeJson", () => {
  it("parses a valid JSON body", async () => {
    const req = makeRequest(JSON.stringify({ hello: "world" }));
    const result = await safeJson(req);
    expect(result).toEqual({ hello: "world" });
  });

  it("rejects when Content-Length exceeds the limit", async () => {
    const req = makeRequest("{}", { "Content-Length": "2000000" });
    const result = await safeJson(req, 1024);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("rejects when streamed body exceeds the limit", async () => {
    const largeBody = JSON.stringify({ data: "x".repeat(2000) });
    const req = makeRequest(largeBody);
    const result = await safeJson(req, 100);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("accepts a body exactly at the limit", async () => {
    const body = JSON.stringify({ ok: true });
    const req = makeRequest(body);
    const result = await safeJson(req, body.length);
    expect(result).toEqual({ ok: true });
  });
});
