import { describe, expect, it } from "vitest";
import {
  memberColumnKey,
  parseResponseColumns,
  responseColumnId,
  validResponseColumns,
} from "../response-columns";

describe("response column ids", () => {
  it("round-trips a member column", () => {
    expect(memberColumnKey(responseColumnId("termsInLab"))).toBe("termsInLab");
  });

  it("reads anything else as not a member column", () => {
    expect(memberColumnKey("member:salary")).toBeNull();
    expect(memberColumnKey("q1")).toBeNull();
  });
});

describe("parseResponseColumns", () => {
  it("keeps saved order, drops unknown ids and repeats", () => {
    expect(
      parseResponseColumns(["member:termsInLab", "member:gone", 4, "member:hiredRoles", "member:termsInLab"]),
    ).toEqual(["termsInLab", "hiredRoles"]);
  });

  it("is empty for a form with nothing saved", () => {
    expect(parseResponseColumns(null)).toEqual([]);
    expect(parseResponseColumns({ member: ["termsInLab"] })).toEqual([]);
  });
});

describe("validResponseColumns", () => {
  it("accepts known ids and an empty list", () => {
    expect(validResponseColumns(["member:currentRole"])).toEqual(["currentRole"]);
    expect(validResponseColumns([])).toEqual([]);
  });

  it("rejects the whole list when any id is unknown", () => {
    expect(validResponseColumns(["member:currentRole", "member:salary"])).toBeNull();
    expect(validResponseColumns("member:currentRole")).toBeNull();
  });
});
