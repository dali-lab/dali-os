import type { Route } from "./+types/api.email.contacts";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";

// GET /api/email/contacts?q=...
// Recipient autocomplete for the Email composer: lab members whose name or
// DALI / Dartmouth address starts with each typed word ("ada lo" → Ada
// Lovelace). Prefix-only, at least two characters, capped small — the
// composer debounces and caches, so this stays a cheap bounded lookup.

const LIMIT = 8;
const MIN_CHARS = 2;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  if (!(await isLabMember(userId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < MIN_CHARS) return Response.json({ contacts: [] });

  const words = q.split(/\s+/).slice(0, 3);
  const rows = await prisma.user.findMany({
    where: {
      ...LAB_MEMBER_WHERE,
      OR: [{ daliEmail: { not: null } }, { dartmouthEmail: { not: null } }],
      AND: words.map((w) => ({
        OR: [
          { firstName: { startsWith: w, mode: "insensitive" as const } },
          { lastName: { startsWith: w, mode: "insensitive" as const } },
          { daliEmail: { startsWith: w, mode: "insensitive" as const } },
          { dartmouthEmail: { startsWith: w, mode: "insensitive" as const } },
        ],
      })),
    },
    select: { firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: LIMIT,
  });

  const contacts = rows.map((u) => ({
    name: `${u.firstName} ${u.lastName}`.trim(),
    address: (u.daliEmail ?? u.dartmouthEmail)!,
  }));
  return Response.json({ contacts });
}
