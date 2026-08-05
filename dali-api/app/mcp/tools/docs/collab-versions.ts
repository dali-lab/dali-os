// MCP collab-version tools.
//   list_collab_versions   — mcp:read  (auth via authorizeCollabDoc)
//   get_collab_version     — mcp:read  (single version full text)
//   restore_collab_version — mcp:write (restore via the collab pipeline — honors clone rule)

import { prisma } from "~/lib/db";
import { authorizeCollabDoc, hydrateAuthors } from "~/lib/collabAuth";
import { getCollabServer } from "~/collab/server";
import { restoreVersion } from "~/collab/persistence";

const PREVIEW_CHARS = 200;

// ─── list_collab_versions ─────────────────────────────────────────────────────

export const LIST_COLLAB_VERSIONS_TOOL = {
  name: "list_collab_versions",
  description:
    "List version history snapshots for a collaborative document. Access is gated by the doc's own permission model. Returns versions newest-first with a short plain-text preview.",
  inputSchema: {
    type: "object" as const,
    properties: {
      docName: {
        type: "string",
        minLength: 1,
        description:
          "The collab room name (e.g. 'doc:{pageId}:body', 'task:{taskId}:description'). Use read_page to find a page's doc name.",
      },
    },
    required: ["docName"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export class CollabVersionError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "CollabVersionError";
  }
}

type ListVersionsInput = { docName: string };

export async function runListCollabVersions(callerId: string, input: ListVersionsInput) {
  const { allowed } = await authorizeCollabDoc(callerId, input.docName);
  if (!allowed) throw new CollabVersionError("Forbidden", 403);

  const versions = await prisma.collabDocumentVersion.findMany({
    where: { name: input.docName },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, plainText: true, authorIds: true },
  });

  const allAuthorIds = new Set<string>();
  for (const v of versions) for (const id of v.authorIds) allAuthorIds.add(id);
  const authorList = await hydrateAuthors(Array.from(allAuthorIds));
  const authorsById = new Map(authorList.map((a) => [a.id, a]));

  return versions.map((v) => ({
    id: v.id,
    createdAt: v.createdAt.toISOString(),
    plainTextPreview:
      v.plainText.length > PREVIEW_CHARS
        ? `${v.plainText.slice(0, PREVIEW_CHARS).trimEnd()}…`
        : v.plainText,
    authors: v.authorIds.map((id) => authorsById.get(id)).filter(Boolean),
  }));
}

// ─── get_collab_version ───────────────────────────────────────────────────────

export const GET_COLLAB_VERSION_TOOL = {
  name: "get_collab_version",
  description:
    "Get the full plain-text content of a specific collab document version snapshot.",
  inputSchema: {
    type: "object" as const,
    properties: {
      versionId: {
        type: "string",
        minLength: 1,
        description: "Version ID from list_collab_versions.",
      },
    },
    required: ["versionId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type GetVersionInput = { versionId: string };

export async function runGetCollabVersion(callerId: string, input: GetVersionInput) {
  const version = await prisma.collabDocumentVersion.findUnique({
    where: { id: input.versionId },
    select: { id: true, name: true, createdAt: true, plainText: true, authorIds: true },
  });
  if (!version) throw new CollabVersionError("Version not found", 404);

  const { allowed } = await authorizeCollabDoc(callerId, version.name);
  if (!allowed) throw new CollabVersionError("Forbidden", 403);

  return {
    id: version.id,
    docName: version.name,
    createdAt: version.createdAt.toISOString(),
    plainText: version.plainText,
    authors: await hydrateAuthors(version.authorIds),
  };
}

// ─── restore_collab_version ───────────────────────────────────────────────────

export const RESTORE_COLLAB_VERSION_TOOL = {
  name: "restore_collab_version",
  description:
    "Restore a collaborative document to a previous version snapshot. Reuses the server-side collab pipeline (restoreVersion) so the Y.Doc clone rule is respected and open editors receive the change via websocket. Requires edit access on the document.",
  inputSchema: {
    type: "object" as const,
    properties: {
      versionId: { type: "string", minLength: 1, description: "Version ID to restore." },
    },
    required: ["versionId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type RestoreVersionInput = { versionId: string };

export async function runRestoreCollabVersion(callerId: string, input: RestoreVersionInput) {
  const version = await prisma.collabDocumentVersion.findUnique({
    where: { id: input.versionId },
    select: { id: true, name: true },
  });
  if (!version) throw new CollabVersionError("Version not found", 404);

  // Auth: must have edit rights (allowed=true AND readOnly=false).
  const auth = await authorizeCollabDoc(callerId, version.name);
  if (!auth.allowed || auth.readOnly) throw new CollabVersionError("Forbidden", 403);

  const server = getCollabServer();
  if (!server) throw new CollabVersionError("Collab server not running", 503);

  await restoreVersion(server, version.name, version.id);
  return { ok: true };
}
