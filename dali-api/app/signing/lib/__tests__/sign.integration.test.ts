import { describe, expect, it, vi } from "vitest";

const { sendSignatureReceipt } = vi.hoisted(() => ({ sendSignatureReceipt: vi.fn(async () => undefined) }));
vi.mock("../notify.server", () => ({ sendSignatureReceipt }));

import { prisma } from "~/lib/db.server";
import { recordSignature } from "../sign.server";

const request = new Request("http://localhost/sign", { headers: { "user-agent": "vitest" } });

async function seed() {
  const author = await prisma.user.create({ data: { firstName: "Grace", lastName: "Hopper" } });
  const ada = await prisma.user.create({ data: { firstName: "Ada", lastName: "Lovelace" } });
  const alan = await prisma.user.create({ data: { firstName: "Alan", lastName: "Turing" } });
  const document = await prisma.signingDocument.create({ data: { name: "Member agreement", slug: "member-agreement" } });
  const version = await prisma.signingDocumentVersion.create({
    data: {
      documentId: document.id,
      versionNumber: 1,
      body: [],
      roles: ["member", "supervisor"],
      publishedAt: new Date("2026-09-01"),
      createdById: author.id,
    },
  });
  const binding = await prisma.signingBinding.create({
    data: { documentId: document.id, versionId: version.id, scopeKey: "lab" },
  });
  return { ada, alan, binding, version };
}

describe("recordSignature (real database)", () => {
  it("writes one signature row pinned to the binding's version, with a typed name fallback", async () => {
    const s = await seed();

    const res = await recordSignature({ bindingId: s.binding.id, signerUserId: s.ada.id, fieldValues: {}, request });

    expect(res).toEqual({ ok: true });
    const rows = await prisma.signingSignature.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bindingId: s.binding.id,
      versionId: s.version.id,
      signerUserId: s.ada.id,
      roleKey: "member",
      typedName: "Ada Lovelace",
      userAgent: "vitest",
    });
  });

  it("concurrent signs by the same signer and role leave exactly one row", async () => {
    const s = await seed();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        recordSignature({ bindingId: s.binding.id, signerUserId: s.ada.id, fieldValues: {}, request }),
      ),
    );

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await prisma.signingSignature.count({ where: { signerUserId: s.ada.id, roleKey: "member" } })).toBe(1);
  });

  it("signing again refreshes the existing row rather than adding another", async () => {
    const s = await seed();
    await recordSignature({ bindingId: s.binding.id, signerUserId: s.ada.id, fieldValues: {}, request });
    const first = await prisma.signingSignature.findFirstOrThrow();

    await recordSignature({ bindingId: s.binding.id, signerUserId: s.ada.id, fieldValues: { note: "x" }, request });

    const rows = await prisma.signingSignature.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].fieldValues).toEqual({ note: "x" });
  });

  it("different roles for one signer, and different signers, each get their own row", async () => {
    const s = await seed();

    await Promise.all([
      recordSignature({ bindingId: s.binding.id, signerUserId: s.ada.id, fieldValues: {}, request }),
      recordSignature({ bindingId: s.binding.id, signerUserId: s.ada.id, roleKey: "mentee", fieldValues: {}, request }),
      recordSignature({ bindingId: s.binding.id, signerUserId: s.alan.id, fieldValues: {}, request }),
    ]);

    const rows = await prisma.signingSignature.findMany({ orderBy: [{ signerUserId: "asc" }, { roleKey: "asc" }] });
    expect(rows.map((r) => `${r.signerUserId === s.ada.id ? "ada" : "alan"}:${r.roleKey}`).sort()).toEqual([
      "ada:member",
      "ada:mentee",
      "alan:member",
    ]);
  });

  it("the database itself rejects a second row for the same binding, signer and role", async () => {
    const s = await seed();
    const data = {
      bindingId: s.binding.id,
      versionId: s.version.id,
      signerUserId: s.ada.id,
      roleKey: "member",
      typedName: "Ada Lovelace",
      fieldValues: {},
    };
    await prisma.signingSignature.create({ data });

    await expect(prisma.signingSignature.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });
});
