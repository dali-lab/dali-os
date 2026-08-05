// Re-export of the canonical MCP errors from the leaf module, under the Admin*
// names this directory's tool files import. requireForAction passes through
// unchanged.
export {
  McpError as AdminMcpError,
  McpForbiddenError as AdminForbiddenError,
  McpNotFoundError as AdminNotFoundError,
  McpInvalidError as AdminInvalidError,
  requireForAction,
} from "../../errors";
