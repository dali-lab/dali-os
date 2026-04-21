import { verifyAccessToken } from "~/lib/auth";

/** Verify a JWT token for WebSocket authentication. Reuses the main app auth. */
export const verifyCollabToken = verifyAccessToken;
