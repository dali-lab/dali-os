// MCP collab-version tools.
//   list_collab_versions   — mcp:read  (auth via authorizeCollabDoc)
//   get_collab_version     — mcp:read  (single version full text)
//   restore_collab_version — mcp:write (restore via the collab pipeline — honors clone rule)

import { prisma } from "~/lib/db.server";
import { authorizeCollabDoc, hydrateAuthors } from "~/lib/collabAuth";
import { getCollabServer } from "~/collab/server";
import { restoreVersion } from "~/collab/persistence";
import {
  TEXT_PAGE_LIMITS,
  keysetPage,
  keysetWindow,
  pageProps,
  pageText,
  type PageArgs,
} from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

const PREVIEW_CHARS = 200;

// ─── list_collab_versions ─────────────────────────────────────────────────────

export const LIST_COLLAB_VERSIONS_TOOL = {
  name: "list_collab_versions",
  description:
    "List version history snapshots for a collaborative document. Access is gated by the doc's own permission model. Returns versions newest-first with a short plain-text preview. Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      docName: {
        type: "string",
        minLength: 1,
        description:
          "The collab room name (e.g. 'doc:{pageId}:body', 'task:{taskId}:description'). Use read_page to find a page's doc name.",
      },
      ...pageProps(PAGE_LIMITS),
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

type ListVersionsInput = PageArgs & { docName: string };

export async function runListCollabVersions(callerId: string, input: ListVersionsInput) {
  const { allowed } = await authorizeCollabDoc(callerId, input.docName);
  if (!allowed) throw new CollabVersionError("Forbidden", 403);

  const window = keysetWindow(input, PAGE_LIMITS, [{ field: "createdAt", direction: "desc", type: "date" }]);
  const fetched = await prisma.collabDocumentVersion.findMany({
    where: { AND: [{ name: input.docName }, window.where] },
    orderBy: window.orderBy,
    take: window.take,
    select: { id: true, createdAt: true, plainText: true, authorIds: true },
  });
  const { rows: versions, page } = keysetPage(fetched, window);

  const allAuthorIds = new Set<string>();
  for (const v of versions) for (const id of v.authorIds) allAuthorIds.add(id);
  const authorList = await hydrateAuthors(Array.from(allAuthorIds));
  const authorsById = new Map(authorList.map((a) => [a.id, a]));

  // Wrapped in an object: MCP `structuredContent` must be a JSON object, so a
  // bare array fails result validation on the client before the caller sees it.
  return {
    page,
    versions: versions.map((v) => ({
      id: v.id,
      createdAt: v.createdAt.toISOString(),
      plainTextPreview:
        v.plainText.length > PREVIEW_CHARS
          ? `${v.plainText.slice(0, PREVIEW_CHARS).trimEnd()}…`
          : v.plainText,
      authors: v.authorIds.map((id) => authorsById.get(id)).filter(Boolean),
    })),
  };
}

// ─── get_collab_version ───────────────────────────────────────────────────────

export const GET_COLLAB_VERSION_TOOL = {
  name: "get_collab_version",
  description:
    "Get the plain-text content of a specific collab document version snapshot. Long versions come back in chunks of limit characters (default 50000, max 200000): pass page.nextCursor as cursor until page.hasMore is false. page.total is the full length.",
  inputSchema: {
    type: "object" as const,
    properties: {
      versionId: {
        type: "string",
        minLength: 1,
        description: "Version ID from list_collab_versions.",
      },
      ...pageProps(TEXT_PAGE_LIMITS),
    },
    required: ["versionId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type GetVersionInput = PageArgs & { versionId: string };

export async function runGetCollabVersion(callerId: string, input: GetVersionInput) {
  const version = await prisma.collabDocumentVersion.findUnique({
    where: { id: input.versionId },
    select: { id: true, name: true, createdAt: true, plainText: true, authorIds: true },
  });
  if (!version) throw new CollabVersionError("Version not found", 404);

  const { allowed } = await authorizeCollabDoc(callerId, version.name);
  if (!allowed) throw new CollabVersionError("Forbidden", 403);

  const chunk = pageText(version.plainText, input);

  return {
    id: version.id,
    docName: version.name,
    createdAt: version.createdAt.toISOString(),
    plainText: chunk.text,
    page: chunk.page,
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

// ─── name_collab_version ──────────────────────────────────────────────────────

export const NAME_COLLAB_VERSION_TOOL = {
  name: "name_collab_version",
  description:
    "Set or clear a human-readable label on a collab document version snapshot (e.g. 'Before Q3 review'). An empty string clears the label. Requires at least view access on the document.",
  inputSchema: {
    type: "object" as const,
    properties: {
      versionId: { type: "string", minLength: 1, description: "Version ID to label." },
      label: {
        type: "string",
        maxLength: 200,
        description: "Label text. Empty string clears the label.",
      },
    },
    required: ["versionId", "label"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type NameVersionInput = { versionId: string; label: string };

export async function runNameCollabVersion(callerId: string, input: NameVersionInput) {
  const version = await prisma.collabDocumentVersion.findUnique({
    where: { id: input.versionId },
    select: { id: true, name: true },
  });
  if (!version) throw new CollabVersionError("Version not found", 404);

  // Auth: view access is sufficient to label (matches web route behaviour).
  const { allowed } = await authorizeCollabDoc(callerId, version.name);
  if (!allowed) throw new CollabVersionError("Forbidden", 403);

  // Empty string clears the label; non-empty sets it.
  const label = input.label.trim() || null;
  await prisma.collabDocumentVersion.update({
    where: { id: version.id },
    data: { label },
  });
  return { ok: true, label };
}
