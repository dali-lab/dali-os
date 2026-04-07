import type { Route } from "./+types/auth.link-member";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";


export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { dartmouthEmail } = await request.Response.json();
  if (!dartmouthEmail || !dartmouthEmail.endsWith("@dartmouth.edu")) {
    return Response.json(
      { error: "A valid @dartmouth.edu email is required" },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({
    where: { dartmouthEmail },
  });
  if (existing && existing.id !== auth.user.sub) {
    return Response.json(
      { error: "This Dartmouth email is already linked to another account" },
      { status: 409 },
    );
  }

  const user = await prisma.user.update({
    where: { id: auth.user.sub },
    data: { dartmouthEmail },
  });

  return Response.json(user);
}
