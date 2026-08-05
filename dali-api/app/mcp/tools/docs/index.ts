// MCP tool area: docs. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool, McpCtx } from "../../registry";

import { SEARCH_TOOL, runMcpSearch } from "./search";
import { LIST_COMMENTS_TOOL, runListComments } from "./comments";
import {
  LIST_LAB_DOCUMENTS_TOOL,
  runListLabDocuments,
  CREATE_LAB_DOCUMENT_TOOL,
  runCreateLabDocument,
  DELETE_LAB_DOCUMENT_TOOL,
  runDeleteLabDocument,
} from "./lab-documents";
import {
  LIST_PERSONAL_NOTES_TOOL,
  runListPersonalNotes,
  GET_PERSONAL_NOTE_TOOL,
  runGetPersonalNote,
  MANAGE_PERSONAL_NOTE_TOOL,
  runManagePersonalNote,
} from "./personal-notes";
import {
  LIST_DOC_TAGS_TOOL,
  runListDocTags,
  MANAGE_DOC_TAGS_TOOL,
  runManageDocTags,
  APPLY_DOC_TAG_TOOL,
  runApplyDocTag,
} from "./doc-tags";
import {
  LIST_COLLAB_VERSIONS_TOOL,
  runListCollabVersions,
  GET_COLLAB_VERSION_TOOL,
  runGetCollabVersion,
  RESTORE_COLLAB_VERSION_TOOL,
  runRestoreCollabVersion,
} from "./collab-versions";
import { MANAGE_COMMENT_TOOL_DEF, runManageComment } from "./manage-comment";
import { MANAGE_PAGE_TOOL_DEF, runManagePage } from "./manage-page";

export const DOCS_TOOLS: McpTool[] = [
  {
    def: SEARCH_TOOL,
    run: (ctx: McpCtx, args) =>
      runMcpSearch(ctx.user.id, args as Parameters<typeof runMcpSearch>[1]),
  },
  {
    def: LIST_COMMENTS_TOOL,
    run: (ctx: McpCtx, args) =>
      runListComments(ctx.user.id, args as Parameters<typeof runListComments>[1]),
  },
  {
    def: LIST_LAB_DOCUMENTS_TOOL,
    run: (ctx: McpCtx, args) =>
      runListLabDocuments(ctx.user.id, args as Parameters<typeof runListLabDocuments>[1]),
  },
  {
    def: CREATE_LAB_DOCUMENT_TOOL,
    run: (ctx: McpCtx, args) =>
      runCreateLabDocument(ctx.user.id, args as Parameters<typeof runCreateLabDocument>[1]),
  },
  {
    def: DELETE_LAB_DOCUMENT_TOOL,
    run: (ctx: McpCtx, args) =>
      runDeleteLabDocument(ctx.user.id, args as Parameters<typeof runDeleteLabDocument>[1]),
  },
  {
    def: LIST_PERSONAL_NOTES_TOOL,
    run: (ctx: McpCtx, args) =>
      runListPersonalNotes(ctx.user.id, args as Parameters<typeof runListPersonalNotes>[1]),
  },
  {
    def: GET_PERSONAL_NOTE_TOOL,
    run: (ctx: McpCtx, args) =>
      runGetPersonalNote(ctx.user.id, args as Parameters<typeof runGetPersonalNote>[1]),
  },
  {
    def: MANAGE_PERSONAL_NOTE_TOOL,
    run: (ctx: McpCtx, args) =>
      runManagePersonalNote(ctx.user.id, args as Parameters<typeof runManagePersonalNote>[1]),
  },
  {
    def: LIST_DOC_TAGS_TOOL,
    run: (ctx: McpCtx, args) =>
      runListDocTags(ctx.user.id, args as Parameters<typeof runListDocTags>[1]),
  },
  {
    def: MANAGE_DOC_TAGS_TOOL,
    run: (ctx: McpCtx, args) =>
      runManageDocTags(ctx.user.id, args as Parameters<typeof runManageDocTags>[1]),
  },
  {
    def: APPLY_DOC_TAG_TOOL,
    run: (ctx: McpCtx, args) =>
      runApplyDocTag(ctx.user.id, args as Parameters<typeof runApplyDocTag>[1]),
  },
  {
    def: LIST_COLLAB_VERSIONS_TOOL,
    run: (ctx: McpCtx, args) =>
      runListCollabVersions(ctx.user.id, args as Parameters<typeof runListCollabVersions>[1]),
  },
  {
    def: GET_COLLAB_VERSION_TOOL,
    run: (ctx: McpCtx, args) =>
      runGetCollabVersion(ctx.user.id, args as Parameters<typeof runGetCollabVersion>[1]),
  },
  {
    def: RESTORE_COLLAB_VERSION_TOOL,
    run: (ctx: McpCtx, args) =>
      runRestoreCollabVersion(ctx.user.id, args as Parameters<typeof runRestoreCollabVersion>[1]),
  },
  {
    def: MANAGE_COMMENT_TOOL_DEF,
    run: (ctx: McpCtx, args) =>
      runManageComment(ctx.user.id, args as Parameters<typeof runManageComment>[1]),
  },
  {
    def: MANAGE_PAGE_TOOL_DEF,
    run: (ctx: McpCtx, args) =>
      runManagePage(ctx.user.id, args as Parameters<typeof runManagePage>[1]),
  },
];
