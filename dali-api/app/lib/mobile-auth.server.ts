import { requireAuth, type AuthSuccess } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";

export type MobileAuthResult =
  | { ok: true; auth: AuthSuccess; userId: string }
  | { ok: false; response: Response };

export function mobileError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function mobileJson(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

export async function requireMobileUser(request: Request): Promise<MobileAuthResult> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const roles = await getUserRoles(auth.user.sub, request);
  if (!roles.isLabMember) return { ok: false, response: mobileError("Not found", 404) };
  return { ok: true, auth, userId: auth.user.sub };
}
