import { describe, it, expect, vi } from "vitest";

// Keep the prisma singleton from instantiating at import; this test only
// exercises the pure object-id parser.
vi.mock("~/lib/db", () => ({ prisma: {} }));

import { userIdFromGoogleObjectId } from "~/lib/wallet-google.server";

const ISSUER = "3388000000012345678";

describe("userIdFromGoogleObjectId", () => {
  it("extracts the userId from a member object id", () => {
    const userId = "clh1a2b3c4d5e6f7g8h9";
    const objectId = `${ISSUER}.member_${userId}_ab12cd34ef56`;
    expect(userIdFromGoogleObjectId(objectId, ISSUER)).toBe(userId);
  });

  it("returns null for a different issuer or non-member object", () => {
    expect(userIdFromGoogleObjectId(`${ISSUER}.dali_membership`, ISSUER)).toBeNull();
    expect(userIdFromGoogleObjectId(`999.member_u1_ab12cd34ef56`, ISSUER)).toBeNull();
  });

  it("returns null when there is no barcode-key suffix", () => {
    expect(userIdFromGoogleObjectId(`${ISSUER}.member_u1`, ISSUER)).toBeNull();
  });
});
