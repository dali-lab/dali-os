import { describe, it, expect } from "vitest";
import { HttpError, NotFoundError } from "~/lib/http-error";
import {
  mapToolError,
  McpError,
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
} from "../errors";

describe("mapToolError", () => {
  it.each([
    [403, -32003],
    [404, -32004],
    [400, -32602],
    [409, -32602],
    [422, -32602],
  ])("maps status %i to JSON-RPC code %i with the error's message", (status, code) => {
    expect(mapToolError(new McpError("boom", status))).toEqual({ code, message: "boom" });
  });

  it("maps any thrown object with a numeric status, not just McpError", () => {
    class LegacyError extends Error {
      status = 404;
    }
    expect(mapToolError(new LegacyError("gone"))).toEqual({ code: -32004, message: "gone" });
    expect(mapToolError({ status: 403, toString: () => "plain" })).toEqual({
      code: -32003,
      message: "plain",
    });
  });

  it.each([
    ["an error without a status", new Error("kaput")],
    ["a non-numeric status", Object.assign(new Error("x"), { status: "404" })],
    ["a string", "thrown"],
    ["null", null],
    ["undefined", undefined],
  ])("returns null for %s", (_label, err) => {
    expect(mapToolError(err)).toBeNull();
  });

  it("gives the shared error classes their codes", () => {
    expect(mapToolError(new McpNotFoundError())?.code).toBe(-32004);
    expect(mapToolError(new McpForbiddenError())?.code).toBe(-32003);
    expect(mapToolError(new McpInvalidError())?.code).toBe(-32602);
  });
});

describe("McpError and HttpError", () => {
  it("McpError is an HttpError with its name and status kept", () => {
    const err = new McpError("boom", 429);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.name).toBe("McpError");
    expect(err.status).toBe(429);
  });

  it("maps a shared HttpError subclass", () => {
    expect(mapToolError(new NotFoundError("x"))).toEqual({ code: -32004, message: "x" });
  });
});
