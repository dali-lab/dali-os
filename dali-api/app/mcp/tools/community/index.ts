// MCP tool area: community — the Community gallery. Aggregated into
// app/mcp/registry.ts.

import type { McpTool } from "../../registry";
import {
  CREATE_GALLERY_UPLOAD_DEF,
  GET_GALLERY_POST_DEF,
  LIST_GALLERY_POSTS_DEF,
  MANAGE_GALLERY_POST_DEF,
  MODERATE_GALLERY_POST_DEF,
  runCreateGalleryUpload,
  runGetGalleryPost,
  runListGalleryPosts,
  runManageGalleryPost,
  runModerateGalleryPost,
} from "./gallery";

export const COMMUNITY_TOOLS: McpTool[] = [
  {
    def: LIST_GALLERY_POSTS_DEF,
    run: (ctx, args) => runListGalleryPosts(ctx, args as Parameters<typeof runListGalleryPosts>[1]),
  },
  {
    def: GET_GALLERY_POST_DEF,
    run: (ctx, args) => runGetGalleryPost(ctx, args as Parameters<typeof runGetGalleryPost>[1]),
  },
  {
    def: CREATE_GALLERY_UPLOAD_DEF,
    run: (ctx, args) =>
      runCreateGalleryUpload(ctx, args as Parameters<typeof runCreateGalleryUpload>[1]),
  },
  {
    def: MANAGE_GALLERY_POST_DEF,
    run: (ctx, args) => runManageGalleryPost(ctx, args as Parameters<typeof runManageGalleryPost>[1]),
  },
  {
    def: MODERATE_GALLERY_POST_DEF,
    run: (ctx, args) => runModerateGalleryPost(ctx, args as Parameters<typeof runModerateGalleryPost>[1]),
  },
];
