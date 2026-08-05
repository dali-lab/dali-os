// RFC 7591 OAuth 2.0 Dynamic Client Registration.
//
// MCP clients (Claude Code, etc.) don't know our `client_id` ahead of time,
// so the spec requires a registration endpoint they can POST to. We accept
// the minimal request shape, but the resulting OAuthClient row is locked to
// the MCP-only policy: google-only IDP, member-only accountType, membership
// required, mcp:read/mcp:write scopes. Redirect URIs are limited to http
// loopback (Claude Code / Desktop-local) or an https callback on an allowed
// Claude host (claude.ai web / mobile). None of the client-supplied policy
// fields are honored — only redirect_uris + client_name.

import type { Route } from "./+types/oauth.register";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight, preflightLoader } from "~/lib/cors";
import { checkRateLimit, getClientIp } from "~/lib/rate-limit";
import { safeJson } from "~/lib/safe-json";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// mcp:admin is offered to any client, but only *granted* at consent when the
// consenting user is Core/Admin (role-gated in oauth.consent.tsx); every admin
// tool also re-checks the role at call time. See specs/mcp-expansion.md §3.
const ALLOWED_SCOPES = ["mcp:read", "mcp:write", "mcp:admin"];

export const loader = preflightLoader;

interface RegistrationRequest {
  redirect_uris?: unknown;
  client_name?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
}

function badRequest(error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    { status: 400 },
  );
}

function isLoopbackRedirect(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    return false;
  }
  return true;
}

// Claude's hosted MCP surfaces (claude.ai web, mobile, desktop connectors)
// register a fixed https callback rather than a loopback URI — the loopback
// model only fits locally-run clients (Claude Code / Desktop-local). Accept an
// https redirect whose host is an Anthropic-controlled registrable domain, or a
// subdomain of one. Overridable via MCP_ALLOWED_REDIRECT_HOSTS (comma-separated)
// so a new Claude surface host can be allowed without a redeploy.
const DEFAULT_TRUSTED_REDIRECT_HOSTS = ["claude.ai", "claude.com"];

function trustedRedirectHosts(): string[] {
  const raw = process.env.MCP_ALLOWED_REDIRECT_HOSTS;
  if (!raw) return DEFAULT_TRUSTED_REDIRECT_HOSTS;
  const hosts = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length ? hosts : DEFAULT_TRUSTED_REDIRECT_HOSTS;
}

function isTrustedHttpsRedirect(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return trustedRedirectHosts().some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const ip = getClientIp(request);
  const limited = checkRateLimit(
    request,
    { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS },
    `register:${ip}`,
  );
  if (limited) return withCors(request, limited);

  const body = await safeJson<RegistrationRequest>(request);
  if (body instanceof Response) return withCors(request, body);

  // redirect_uris: required, non-empty array of loopback URIs.
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return withCors(
      request,
      badRequest(
        "invalid_redirect_uri",
        "redirect_uris must be a non-empty array",
      ),
    );
  }
  const redirectUris: string[] = [];
  for (const uri of body.redirect_uris) {
    if (
      typeof uri !== "string" ||
      !(isLoopbackRedirect(uri) || isTrustedHttpsRedirect(uri))
    ) {
      return withCors(
        request,
        badRequest(
          "invalid_redirect_uri",
          "redirect_uris must be http loopback (127.0.0.1 or localhost) or an https callback on an allowed Claude host",
        ),
      );
    }
    redirectUris.push(uri);
  }

  // Loopback clients get RFC 8252 port-agnostic matching at authorize time;
  // hosted-https clients (Claude's web/mobile surfaces) get exact-match only.
  const isLoopback = redirectUris.every(isLoopbackRedirect);

  // token_endpoint_auth_method: only "none" (public client) is supported.
  const authMethod = body.token_endpoint_auth_method ?? "none";
  if (authMethod !== "none") {
    return withCors(
      request,
      badRequest(
        "invalid_client_metadata",
        "token_endpoint_auth_method must be 'none'",
      ),
    );
  }

  // grant_types: must include "authorization_code" if present. Other entries
  // (e.g. "refresh_token", which Claude Code's MCP SDK sends by default) are
  // allowed but ignored — we only support authorization_code. Per RFC 7591 §2
  // the server MAY reject unsupported metadata, but intersecting with what we
  // support is friendlier and equally safe since we echo back only what's
  // actually honored.
  if (body.grant_types !== undefined) {
    if (
      !Array.isArray(body.grant_types) ||
      !body.grant_types.includes("authorization_code")
    ) {
      return withCors(
        request,
        badRequest(
          "invalid_client_metadata",
          "grant_types must include 'authorization_code'",
        ),
      );
    }
  }

  // response_types: must include "code" if present. Other entries ignored.
  if (body.response_types !== undefined) {
    if (
      !Array.isArray(body.response_types) ||
      !body.response_types.includes("code")
    ) {
      return withCors(
        request,
        badRequest(
          "invalid_client_metadata",
          "response_types must include 'code'",
        ),
      );
    }
  }

  const clientName =
    typeof body.client_name === "string" && body.client_name.trim().length > 0
      ? body.client_name.trim().slice(0, 200)
      : "MCP Client";

  // Use the cuid generated by the OAuthClient model as both `id` and the
  // public `clientId` value. Stable, opaque, collision-free.
  const created = await prisma.oAuthClient.create({
    data: {
      // clientId is set by a follow-up update after we know `id`.
      clientId: "pending",
      name: clientName,
      redirectUris,
      isLoopback,
      isFirstParty: false,
      allowedScopes: ALLOWED_SCOPES,
      allowedProviders: ["google"],
      requiredAccountType: "member",
      requireMembership: true,
    },
  });
  const updated = await prisma.oAuthClient.update({
    where: { id: created.id },
    data: { clientId: created.id },
  });

  const issuedAt = Math.floor(updated.createdAt.getTime() / 1000);

  return withCors(
    request,
    Response.json(
      {
        client_id: updated.clientId,
        client_name: updated.name,
        redirect_uris: updated.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        scope: ALLOWED_SCOPES.join(" "),
        client_id_issued_at: issuedAt,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      },
    ),
  );
}
