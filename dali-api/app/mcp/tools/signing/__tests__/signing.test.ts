// Tests for signing MCP tools.
// Pattern: scope tag + forbidden path + happy path per tool.
// Heavy mocks — no DB connection required.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the registry module to prevent it from importing all tool areas and
// crashing in the BY_NAME map initialization. We only need the error classes
// and requireForAction from registry here.
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
    },
    signingDocumentVersion: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

vi.mock("~/signing/lib/state.server", () => ({
  listOutstandingBindings: vi.fn(),
  listMySignedDocuments: vi.fn(),
  getBindingStateForUser: vi.fn(),
  getSignerCohorts: vi.fn(),
}));

vi.mock("~/signing/lib/sign.server", () => ({
  recordSignature: vi.fn(),
}));

vi.mock("~/signing/lib/audiences", () => ({
  AUDIENCE_RESOLVERS: {
    NewMembers: { includes: vi.fn().mockReturnValue(false) },
    Members: { includes: vi.fn().mockReturnValue(true) },
    Mentors: { includes: vi.fn().mockReturnValue(false) },
    Manual: { includes: vi.fn().mockReturnValue(false) },
    HiringParticipants: { includes: vi.fn().mockReturnValue(false) },
  },
}));

vi.mock("~/signing/lib/scope.server", () => ({
  resolveAdminScope: vi.fn(),
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

// Imports after mocks.
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import {
  listOutstandingBindings,
  getSignerCohorts,
} from "~/signing/lib/state.server";
import { recordSignature } from "~/signing/lib/sign.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { resolveAdminScope } from "~/signing/lib/scope.server";
import { notifySignRequest } from "~/signing/lib/notify.server";

import {
  LIST_DOCUMENTS_TO_SIGN_TOOL,
  runListDocumentsToSign,
} from "../list-documents-to-sign";
import {
  GET_SIGNED_DOCUMENT_TOOL,
  runGetSignedDocument,
} from "../get-signed-document";
import {
  LIST_AGREEMENT_SIGNATURES_TOOL,
  runListAgreementSignatures,
} from "../list-agreement-signatures";
import { SIGN_DOCUMENT_TOOL, runSignDocument } from "../sign-document";
import { MANAGE_AGREEMENT_TOOL, runManageAgreement } from "../manage-agreement";

// Typed mock helpers.
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
  };
  signingDocumentVersion: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
};

// A minimal McpCtx for tests.
function ctx(id = "u1") {
  return {
    user: {
      id,
      daliEmail: "test@dali.dartmouth.edu",
      dartmouthEmail: null,
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
  it("list_documents_to_sign requires mcp:read", () => {
    expect(LIST_DOCUMENTS_TO_SIGN_TOOL.requiredScope).toBe("mcp:read");
  });
  it("get_signed_document requires mcp:read", () => {
    expect(GET_SIGNED_DOCUMENT_TOOL.requiredScope).toBe("mcp:read");
  });
  it("list_agreement_signatures requires mcp:read", () => {
    expect(LIST_AGREEMENT_SIGNATURES_TOOL.requiredScope).toBe("mcp:read");
  });
  it("sign_document requires mcp:write", () => {
    expect(SIGN_DOCUMENT_TOOL.requiredScope).toBe("mcp:write");
  });
  it("manage_agreement requires mcp:admin", () => {
    expect(MANAGE_AGREEMENT_TOOL.requiredScope).toBe("mcp:admin");
  });
});

// ─── list_documents_to_sign ───────────────────────────────────────────────────

describe("list_documents_to_sign", () => {
  it("returns outstanding bindings for the caller", async () => {
    const outstanding = [
      {
        bindingId: "b1",
        documentId: "d1",
        documentName: "Member Agreement",
        kind: "MemberAgreement",
        versionId: "v1",
      },
    ];
    vi.mocked(listOutstandingBindings).mockResolvedValue(outstanding);
    const result = await runListDocumentsToSign(ctx());
    expect(listOutstandingBindings).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ documents: outstanding });
  });

  it("returns empty array when no obligations", async () => {
    vi.mocked(listOutstandingBindings).mockResolvedValue([]);
    const result = await runListDocumentsToSign(ctx());
    expect(result.documents).toEqual([]);
  });
});

// ─── get_signed_document ──────────────────────────────────────────────────────

describe("get_signed_document", () => {
  it("throws not-found when no signature exists", async () => {
    mockPrisma.signingSignature.findUnique.mockResolvedValue(null);
    await expect(
      runGetSignedDocument(ctx(), { bindingId: "b1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("returns signed document metadata with serialized date", async () => {
    const signedAt = new Date("2026-08-01T12:00:00.000Z");
    mockPrisma.signingSignature.findUnique.mockResolvedValue({
      id: "sig1",
      signedAt,
      typedName: "Alice Smith",
      frozenBody: null,
      bindingId: "b1",
      binding: {
        document: { name: "Member Agreement", kind: "MemberAgreement" },
        version: { versionNumber: 2, body: { type: "doc", content: [] } },
      },
    });
    const result = await runGetSignedDocument(ctx(), { bindingId: "b1" });
    expect(result.signatureId).toBe("sig1");
    expect(result.documentName).toBe("Member Agreement");
    expect(result.documentKind).toBe("MemberAgreement");
    expect(result.versionNumber).toBe(2);
    expect(result.signedAt).toBe("2026-08-01T12:00:00.000Z");
    expect(result.typedName).toBe("Alice Smith");
    // Legacy body (type: "doc") → frozenBodyIsLegacy = true
    expect(result.frozenBodyIsLegacy).toBe(true);
  });

  it("detects non-legacy block JSON body", async () => {
    const signedAt = new Date("2026-08-01T12:00:00.000Z");
    mockPrisma.signingSignature.findUnique.mockResolvedValue({
      id: "sig2",
      signedAt,
      typedName: "Bob Jones",
      frozenBody: [{ type: "paragraph", content: [] }],
      bindingId: "b2",
      binding: {
        document: { name: "General Agreement", kind: "General" },
        version: { versionNumber: 1, body: [{ type: "paragraph" }] },
      },
    });
    const result = await runGetSignedDocument(ctx(), { bindingId: "b2" });
    expect(result.frozenBodyIsLegacy).toBe(false);
  });
});

// ─── list_agreement_signatures ────────────────────────────────────────────────

describe("list_agreement_signatures", () => {
  it("throws forbidden when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runListAgreementSignatures(ctx(), { documentId: "d1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns signatures for a document", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const signedAt = new Date("2026-07-15T09:00:00.000Z");
    mockPrisma.signingSignature.findMany.mockResolvedValue([
      {
        id: "sig1",
        typedName: "Alice Smith",
        signedAt,
        signerUserId: "u2",
        signer: { firstName: "Alice", lastName: "Smith" },
        binding: { id: "b1", scopeKey: "app" },
      },
    ]);
    const result = await runListAgreementSignatures(ctx(), { documentId: "d1" });
    expect(result.signatures).toHaveLength(1);
    expect(result.signatures[0]).toMatchObject({
      signatureId: "sig1",
      signerUserId: "u2",
      name: "Alice Smith",
      signedAt: "2026-07-15T09:00:00.000Z",
      bindingId: "b1",
      scopeKey: "app",
    });
  });

  it("filters by bindingId when provided", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingSignature.findMany.mockResolvedValue([]);
    await runListAgreementSignatures(ctx(), {
      documentId: "d1",
      bindingId: "b1",
    });
    expect(mockPrisma.signingSignature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bindingId: "b1" }),
      }),
    );
  });
});

// ─── sign_document ────────────────────────────────────────────────────────────

describe("sign_document", () => {
  it("throws not-found when binding does not exist", async () => {
    mockPrisma.signingBinding.findUnique.mockResolvedValue(null);
    await expect(
      runSignDocument(ctx(), { bindingId: "b-missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws forbidden when caller is not in the audience", async () => {
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      document: { audience: "Mentors" },
    });
    vi.mocked(getSignerCohorts).mockResolvedValue({
      isMember: true,
      isNewMember: false,
      isMentor: false,
      isActiveThisTerm: false,
    });
    // Mentors resolver returns false for non-mentors.
    vi.mocked(AUDIENCE_RESOLVERS.Mentors.includes).mockReturnValue(false);
    await expect(
      runSignDocument(ctx(), { bindingId: "b1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("signs the document and returns ok", async () => {
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      document: { audience: "Members" },
    });
    vi.mocked(getSignerCohorts).mockResolvedValue({
      isMember: true,
      isNewMember: false,
      isMentor: false,
      isActiveThisTerm: false,
    });
    vi.mocked(AUDIENCE_RESOLVERS.Members.includes).mockReturnValue(true);
    vi.mocked(recordSignature).mockResolvedValue({ ok: true });

    const result = await runSignDocument(ctx(), {
      bindingId: "b1",
      fieldValues: { "sig-field": "Alice Smith" },
    });
    expect(recordSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "b1",
        signerUserId: "u1",
        fieldValues: { "sig-field": "Alice Smith" },
      }),
    );
    expect(result).toEqual({ ok: true, bindingId: "b1" });
  });

  it("throws invalid when recordSignature returns an error", async () => {
    mockPrisma.signingBinding.findUnique.mockResolvedValue({
      document: { audience: "Members" },
    });
    vi.mocked(getSignerCohorts).mockResolvedValue({
      isMember: true,
      isNewMember: false,
      isMentor: false,
      isActiveThisTerm: false,
    });
    vi.mocked(AUDIENCE_RESOLVERS.Members.includes).mockReturnValue(true);
    vi.mocked(recordSignature).mockResolvedValue({
      ok: false,
      error: "Please complete all required fields before signing.",
    });
    await expect(
      runSignDocument(ctx(), { bindingId: "b1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});

// ─── manage_agreement ─────────────────────────────────────────────────────────

describe("manage_agreement", () => {
  it("throws forbidden when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageAgreement(ctx(), { action: "create", name: "Test Doc" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws invalid for unknown action", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManageAgreement(ctx(), { action: "archive" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("creates a document with defaults", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    // uniqueSlug check: no existing doc with that slug.
    mockPrisma.signingDocument.findUnique.mockResolvedValue(null);
    mockPrisma.signingDocument.create.mockResolvedValue({ id: "doc-new" });

    const result = await runManageAgreement(ctx(), {
      action: "create",
      name: "Lab Agreement",
    });
    expect(mockPrisma.signingDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Lab Agreement",
          kind: "General",
          gateScope: "None",
          audience: "Manual",
          cadence: "Once",
        }),
      }),
    );
    expect(result).toEqual({ documentId: "doc-new" });
  });

  it("creates a document with explicit kind/scope/audience/cadence", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocument.findUnique.mockResolvedValue(null);
    mockPrisma.signingDocument.create.mockResolvedValue({ id: "doc-mem" });

    const result = await runManageAgreement(ctx(), {
      action: "create",
      name: "Membership Agreement",
      kind: "MemberAgreement",
      gateScope: "App",
      audience: "Members",
      cadence: "PerTerm",
    });
    expect(mockPrisma.signingDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "MemberAgreement",
          gateScope: "App",
          audience: "Members",
          cadence: "PerTerm",
        }),
      }),
    );
    expect(result).toEqual({ documentId: "doc-mem" });
  });

  it("renames a document", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocument.update.mockResolvedValue({ id: "d1" });

    const result = await runManageAgreement(ctx(), {
      action: "rename",
      documentId: "d1",
      name: "Updated Name",
    });
    expect(mockPrisma.signingDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d1" },
        data: { name: "Updated Name" },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("publishes a version", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocumentVersion.update.mockResolvedValue({ id: "v1" });

    const result = await runManageAgreement(ctx(), {
      action: "publish",
      documentId: "d1",
      versionId: "v1",
    });
    expect(mockPrisma.signingDocumentVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "v1" },
        data: { publishedAt: expect.any(Date) },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("throws invalid when activating an unpublished version", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      publishedAt: null,
    });
    await expect(
      runManageAgreement(ctx(), {
        action: "activate",
        documentId: "d1",
        versionId: "v1",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("activates a published version and sends notifications", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      publishedAt: new Date("2026-08-01"),
      body: [],
    });
    mockPrisma.signingDocument.findUnique.mockResolvedValue({ cadence: "Once" });
    vi.mocked(resolveAdminScope).mockResolvedValue({ scopeKey: "app" });
    mockPrisma.signingBinding.upsert.mockResolvedValue({ id: "b-new" });

    const result = await runManageAgreement(ctx(), {
      action: "activate",
      documentId: "d1",
      versionId: "v1",
    });
    expect(mockPrisma.signingBinding.upsert).toHaveBeenCalled();
    expect(notifySignRequest).toHaveBeenCalledWith("b-new");
    expect(result).toEqual({ ok: true, bindingId: "b-new" });
  });

  it("records pre-signed admin signatures placed in the body at activation", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      publishedAt: new Date("2026-08-01"),
      body: [
        {
          id: "p1",
          type: "paragraph",
          props: {},
          content: [
            {
              type: "adminSignatureField",
              props: { fieldId: "a1", role: "supervisor", value: "Dean Staff", signerUserId: "sup-1" },
            },
          ],
          children: [],
        },
      ],
    });
    mockPrisma.signingDocument.findUnique.mockResolvedValue({ cadence: "Once" });
    vi.mocked(resolveAdminScope).mockResolvedValue({ scopeKey: "app" });
    mockPrisma.signingBinding.upsert.mockResolvedValue({ id: "b-new" });
    mockPrisma.signingSignature.upsert.mockResolvedValue({ id: "sup-sig1" });

    await runManageAgreement(ctx(), {
      action: "activate",
      documentId: "d1",
      versionId: "v1",
    });
    expect(mockPrisma.signingSignature.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bindingId_signerUserId_roleKey: {
            bindingId: "b-new",
            signerUserId: "sup-1",
            roleKey: "supervisor",
          },
        },
        create: expect.objectContaining({
          roleKey: "supervisor",
          typedName: "Dean Staff",
        }),
      }),
    );
  });

  it("throws invalid when resolveAdminScope returns error", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocumentVersion.findUnique.mockResolvedValue({
      publishedAt: new Date("2026-08-01"),
    });
    mockPrisma.signingDocument.findUnique.mockResolvedValue({ cadence: "PerCycle" });
    vi.mocked(resolveAdminScope).mockResolvedValue({
      error: "Per-cycle agreements are bound to a cycle from the hiring lead's cycle setup.",
    });
    await expect(
      runManageAgreement(ctx(), {
        action: "activate",
        documentId: "d1",
        versionId: "v1",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("updates config facets on an existing document", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocument.findUnique.mockResolvedValue({ id: "d1" });
    mockPrisma.signingDocument.update.mockResolvedValue({ id: "d1" });

    const result = await runManageAgreement(ctx(), {
      action: "update",
      documentId: "d1",
      gateScope: "App",
      audience: "Mentors",
      cadence: "PerTerm",
    });
    expect(mockPrisma.signingDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d1" },
        // Setting a non-Group audience clears any stale target group.
        data: { gateScope: "App", audience: "Mentors", audienceGroupId: null, cadence: "PerTerm" },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("updates the kind on an existing document", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocument.findUnique.mockResolvedValue({ id: "d1" });
    mockPrisma.signingDocument.update.mockResolvedValue({ id: "d1" });

    await runManageAgreement(ctx(), {
      action: "update",
      documentId: "d1",
      kind: "MentorshipAgreement",
    });
    expect(mockPrisma.signingDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d1" },
        data: { kind: "MentorshipAgreement" },
      }),
    );
  });

  it("throws invalid when update supplies no facets", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManageAgreement(ctx(), { action: "update", documentId: "d1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws invalid for an unknown enum value on update", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManageAgreement(ctx(), {
        action: "update",
        documentId: "d1",
        audience: "Everyone",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws not-found when updating a missing document", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.signingDocument.findUnique.mockResolvedValue(null);
    await expect(
      runManageAgreement(ctx(), {
        action: "update",
        documentId: "gone",
        audience: "Mentors",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});
