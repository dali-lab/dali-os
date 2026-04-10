import type { Route } from "./+types/auth.link-member";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";


export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const { dartmouthEmail } = await request.json();
  if (!dartmouthEmail || !dartmouthEmail.endsWith("@dartmouth.edu")) {
    return withCors(request, Response.json(
      { error: "A valid @dartmouth.edu email is required" },
      { status: 400 },
    ));
  }

  const existing = await prisma.user.findUnique({
    where: { dartmouthEmail },
  });
  if (existing && existing.id !== auth.user.sub) {
    return withCors(request, Response.json(
      { error: "This Dartmouth email is already linked to another account" },
      { status: 409 },
    ));
  }

  const user = await prisma.user.update({
    where: { id: auth.user.sub },
    data: { dartmouthEmail },
  });

  return withCors(request, Response.json(user));
}
