import { describe, it, expect, beforeEach, vi } from "vitest";

// getSignedCopyBody composes a co-signed copy: the signer's own frozen snapshot
// with the COUNTERPART party's captured signature overlaid, so a mentor's
// downloaded copy shows the mentee's countersignature (and vice versa) instead
// of a permanently-blank second signature line. bakeSigningBody is the real
// pure helper; only prisma is mocked.

const h = vi.hoisted(() => ({
  binding: null as unknown,
  mineSig: null as null | { frozenBody: unknown },
  pairs: [] as { menteeUserId?: string; mentorUserId?: string }[],
  counterSig: null as null | { fieldValues: unknown },
}));

vi.mock("~/lib/db", () => ({
  prisma: {
    signingBinding: { findUnique: vi.fn(async () => h.binding) },
    signingSignature: {
      findUnique: vi.fn(async () => h.mineSig),
      findFirst: vi.fn(async () => h.counterSig),
    },
    mentorshipPair: { findMany: vi.fn(async () => h.pairs) },
  },
}));

import { getSignedCopyBody } from "~/signing/lib/state.server";

// A body with a filled member signature and an empty mentee signature — the
// shape of a mentor's frozen copy before the mentee has countersigned.
function mentorFrozenBody() {
  return [
    {
      type: "paragraph",
      content: [
        { type: "signatureField", props: { fieldId: "f-mentor", role: "member", value: "Alice Mentor" } },
        { type: "signatureField", props: { fieldId: "f-mentee", role: "mentee", value: "" } },
      ],
    },
  ];
}

function fieldValue(body: unknown, fieldId: string): string {
  const inline = (body as { content: { props?: { fieldId?: string; value?: string } }[] }[])[0].content.find(
    (n) => n.props?.fieldId === fieldId,
  );
  return inline?.props?.value ?? "";
}

beforeEach(() => {
  h.binding = { versionId: "v1", termId: "t1", version: { body: mentorFrozenBody() } };
  h.mineSig = { frozenBody: mentorFrozenBody() };
  h.pairs = [{ menteeUserId: "bob" }];
  h.counterSig = { fieldValues: { "f-mentee": "Bob Mentee" } };
});

describe("getSignedCopyBody", () => {
  it("overlays the mentee's countersignature onto the mentor's copy", async () => {
    const body = await getSignedCopyBody("b1", "alice", "member");
    expect(fieldValue(body, "f-mentor")).toBe("Alice Mentor"); // signer's own field untouched
    expect(fieldValue(body, "f-mentee")).toBe("Bob Mentee"); // counterpart filled in
  });

  it("leaves the counterpart line blank when the other party hasn't signed", async () => {
    h.counterSig = null;
    const body = await getSignedCopyBody("b1", "alice", "member");
    expect(fieldValue(body, "f-mentee")).toBe("");
  });

  it("returns the signer's snapshot unchanged when there is no mentorship pairing", async () => {
    h.pairs = [];
    const body = await getSignedCopyBody("b1", "alice", "member");
    expect(fieldValue(body, "f-mentee")).toBe("");
  });

  it("returns null when the binding is gone", async () => {
    h.binding = null;
    expect(await getSignedCopyBody("missing", "alice", "member")).toBeNull();
  });
});
