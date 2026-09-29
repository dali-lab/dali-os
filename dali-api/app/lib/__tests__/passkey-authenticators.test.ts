import { describe, it, expect } from "vitest";
import { getAuthenticatorLabel } from "~/lib/passkey-authenticators";

describe("getAuthenticatorLabel", () => {
  it("maps a known AAGUID to its provider name", () => {
    expect(getAuthenticatorLabel("ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4")).toBe(
      "Google Password Manager",
    );
    expect(getAuthenticatorLabel("bada5566-a7aa-401f-bd96-45619a55120d")).toBe("1Password");
  });

  it("normalizes casing and surrounding whitespace", () => {
    expect(getAuthenticatorLabel("  EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4 ")).toBe(
      "Google Password Manager",
    );
  });

  it("returns null for the all-zero anonymous AAGUID (e.g. Apple attestation:none)", () => {
    expect(getAuthenticatorLabel("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns null for unknown, empty, or missing AAGUIDs", () => {
    expect(getAuthenticatorLabel("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBeNull();
    expect(getAuthenticatorLabel("")).toBeNull();
    expect(getAuthenticatorLabel(null)).toBeNull();
    expect(getAuthenticatorLabel(undefined)).toBeNull();
  });
});
