// Tests for new signing MCP tools added in the parity pass:
//   get_binding_to_sign, list_my_signed_documents, list_agreements,
//   get_signed_document_admin, issue_term_agreements, and the new
//   manage_agreement actions: delete_version, archive, remind.
//
// Pattern: scope tag + forbidden/not-found path + happy path per tool.
// Heavy mocks — no DB connection required.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Registry mock ────────────────────────────────────────────────────────────

vi.mock("~/mcp/registry", async () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") {
      super(message, 404);
      this.name = "McpNotFoundError";
    }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") {
      super(message, 403);
      this.name = "McpForbiddenError";
    }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") {
      super(message, 400);
      this.name = "McpInvalidError";
    }
  }
  function requireForAction(
    action: string,
    args: Record<string, unknown>,
    spec: Record<string, string[]>,
  ) {
    const required = spec[action];
    if (!required)
      throw new McpInvalidError(
        `Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`,
      );
    const missing = required.filter(
      (k) => args[k] === undefined || args[k] === null,
    );
    if (missing.length)
      throw new McpInvalidError(
        `action '${action}' requires: ${missing.join(", ")}`,
      );
  }
  return {
    McpError,
    McpNotFoundError,
    McpForbiddenError,
    McpInvalidError,
    requireForAction,
  };
});

// ─── Prisma mock ──────────────────────────────────────────────────────────────

vi.mock("~/lib/db", () => ({
  prisma: {
    signingSignature: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    signingDocument: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    signingBinding: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    signingDocumentVersion: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// ─── Roles mock ───────────────────────────────────────────────────────────────

vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

// ─── Signing lib mocks ────────────────────────────────────────────────────────

vi.mock("~/signing/lib/state.server", () => ({
  listMySignedDocuments: vi.fn(),
  getBindingStateForUser: vi.fn(),
  getSignerCohortsForBinding: vi.fn(),
}));

vi.mock("~/signing/lib/variables.server", () => ({
  resolveSigningVariablesForSigner: vi.fn().mockResolvedValue({
    term: "26F",
    upcomingTerm: "27W",
    today: "September 12, 2026",
    memberName: "Test User",
    supervisorName: "",
  }),
}));

vi.mock("~/signing/lib/audiences", () => ({
  AUDIENCE_RESOLVERS: {
    Members: { includes: vi.fn().mockReturnValue(true) },
    Mentors: { includes: vi.fn().mockReturnValue(false) },
    NewMembers: { includes: vi.fn().mockReturnValue(false) },
    Manual: { includes: vi.fn().mockReturnValue(false) },
    HiringParticipants: { includes: vi.fn().mockReturnValue(false) },
    Group: { includes: vi.fn().mockReturnValue(false) },
  },
}));

vi.mock("~/signing/lib/console.server", () => ({
  getAgreementsOverview: vi.fn(),
}));

vi.mock("~/signing/lib/issue.server", () => ({
  previewTermIssue: vi.fn(),
  issueTermAgreements: vi.fn(),
}));

vi.mock("~/signing/lib/notify.server", () => ({
  notifySignRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/display", () => ({
  fullName: (u: { firstName: string; lastName: string }) =>
    `${u.firstName} ${u.lastName}`,
}));

vi.mock("~/collab/legacy/pm-to-blocknote", () => ({
  ensureBlocks: vi.fn((v) => (Array.isArray(v) ? v : [])),
}));

vi.mock("~/lib/signing-fields", () => ({
  collectSigningFields: vi.fn().mockReturnValue([]),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import {
  listMySignedDocuments,
  getBindingStateForUser,
  getSignerCohortsForBinding,
} from "~/signing/lib/state.server";
import { getAgreementsOverview } from "~/signing/lib/console.server";
import { previewTermIssue, issueTermAgreements } from "~/signing/lib/issue.server";
import { notifySignRequest } from "~/signing/lib/notify.server";

import {
  GET_BINDING_TO_SIGN_TOOL,
  runGetBindingToSign,
} from "../get-binding-to-sign";
import {
  LIST_MY_SIGNED_DOCUMENTS_TOOL,
  runListMySignedDocuments,
} from "../list-my-signed-documents";
import {
  LIST_AGREEMENTS_TOOL,
  runListAgreements,
} from "../list-agreements";
import {
  GET_SIGNED_DOCUMENT_ADMIN_TOOL,
  runGetSignedDocumentAdmin,
} from "../get-signed-document-admin";
import {
  ISSUE_TERM_AGREEMENTS_TOOL,
  runIssueTermAgreements,
} from "../issue-term-agreements";
import { MANAGE_AGREEMENT_TOOL, runManageAgreement } from "../manage-agreement";

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockPrisma = prisma as unknown as {
  signingSignature: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  signingDocument: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  signingBinding: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  signingDocumentVersion: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

function ctx(id = "u1") {
  return {
    user: {
      id,
      daliEmail: "test@dali.dartmouth.edu",
      dartmouthEmail: null as string | null,
      netId: "d12345",
      firstName: "Test",
      lastName: "User",
    },
    scopes: ["mcp:read", "mcp:write", "mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Scopes ───────────────────────────────────────────────────────────────────

describe("scopes", () => {
  it("get_binding_to_sign requires mcp:read", () => {
    expect(GET_BINDING_TO_SIGN_TOOL.requiredScope).toBe("mcp:read");
  });
  it("list_my_signed_documents requires mcp:read", () => {
    expect(LIST_MY_SIGNED_DOCUMENTS_TOOL.requiredScope).toBe("mcp:read");
  });
  it("list_agreements requires mcp:admin", () => {
    expect(LIST_AGREEMENTS_TOOL.requiredScope).toBe("mcp:admin");
  });
  it("get_signed_document_admin requires mcp:admin", () => {
    expect(GET_SIGNED_DOCUMENT_ADMIN_TOOL.requiredScope).toBe("mcp:admin");
  });
  it("issue_term_agreements requires mcp:admin", () => {
    expect(ISSUE_TERM_AGREEMENTS_TOOL.requiredScope).toBe("mcp:admin");
  });
  it("manage_agreement requires mcp:admin", () => {
    expect(MANAGE_AGREEMENT_TOOL.requiredScope).toBe("mcp:admin");
  });
});

// ─── get_binding_to_sign ──────────────────────────────────────────────────────

describe("get_binding_to_sign", () => {
  it("throws not-found when binding does not exist", async () => {
    mockPrisma.signingBinding.findUnique.mockResolvedValue(null);
    await expect(
      runGetBindingToSign(ctx(), { bindingId: "b-missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws forbidden when caller is not in the audience and hasn't signed", async () => {
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      id: "b1",
      versionId: "v1",
      termId: null,
      document: { name: "Mentor Agreement", audience: "Mentors" },
      version: { body: [] },
      term: null,
      signatures: [],
    });
    vi.mocked(getBindingStateForUser).mockResolvedValue({ status: "unsigned" });
    vi.mocked(getSignerCohortsForBinding).mockResolvedValue({
      isMember: true,
      isStaffedThisTerm: true,
      isNewStaffed: false,
      isMentor: false,
      isActiveThisTerm: false,
    });
    // Mentors resolver returns false (non-mentor).
    await expect(
      runGetBindingToSign(ctx(), { bindingId: "b1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns body, fields, and variables for a member in the audience", async () => {
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      id: "b1",
      versionId: "v1",
      termId: "t1",
      document: { name: "Member Agreement", audience: "Members" },
      version: { body: [{ type: "paragraph" }] },
      term: { code: "26F" },
      signatures: [],
    });
    vi.mocked(getBindingStateForUser).mockResolvedValue({ status: "unsigned" });
    vi.mocked(getSignerCohortsForBinding).mockResolvedValue({
      isMember: true,
      isStaffedThisTerm: true,
      isNewStaffed: false,
      isMentor: false,
      isActiveThisTerm: true,
    });

    const result = await runGetBindingToSign(ctx(), { bindingId: "b1" });
    expect(result.bindingId).toBe("b1");
    expect(result.documentName).toBe("Member Agreement");
    expect(result.status).toBe("unsigned");
    expect(result.variables).toBeDefined();
    expect(Array.isArray(result.fields)).toBe(true);
    expect(result.bodyWasLegacy).toBe(false);
  });

  it("allows a caller who has already signed to inspect (signed state)", async () => {
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      id: "b2",
      versionId: "v2",
      termId: null,
      document: { name: "Lab Agreement", audience: "Manual" },
      version: { body: [] },
      term: null,
      signatures: [],
    });
    vi.mocked(getBindingStateForUser).mockResolvedValue({ status: "signed" });
    vi.mocked(getSignerCohortsForBinding).mockResolvedValue({
      isMember: false,
      isStaffedThisTerm: false,
      isNewStaffed: false,
      isMentor: false,
      isActiveThisTerm: false,
    });

    // Even though Manual.includes returns false, the signed state bypasses the gate.
    const result = await runGetBindingToSign(ctx(), { bindingId: "b2" });
    expect(result.status).toBe("signed");
  });

  it("detects legacy ProseMirror body format", async () => {
    const pmBody = { type: "doc", content: [] };
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      id: "b3",
      versionId: "v3",
      termId: null,
      document: { name: "Old Agreement", audience: "Members" },
      version: { body: pmBody },
      term: null,
      signatures: [],
    });
    vi.mocked(getBindingStateForUser).mockResolvedValue({ status: "unsigned" });
    vi.mocked(getSignerCohortsForBinding).mockResolvedValue({
      isMember: true,
      isStaffedThisTerm: true,
      isNewStaffed: false,
      isMentor: false,
      isActiveThisTerm: true,
    });

    const result = await runGetBindingToSign(ctx(), { bindingId: "b3" });
    expect(result.bodyWasLegacy).toBe(true);
  });
});

// ─── list_my_signed_documents ─────────────────────────────────────────────────

describe("list_my_signed_documents", () => {
  it("returns empty array when no signed documents", async () => {
    vi.mocked(listMySignedDocuments).mockResolvedValue([]);
    const result = await runListMySignedDocuments(ctx());
    expect(listMySignedDocuments).toHaveBeenCalledWith("u1");
    expect(result.documents).toEqual([]);
  });

  it("returns signed documents with ISO dates", async () => {
    const signedAt = new Date("2026-08-10T14:30:00.000Z");
    vi.mocked(listMySignedDocuments).mockResolvedValue([
      {
        signatureId: "sig1",
        bindingId: "b1",
        documentName: "Member Agreement",
        context: "Term 26F",
        signedAt,
      },
    ]);
    const result = await runListMySignedDocuments(ctx());
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      signatureId: "sig1",
      bindingId: "b1",
      documentName: "Member Agreement",
      context: "Term 26F",
      signedAt: "2026-08-10T14:30:00.000Z",
    });
  });
});

// ─── list_agreements ──────────────────────────────────────────────────────────

describe("list_agreements", () => {
  it("throws forbidden when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runListAgreements(ctx())).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
  });

  it("returns console overview with serialized dates", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const lastReminded = new Date("2026-09-01T08:00:00.000Z");
    const signedAt = new Date("2026-09-05T10:00:00.000Z");
    vi.mocked(getAgreementsOverview).mockResolvedValue({
      termId: "t1",
      termCode: "26F",
      agreements: [
        {
          id: "d1",
          name: "Member Agreement",
          gateScope: "App",
          audience: "Members",
          cadence: "PerTerm",
          versionCount: 2,
          publishedCount: 1,
          draftPending: false,
          latestPublishedVersionId: "v1",
          needsActivation: false,
          pendingRecipients: null,
          bindings: [
            {
              bindingId: "b1",
              versionNumber: 1,
              scopeKey: "term:t1",
              scopeLabel: "26F",
              termId: "t1",
              isCurrent: true,
              signedCount: 3,
              total: 10,
              outstanding: ["Alice", "Bob"],
              lastRemindedAt: lastReminded,
            },
          ],
        },
      ],
      activity: [
        {
          signatureId: "sig1",
          documentId: "d1",
          documentName: "Member Agreement",
          signerName: "Alice Smith",
          signedAt,
        },
      ],
    });

    const result = await runListAgreements(ctx(), { termId: "t1" });
    expect(getAgreementsOverview).toHaveBeenCalledWith({ termId: "t1" });
    expect(result.termCode).toBe("26F");
    expect(result.agreements).toHaveLength(1);
    expect(result.agreements[0].bindings[0].lastRemindedAt).toBe(
      "2026-09-01T08:00:00.000Z",
    );
    expect(result.activity[0].signedAt).toBe("2026-09-05T10:00:00.000Z");
  });

  it("calls getAgreementsOverview with no termId when omitted", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(getAgreementsOverview).mockResolvedValue({
      termId: null,
      termCode: null,
      agreements: [],
      activity: [],
    });
    await runListAgreements(ctx());
    expect(getAgreementsOverview).toHaveBeenCalledWith({ termId: undefined });
  });
});

// ─── get_signed_document_admin ────────────────────────────────────────────────

describe("get_signed_document_admin", () => {
  it("throws forbidden when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runGetSignedDocumentAdmin(ctx(), { signatureId: "sig1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws not-found when signature does not exist", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingSignature.findUnique.mockResolvedValue(null);
    await expect(
      runGetSignedDocumentAdmin(ctx(), { signatureId: "sig-missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("returns full signed copy with metadata", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const signedAt = new Date("2026-08-15T09:00:00.000Z");
    mockPrisma.signingSignature.findUnique.mockResolvedValue({
      id: "sig1",
      roleKey: "member",
      typedName: "A. Smith",
      ip: "10.0.0.1",
      userAgent: "Mozilla/5.0",
      signedAt,
      frozenBody: [{ type: "paragraph" }],
      signerUserId: "u2",
      signer: { firstName: "Alice", lastName: "Smith" },
      binding: { documentId: "d1" },
      version: {
        versionNumber: 2,
        body: [{ type: "paragraph" }],
        document: { name: "Member Agreement" },
      },
    });

    const result = await runGetSignedDocumentAdmin(ctx(), { signatureId: "sig1" });
    expect(result.signatureId).toBe("sig1");
    expect(result.signerUserId).toBe("u2");
    expect(result.signerName).toBe("Alice Smith");
    expect(result.roleKey).toBe("member");
    expect(result.documentId).toBe("d1");
    expect(result.documentName).toBe("Member Agreement");
    expect(result.versionNumber).toBe(2);
    expect(result.signedAt).toBe("2026-08-15T09:00:00.000Z");
    expect(result.ip).toBe("10.0.0.1");
    expect(result.userAgent).toBe("Mozilla/5.0");
    expect(result.frozenBodyIsLegacy).toBe(false);
  });

  it("detects legacy ProseMirror frozen body", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const signedAt = new Date("2025-01-01T00:00:00.000Z");
    const legacyBody = { type: "doc", content: [] };
    mockPrisma.signingSignature.findUnique.mockResolvedValue({
      id: "sig2",
      roleKey: "member",
      typedName: "B. Jones",
      ip: null,
      userAgent: null,
      signedAt,
      frozenBody: legacyBody,
      signerUserId: "u3",
      signer: { firstName: "Bob", lastName: "Jones" },
      binding: { documentId: "d2" },
      version: {
        versionNumber: 1,
        body: legacyBody,
        document: { name: "Old Agreement" },
      },
    });

    const result = await runGetSignedDocumentAdmin(ctx(), { signatureId: "sig2" });
    expect(result.frozenBodyIsLegacy).toBe(true);
    expect(result.ip).toBeNull();
    expect(result.userAgent).toBeNull();
  });
});

// ─── issue_term_agreements ────────────────────────────────────────────────────

describe("issue_term_agreements", () => {
  it("throws forbidden when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runIssueTermAgreements(ctx(), { preview: true }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("preview:true returns term issue preview without activating", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(previewTermIssue).mockResolvedValue({
      termCode: "26F",
      items: [
        {
          documentId: "d1",
          documentName: "Member Agreement",
          recipientCount: 5,
          recipientNames: ["Alice Smith", "Bob Jones"],
          alreadyInForce: false,
        },
      ],
    });

    const result = await runIssueTermAgreements(ctx(), { preview: true, termId: "t1" });
    expect(previewTermIssue).toHaveBeenCalledWith({ termId: "t1" });
    expect(issueTermAgreements).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      preview: true,
      termCode: "26F",
      items: expect.arrayContaining([
        expect.objectContaining({ documentId: "d1" }),
      ]),
    });
  });

  it("throws invalid when documentIds is empty and preview is false", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runIssueTermAgreements(ctx(), { preview: false, documentIds: [] }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("issues agreements and returns result", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(issueTermAgreements).mockResolvedValue({ issued: 2, errors: [] });

    const result = await runIssueTermAgreements(ctx(), {
      documentIds: ["d1", "d2"],
      termId: "t1",
    });
    expect(issueTermAgreements).toHaveBeenCalledWith(
      expect.objectContaining({
        documentIds: ["d1", "d2"],
        termId: "t1",
        userId: "u1",
      }),
    );
    expect(result).toMatchObject({ preview: false, issued: 2, errors: [] });
  });

  it("returns partial errors from issueTermAgreements", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(issueTermAgreements).mockResolvedValue({
      issued: 1,
      errors: ["Document d2: PerCycle cadence not supported here."],
    });

    const result = await runIssueTermAgreements(ctx(), {
      documentIds: ["d1", "d2"],
    });
    expect((result as { errors: string[] }).errors).toHaveLength(1);
  });
});

// ─── manage_agreement: delete_version, archive, remind ────────────────────────

describe("manage_agreement — delete_version", () => {
  it("throws forbidden when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageAgreement(ctx(), {
        action: "delete_version",
        documentId: "d1",
        versionId: "v1",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws not-found when version doesn't exist or belongs to another doc", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue(null);
    await expect(
      runManageAgreement(ctx(), {
        action: "delete_version",
        documentId: "d1",
        versionId: "v-gone",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws invalid when version is published", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      documentId: "d1",
      publishedAt: new Date("2026-08-01"),
      _count: { signatures: 0, bindings: 0 },
    });
    await expect(
      runManageAgreement(ctx(), {
        action: "delete_version",
        documentId: "d1",
        versionId: "v1",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws invalid when version has signatures", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      documentId: "d1",
      publishedAt: null,
      _count: { signatures: 1, bindings: 0 },
    });
    await expect(
      runManageAgreement(ctx(), {
        action: "delete_version",
        documentId: "d1",
        versionId: "v1",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("deletes an unpublished unsigned draft version", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      documentId: "d1",
      publishedAt: null,
      _count: { signatures: 0, bindings: 0 },
    });
    mockPrisma.signingDocumentVersion.delete.mockResolvedValue({ id: "v1" });

    const result = await runManageAgreement(ctx(), {
      action: "delete_version",
      documentId: "d1",
      versionId: "v1",
    });
    expect(mockPrisma.signingDocumentVersion.delete).toHaveBeenCalledWith({
      where: { id: "v1" },
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("manage_agreement — archive", () => {
  it("throws forbidden when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageAgreement(ctx(), { action: "archive", documentId: "d1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws not-found when document doesn't exist", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocument.findUnique.mockResolvedValue(null);
    await expect(
      runManageAgreement(ctx(), { action: "archive", documentId: "d-gone" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("archives an active document", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocument.findUnique.mockResolvedValue({
      id: "d1",
      archivedAt: null,
    });
    mockPrisma.signingDocument.update.mockResolvedValue({ id: "d1" });

    const result = await runManageAgreement(ctx(), {
      action: "archive",
      documentId: "d1",
    });
    expect(mockPrisma.signingDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d1" },
        data: { archivedAt: expect.any(Date) },
      }),
    );
    expect(result).toMatchObject({ ok: true, archived: true });
  });

  it("unarchives an already-archived document (toggle)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocument.findUnique.mockResolvedValue({
      id: "d1",
      archivedAt: new Date("2026-08-01"),
    });
    mockPrisma.signingDocument.update.mockResolvedValue({ id: "d1" });

    const result = await runManageAgreement(ctx(), {
      action: "archive",
      documentId: "d1",
    });
    expect(mockPrisma.signingDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { archivedAt: null },
      }),
    );
    expect(result).toMatchObject({ ok: true, archived: false });
  });
});

describe("manage_agreement — remind", () => {
  it("throws forbidden when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageAgreement(ctx(), { action: "remind", bindingId: "b1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws not-found when binding doesn't exist", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingBinding.findUnique.mockResolvedValue(null);
    await expect(
      runManageAgreement(ctx(), { action: "remind", bindingId: "b-gone" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws not-found when the agreement is archived", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      id: "b1",
      documentId: "d1",
      lastRemindedAt: null,
      document: { archivedAt: new Date("2026-07-01") },
    });
    await expect(
      runManageAgreement(ctx(), { action: "remind", bindingId: "b1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws invalid when reminded within the last 24h (no force)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      id: "b1",
      documentId: "d1",
      lastRemindedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      document: { archivedAt: null },
    });
    await expect(
      runManageAgreement(ctx(), { action: "remind", bindingId: "b1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("sends reminder when not throttled", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      id: "b1",
      documentId: "d1",
      lastRemindedAt: null,
      document: { archivedAt: null },
    });
    mockPrisma.signingBinding.update.mockResolvedValue({ id: "b1" });

    const result = await runManageAgreement(ctx(), {
      action: "remind",
      bindingId: "b1",
    });
    expect(notifySignRequest).toHaveBeenCalledWith("b1", { force: true });
    expect(mockPrisma.signingBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1" },
        data: { lastRemindedAt: expect.any(Date) },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("bypasses 24h throttle when force:true", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      id: "b1",
      documentId: "d1",
      lastRemindedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      document: { archivedAt: null },
    });
    mockPrisma.signingBinding.update.mockResolvedValue({ id: "b1" });

    const result = await runManageAgreement(ctx(), {
      action: "remind",
      bindingId: "b1",
      force: true,
    });
    expect(notifySignRequest).toHaveBeenCalledWith("b1", { force: true });
    expect(result).toEqual({ ok: true });
  });
});
