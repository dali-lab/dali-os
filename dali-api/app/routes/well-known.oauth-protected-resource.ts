// RFC 9728 OAuth 2.0 Protected Resource Metadata for the MCP endpoint.
// Served at both /.well-known/oauth-protected-resource and
// /.well-known/oauth-protected-resource/mcp — MCP clients probe both
// before falling back to AS metadata.

import { MCP_SCOPES } from "~/lib/mcp-scopes";
import { getOAuthIssuer } from "~/lib/app-env";
import type { Route } from "./+types/well-known.oauth-protected-resource";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  // Same issuer string as the AS metadata: a client that resolves us through
  // `authorization_servers` compares it to that document's `issuer` exactly.
  const issuer = getOAuthIssuer(request);

  return Response.json(
    {
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ["header"],
      resource_documentation: `${issuer}/help/mcp`,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
