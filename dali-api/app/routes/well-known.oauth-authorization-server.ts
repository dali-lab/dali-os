// RFC 8414 OAuth 2.0 Authorization Server Metadata. Served at
// /.well-known/oauth-authorization-server. The path is registered explicitly
// in app/routes.ts (React Router 7 file-based naming doesn't reach the dot
// prefix without a manual entry).

import { MCP_SCOPES } from "~/lib/mcp-scopes";
import { getOAuthIssuer } from "~/lib/app-env";
import type { Route } from "./+types/well-known.oauth-authorization-server";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const issuer = getOAuthIssuer(request);

  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [...MCP_SCOPES],
      token_endpoint_auth_methods_supported: ["none"],
      // RFC 9207. We return `iss` on every authorization response, which is
      // what lets ChatGPT use its one stable connector callback instead of
      // minting a per-connection callback id we would have to allowlist by
      // hand for every new connection.
      authorization_response_iss_parameter_supported: true,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
