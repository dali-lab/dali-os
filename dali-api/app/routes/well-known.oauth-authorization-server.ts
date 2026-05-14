// RFC 8414 OAuth 2.0 Authorization Server Metadata. Served at
// /.well-known/oauth-authorization-server. The path is registered explicitly
// in app/routes.ts (React Router 7 file-based naming doesn't reach the dot
// prefix without a manual entry).

import type { Route } from "./+types/well-known.oauth-authorization-server";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const issuer =
    process.env.API_BASE_URL ?? `${url.protocol}//${url.host}`;

  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:read", "mcp:write"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
