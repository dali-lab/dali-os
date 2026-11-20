import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/s3.server", () => ({ getUploadPost: vi.fn() }));

import { HttpError } from "~/lib/http-error";
import { errorResponse } from "~/lib/http-error.server";
import { ExpenseError, type ExpenseErrorCode } from "../errors";
import { ReceiptKeyError } from "../receipts.server";

describe("ExpenseError", () => {
  it.each<[ExpenseErrorCode, number]>([
    ["forbidden", 403],
    ["self_approval", 403],
    ["not_found", 404],
    ["invalid", 400],
    ["note_required", 400],
    ["incomplete", 400],
    ["conflict", 409],
    ["invalid_status", 409],
  ])("maps %s to %i", (code, status) => {
    const e = new ExpenseError(code, "msg");
    expect(e.status).toBe(status);
    expect(e.code).toBe(code);
    expect(e.message).toBe("msg");
  });

  it("is an HttpError the shared responder understands", async () => {
    const e = new ExpenseError("not_found", "Expense not found.");
    expect(e).toBeInstanceOf(HttpError);
    const res = errorResponse(e);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Expense not found." });
  });
});

describe("ReceiptKeyError", () => {
  it("is a 400 HttpError", () => {
    const e = new ReceiptKeyError("nope");
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(400);
    expect(e.name).toBe("ReceiptKeyError");
  });
});
