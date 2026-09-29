// The OAuth scopes the MCP server issues — one list for dynamic registration
// and both metadata documents. MCP clients build their authorization request
// from `scopes_supported`, so a scope missing there is never requested. That
// is how mcp:admin went unrequested, and the admin tools unusable, from every
// connector while the metadata hard-coded read/write.
//
// mcp:admin is only granted to Core/Admin users (oauth.consent.tsx), and every
// admin tool re-checks the role when called.
export const MCP_SCOPES = ["mcp:read", "mcp:write", "mcp:admin"] as const;
