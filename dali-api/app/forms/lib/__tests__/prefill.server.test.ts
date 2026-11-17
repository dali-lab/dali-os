import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/reference-sources", () => ({ resolveReferenceOptions: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import { formFillers, resolvePrefill } from "~/forms/lib/prefill.server";
import type { Question } from "~/types";

const m = prisma as any;

const ask = (key: string, type: Question["type"], prefill?: string, data: Partial<Question["data"]> = {}): Question => ({
  key,
  type,
  required: false,
  data: { label: key, prefill, ...data },
});

const ada = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@login.example.com",
  daliEmail: null,
  dartmouthEmail: null,
  personalEmail: "ada@example.com",
};

const org = (over: Record<string, unknown> = {}) => ({
  org: { name: "Analytical Co", legalEntityName: "Analytical Engines LLC", address: "1 Main St", website: null, ...over },
});

beforeEach(() => {
  vi.resetAllMocks();
  m.user.findUnique.mockResolvedValue(ada);
  m.partnerContact.findUnique.mockResolvedValue({ title: "Director", phone: " 555-0100 ", memberships: [org()] });
});

describe("resolvePrefill", () => {
  it("fills nothing for someone who isn't signed in", async () => {
    expect(await resolvePrefill([ask("n", "text", "me.name")], null)).toEqual({});
    expect(m.user.findUnique).not.toHaveBeenCalled();
  });

  it("reads nothing when no question asks to be filled", async () => {
    expect(await resolvePrefill([ask("n", "text")], "u1")).toEqual({});
    expect(m.user.findUnique).not.toHaveBeenCalled();
    expect(m.partnerContact.findUnique).not.toHaveBeenCalled();
  });

  it("fills the filler's own name and email, and reads only their user row", async () => {
    const got = await resolvePrefill([ask("n", "text", "me.name"), ask("e", "email", "me.email")], "u1");
    expect(got).toEqual({ n: "Ada Lovelace", e: "ada@example.com" });
    expect(m.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }));
    expect(m.partnerContact.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to the login email when no other address is on file", async () => {
    m.user.findUnique.mockResolvedValue({ ...ada, personalEmail: null });
    expect(await resolvePrefill([ask("e", "email", "me.email")], "u1")).toEqual({ e: "ada@login.example.com" });
  });

  it("fills a partner's contact and org fields from their own contact row, trimmed", async () => {
    const got = await resolvePrefill(
      [
        ask("t", "text", "partner.title"),
        ask("p", "text", "partner.phone"),
        ask("o", "text", "partnerOrg.name"),
        ask("l", "text", "partnerOrg.legalEntityName"),
        ask("a", "textarea", "partnerOrg.address"),
      ],
      "u1",
    );
    expect(got).toEqual({
      t: "Director",
      p: "555-0100",
      o: "Analytical Co",
      l: "Analytical Engines LLC",
      a: "1 Main St",
    });
    expect(m.partnerContact.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        select: expect.objectContaining({ memberships: expect.objectContaining({ where: { endedAt: null } }) }),
      }),
    );
    expect(m.user.findUnique).not.toHaveBeenCalled();
  });

  it("leaves blank what isn't on file", async () => {
    expect(await resolvePrefill([ask("w", "text", "partnerOrg.website")], "u1")).toEqual({});
  });

  it("leaves partner fields blank for someone with no partner account", async () => {
    m.partnerContact.findUnique.mockResolvedValue(null);
    expect(await resolvePrefill([ask("t", "text", "partner.title"), ask("o", "text", "partnerOrg.name")], "u1")).toEqual(
      {},
    );
  });

  it("leaves org fields blank when the partner belongs to more than one org", async () => {
    m.partnerContact.findUnique.mockResolvedValue({
      title: "Director",
      phone: null,
      memberships: [org(), org({ name: "Second Co" })],
    });
    expect(await resolvePrefill([ask("o", "text", "partnerOrg.name"), ask("t", "text", "partner.title")], "u1")).toEqual({
      t: "Director",
    });
  });

  it("ignores a prefill key that doesn't fit the question or isn't in the registry", async () => {
    expect(
      await resolvePrefill([ask("r", "radio", "me.name"), ask("x", "text", "user.netId")], "u1"),
    ).toEqual({});
    expect(m.user.findUnique).not.toHaveBeenCalled();
  });

  it("picks the partner's project when they have exactly one", async () => {
    const project = ask("p", "reference", "partnerOrg.project", {
      referenceSource: "projects:my-organization",
      referenceOptions: [{ value: "proj1", label: "Alpha" }],
    });
    expect(await resolvePrefill([project], "u1")).toEqual({ p: "proj1" });
  });

  it("leaves the project unpicked when there are several or none", async () => {
    const options = [
      { value: "proj1", label: "Alpha" },
      { value: "proj2", label: "Beta" },
    ];
    const project = ask("p", "reference", "partnerOrg.project", {
      referenceSource: "projects:my-organization",
      referenceOptions: options,
    });
    expect(await resolvePrefill([project], "u1")).toEqual({});
    expect(
      await resolvePrefill([{ ...project, data: { ...project.data, referenceOptions: [] } }], "u1"),
    ).toEqual({});
  });

  it("looks the projects up as the filler when the options aren't resolved yet", async () => {
    vi.mocked(resolveReferenceOptions).mockResolvedValue([{ value: "proj1", label: "Alpha" }]);
    const project = ask("p", "reference", "partnerOrg.project", { referenceSource: "projects:my-organization" });
    expect(await resolvePrefill([project], "u1")).toEqual({ p: "proj1" });
    expect(resolveReferenceOptions).toHaveBeenCalledWith("projects:my-organization", { userId: "u1" });
  });
});

describe("formFillers", () => {
  const sharing = (linkAccess: string, shares: { principalType: string; principalId: string }[] = []) =>
    m.page.findUnique.mockResolvedValue({ linkAccess, shares });

  beforeEach(() => {
    m.dALIMember.findMany.mockResolvedValue([]);
    m.partnerContact.findMany.mockResolvedValue([]);
  });

  it("follows general access", async () => {
    sharing("Partners");
    expect(await formFillers("f1")).toEqual(["partner"]);
    sharing("LabMembers");
    expect(await formFillers("f1")).toEqual(["member"]);
  });

  it("classifies people the form is shared with by name", async () => {
    sharing("Restricted", [
      { principalType: "User", principalId: "u-member" },
      { principalType: "User", principalId: "u-partner" },
      { principalType: "User", principalId: "u-other" },
    ]);
    m.dALIMember.findMany.mockResolvedValue([{ userId: "u-member" }]);
    m.partnerContact.findMany.mockResolvedValue([{ userId: "u-partner" }]);
    expect(await formFillers("f1")).toEqual(["member", "partner", "other"]);
    expect(m.partnerContact.findMany).toHaveBeenCalledWith({
      where: { userId: { in: ["u-member", "u-partner", "u-other"] } },
      select: { userId: true },
    });
  });

  it("counts a group share as lab members", async () => {
    sharing("Partners", [{ principalType: "Group", principalId: "g1" }]);
    expect(await formFillers("f1")).toEqual(["partner", "member"]);
    expect(m.dALIMember.findMany).not.toHaveBeenCalled();
  });

  it("falls back to lab members for a missing page", async () => {
    m.page.findUnique.mockResolvedValue(null);
    expect(await formFillers("f1")).toEqual(["member"]);
  });
});
