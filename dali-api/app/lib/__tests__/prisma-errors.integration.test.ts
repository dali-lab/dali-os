import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { isUniqueViolation, uniqueViolationFields } from "../prisma-errors";

async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the write to fail");
}

describe("unique violations through the real client and adapter", () => {
  it("names handle when two users share a handle", async () => {
    await prisma.user.create({ data: { firstName: "Ada", lastName: "A", handle: "ada" } });
    const err = await caught(() => prisma.user.create({ data: { firstName: "Bea", lastName: "B", handle: "ada" } }));
    expect(isUniqueViolation(err)).toBe(true);
    expect(isUniqueViolation(err, "handle")).toBe(true);
    expect(isUniqueViolation(err, "netId")).toBe(false);
    expect(uniqueViolationFields(err).join(",")).toContain("handle");
  });

  it("names netId when two users share a netId", async () => {
    await prisma.user.create({ data: { firstName: "Ada", lastName: "A", netId: "f00aaaa" } });
    const err = await caught(() => prisma.user.create({ data: { firstName: "Bea", lastName: "B", netId: "f00aaaa" } }));
    expect(isUniqueViolation(err, "netId")).toBe(true);
    expect(isUniqueViolation(err, "handle")).toBe(false);
  });
});
