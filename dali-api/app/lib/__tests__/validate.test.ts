import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseForm, parseJson, readForm } from "~/lib/validate";

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

function formRequest(body: URLSearchParams | FormData, headers: Record<string, string> = {}) {
  return new Request("http://localhost/test", { method: "POST", body, headers });
}

describe("readForm", () => {
  const FormSchema = z.object({
    name: z.string().min(1, "Name is required"),
    tags: z.array(z.string()).optional(),
    ids: z.array(z.string()).default([]),
  });

  it("reads declared array fields with getAll and the rest with get", () => {
    const form = new FormData();
    form.append("name", "Ada");
    form.append("tags", "a");
    form.append("tags", "b");
    expect(readForm(form, FormSchema)).toEqual({ ok: true, data: { name: "Ada", tags: ["a", "b"], ids: [] } });
  });

  it("finds array fields inside a discriminated union", () => {
    const Union = z.discriminatedUnion("intent", [
      z.object({ intent: z.literal("one"), ids: z.array(z.string()) }),
      z.object({ intent: z.literal("two") }),
    ]);
    const form = new FormData();
    form.append("intent", "one");
    form.append("ids", "x");
    form.append("ids", "y");
    expect(readForm(form, Union)).toEqual({ ok: true, data: { intent: "one", ids: ["x", "y"] } });
  });

  it("returns the first issue message", () => {
    const form = new FormData();
    form.append("name", "");
    expect(readForm(form, FormSchema)).toMatchObject({ ok: false, error: "Name is required" });
  });

  it("treats a missing key as undefined", () => {
    expect(readForm(new FormData(), FormSchema)).toMatchObject({ ok: false });
    expect(readForm(new FormData(), z.object({ n: z.string().default("x") }))).toEqual({ ok: true, data: { n: "x" } });
  });
});

describe("parseForm", () => {
  const FormSchema = z.object({ name: z.string().min(1, "Name is required"), tags: z.array(z.string()).optional() });

  it("parses a urlencoded request including repeated fields", async () => {
    const body = new URLSearchParams([["name", "Ada"], ["tags", "a"], ["tags", "b"]]);
    const req = formRequest(body, { "Content-Type": "application/x-www-form-urlencoded" });
    expect(await parseForm(req, FormSchema)).toEqual({ name: "Ada", tags: ["a", "b"] });
  });

  it("accepts FormData that an action has already read", async () => {
    const form = new FormData();
    form.append("name", "Ada");
    expect(await parseForm(form, FormSchema)).toEqual({ name: "Ada" });
  });

  it("returns a 400 whose error is the first issue message", async () => {
    const form = new FormData();
    form.append("name", "");
    const res = (await parseForm(form, FormSchema)) as Response;
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Name is required");
    expect(body.details.fieldErrors.name).toEqual(["Name is required"]);
  });

  it("rejects an unsupported content type", async () => {
    const req = new Request("http://localhost/test", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    const res = (await parseForm(req, FormSchema)) as Response;
    expect(res.status).toBe(400);
    expect((await res.json()).details).toBe("Unsupported content type");
  });
});
