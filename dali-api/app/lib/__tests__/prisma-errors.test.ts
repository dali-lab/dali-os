import { describe, it, expect } from "vitest";
import {
  isForeignKeyViolation,
  isRecordNotFound,
  isUniqueViolation,
  uniqueViolationFields,
} from "../prisma-errors";

const p2002 = (meta?: Record<string, unknown>) => Object.assign(new Error("x"), { code: "P2002", meta });

describe("prisma-errors", () => {
  it("detects each code", () => {
    expect(isUniqueViolation(p2002())).toBe(true);
    expect(isUniqueViolation({ code: "P2025" })).toBe(false);
    expect(isRecordNotFound({ code: "P2025" })).toBe(true);
    expect(isRecordNotFound({ code: "P2002" })).toBe(false);
    expect(isForeignKeyViolation({ code: "P2003" })).toBe(true);
    expect(isForeignKeyViolation({ code: "P2002" })).toBe(false);
  });

  it("is false for non-objects and missing codes", () => {
    for (const v of [null, undefined, "P2002", 42, {}, { code: 2002 }]) {
      expect(isUniqueViolation(v)).toBe(false);
      expect(isRecordNotFound(v)).toBe(false);
      expect(isForeignKeyViolation(v)).toBe(false);
      expect(uniqueViolationFields(v)).toEqual([]);
    }
  });

  it("reads fields from an array or string target", () => {
    expect(uniqueViolationFields(p2002({ target: ["handle"] }))).toEqual(["handle"]);
    expect(uniqueViolationFields(p2002({ target: "User_netId_key" }))).toEqual(["User_netId_key"]);
  });

  it("reads fields from the driver adapter shape", () => {
    const err = p2002({ modelName: "User", driverAdapterError: { cause: { constraint: { fields: ["netId"] } } } });
    expect(uniqueViolationFields(err)).toEqual(["netId"]);
    expect(isUniqueViolation(err, "netId")).toBe(true);
  });

  it("reads the constraint index the pg adapter reports", () => {
    const err = p2002({
      modelName: "User",
      driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { index: "User_handle_key" } } },
    });
    expect(uniqueViolationFields(err)).toEqual(["User_handle_key"]);
    expect(isUniqueViolation(err, "handle")).toBe(true);
    expect(isUniqueViolation(err, "netId")).toBe(false);
  });

  it("returns no fields when meta has none, and the field filter then fails", () => {
    expect(uniqueViolationFields(p2002())).toEqual([]);
    expect(isUniqueViolation(p2002(), "handle")).toBe(false);
  });

  it("filters by field", () => {
    const err = p2002({ target: ["handle"] });
    expect(isUniqueViolation(err, "handle")).toBe(true);
    expect(isUniqueViolation(err, "netId")).toBe(false);
  });
});
