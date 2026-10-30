import { prisma } from "~/lib/db.server";

// Unguessable public token for a published form's external fill URL.
export function newPublicToken(): string {
  // 24 bytes of URL-safe randomness — collision-resistant, not enumerable.
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Publishing mints the link token on first publish and reuses it after, so a
// shared link stays valid; unpublishing keeps the token so a re-publish
// restores the same link. A managed form's feature passes clearWindow: the
// builder hides the schedule for managed forms, so a window set before the
// form was bound would otherwise flip it later with no way to see why.
export async function setFormPublished(
  formId: string,
  published: boolean,
  opts: { clearWindow?: boolean } = {},
): Promise<{ ok: true } | { error: string; status: number }> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { publicToken: true, _count: { select: { versions: true } } },
  });
  if (!form) return { error: "Not found", status: 404 };
  if (published && form._count.versions === 0)
    return {
      error: "Add at least one question version before publishing.",
      status: 400,
    };
  await prisma.form.update({
    where: { id: formId },
    data: {
      published,
      ...(published ? { publicToken: form.publicToken ?? newPublicToken() } : {}),
      ...(opts.clearWindow ? { opensAt: null, closesAt: null } : {}),
    },
  });
  return { ok: true };
}
