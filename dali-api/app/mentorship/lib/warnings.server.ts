import { isCore } from "~/lib/roles";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { redirect } from "react-router";

/** Warnings are Core/Admin only (the same `isCore` the rest of Mentorship uses
 *  for write access). Every loader and action goes through this; mentors and
 *  mentees get a 403 even with the URL. */
export async function requireWarningsAdmin(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");
  if (!(await isCore(auth.user.sub))) throw new Response("Forbidden", { status: 403 });
  return auth.user.sub;
}
