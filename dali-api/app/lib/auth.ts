import { SignJWT, jwtVerify } from "jose";
import { parseAccessToken } from "~/lib/cookies";
import { logAuditEvent } from "~/lib/audit";

// jwt helper functions

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(payload: {
  sub: string;
  email: string;
  type: string;
  firstName?: string;
  lastName?: string;
}) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as {
    sub: string;
    email: string;
    type: string;
    firstName?: string;
    lastName?: string;
  };
}

// auth middleware

type AuthSuccess = {
  ok: true;
  user: {
    sub: string;
    email: string;
    type: string;
    firstName?: string;
    lastName?: string;
  };
};
type AuthFailure = { ok: false; response: Response };
export type AuthResult = AuthSuccess | AuthFailure;

export async function requireAuth(request: Request): Promise<AuthResult> {
  // try cookie first, fall back to authorization header if not present
  let token = parseAccessToken(request);

  // don't strictly need this yet but good to have support if we want to support API access later
  if (!token) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  try {
    const user = await verifyAccessToken(token);
    return { ok: true, user };
  } catch {
    // Only log when a token was presented but failed to verify — logging every
    // missing-cookie request would flood the audit table with normal
    // unauthenticated traffic.
    await logAuditEvent({
      action: "auth.token.invalid",
      request,
    });
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    };
  }
}

// dartmouth cas (sso) ticket validation

export async function validateCasTicket(ticket: string, serviceUrl: string) {
  const casBase = process.env.CAS_BASE_URL ?? "https://login.dartmouth.edu/cas";
  const url = `${casBase}/serviceValidate?ticket=${encodeURIComponent(ticket)}&service=${encodeURIComponent(serviceUrl)}`;

  const res = await fetch(url);
  const xml = await res.text();

  const userMatch = xml.match(/<cas:user>([^<]+)<\/cas:user>/);
  if (!userMatch) throw new Error("CAS authentication failed");

  const netIdMatch = xml.match(/<cas:netid>([^<]+)<\/cas:netid>/);
  const nameMatch = xml.match(/<cas:name>([^<]+)<\/cas:name>/);

  const netId = netIdMatch?.[1] ?? userMatch[1].trim();
  const fullName = nameMatch?.[1]?.trim() ?? "";

  const nameParts = fullName.split(" ");
  const firstName = nameParts[0] || netId;
  const lastName = nameParts.length > 1 ? nameParts.slice(-1)[0] : "";

  return { netId, firstName, lastName };
}
