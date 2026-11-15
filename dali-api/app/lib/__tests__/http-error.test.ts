import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/cors", () => ({
  withCors: (req: Request, res: Response) => {
    if (req.headers.get("Origin")) res.headers.set("Access-Control-Allow-Origin", "x");
    return res;
  },
}));

import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  isHttpError,
} from "../http-error";
import { errorResponse, errorResult } from "../http-error.server";

describe("HttpError classes", () => {
  it.each([
    [new BadRequestError("a"), 400],
    [new ForbiddenError("a"), 403],
    [new NotFoundError("a"), 404],
    [new ConflictError("a"), 409],
    [new HttpError(422, "a"), 422],
  ])("carries its status", (err, status) => {
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.message).toBe("a");
  });

  it("isHttpError matches duck-typed objects and rejects the rest", () => {
    expect(isHttpError(new NotFoundError())).toBe(true);
    expect(isHttpError({ status: 404, message: "gone" })).toBe(true);
    expect(isHttpError({ status: "404", message: "gone" })).toBe(false);
    expect(isHttpError(new Error("x"))).toBe(false);
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError("nope")).toBe(false);
  });
});

describe("errorResponse", () => {
  it("returns exactly { error } with the status", async () => {
    const res = errorResponse(new ForbiddenError("No"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "No" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("applies CORS only when a request is passed", () => {
    const req = new Request("http://x.test/", { headers: { Origin: "http://o.test" } });
    expect(errorResponse(new NotFoundError("n"), req).headers.get("Access-Control-Allow-Origin")).toBe("x");
  });

  it("rethrows anything that is not an HttpError", () => {
    const boom = new Error("db down");
    expect(() => errorResponse(boom)).toThrow(boom);
  });
});

describe("errorResult", () => {
  it("returns { error }", () => {
    expect(errorResult(new BadRequestError("bad"))).toEqual({ error: "bad" });
  });

  it("rethrows non-HttpErrors", () => {
    expect(() => errorResult(new Error("x"))).toThrow("x");
  });
});
