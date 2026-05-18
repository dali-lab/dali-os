// RFC 9728 OAuth 2.0 Protected Resource Metadata for the MCP endpoint.
// Served at both /.well-known/oauth-protected-resource and
// /.well-known/oauth-protected-resource/mcp — MCP clients probe both
// before falling back to AS metadata.

import type { Route } from "./+types/well-known.oauth-protected-resource";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const issuer = process.env.API_BASE_URL ?? `${url.protocol}//${url.host}`;

  return Response.json(
    {
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      scopes_supported: ["mcp:read", "mcp:write"],
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
