import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseJson } from "~/lib/validate";

const Schema = z.object({
  name: z.string().min(1).max(10),
  count: z.number().int().min(0).max(100),
});

function makeRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/test", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("parseJson", () => {
  it("returns parsed data when the body validates", async () => {
    const req = makeRequest(JSON.stringify({ name: "ok", count: 3 }));
    const result = await parseJson(req, Schema);
    expect(result).toEqual({ name: "ok", count: 3 });
  });

  it("returns a 400 with field details when the body fails the schema", async () => {
    const req = makeRequest(JSON.stringify({ name: "", count: 999 }));
    const result = await parseJson(req, Schema);
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");
    expect(body.details.fieldErrors.name).toBeTruthy();
    expect(body.details.fieldErrors.count).toBeTruthy();
  });

  it("returns a 400 when the body is not valid JSON", async () => {
    const req = makeRequest("not-json");
    const result = await parseJson(req, Schema);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it("returns a 413 when the body exceeds maxBytes", async () => {
    const req = makeRequest(JSON.stringify({ name: "x".repeat(2000), count: 1 }));
    const result = await parseJson(req, Schema, 100);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });
});
