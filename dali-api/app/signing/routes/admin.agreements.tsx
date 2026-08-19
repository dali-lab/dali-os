// Admin → Agreements: the document-signing template library. Core-gated (like
// Email Templates — any Core member authors agreements). Lists SigningDocuments
// and creates new ones; version authoring + binding lives on the detail page.

import { redirect } from "react-router";
import type { Route } from "./+types/admin.agreements";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { ensureCoreDriveRoot } from "~/lib/pages";
import type {
  SigningDocumentKind,
  SigningGateScope,
  SigningAudience,
  SigningCadence,
} from "~/generated/prisma/enums";
import { SigningDocumentsPage } from "~/signing/components/SigningDocumentsPage";
import { KINDS, SCOPES, AUDIENCES, CADENCES } from "~/signing/lib/document-config";

export const handle = coreHandle("agreements");

export const meta: Route.MetaFunction = () => [
  { title: "Agreements · Admin · DALI OS" },
];

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "agreement"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  // Bounded loop — appends -2, -3, … until free.
  while (await prisma.signingDocument.findUnique({ where: { slug }, select: { id: true } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore) return redirect("/");

  // The Drive is the only agreement authoring surface. Redirect the
  // /admin/agreements list to the Drive hub (filter=agreement) so the URL
  // changes but content is preserved. Path-keyed: only redirect when the request
  // is at the admin path — the documents/agreement re-export also calls this
  // loader, and we must not redirect in that case.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/admin/agreements")) {
    return redirect("/drive?type=agreement");
  }

  const documents = await prisma.signingDocument.findMany({
    where: { archivedAt: null },
    include: {
      versions: { select: { id: true, versionNumber: true, publishedAt: true } },
      bindings: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return { documents, isAdmin: roles.isAdmin };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return { error: "Name is required" };
    const kind = formData.get("kind") as SigningDocumentKind;
    const gateScope = formData.get("gateScope") as SigningGateScope;
    const audience = formData.get("audience") as SigningAudience;
    const cadence = formData.get("cadence") as SigningCadence;

    const doc = await prisma.signingDocument.create({
      data: {
        name,
        slug: await uniqueSlug(slugify(name)),
        kind: KINDS.includes(kind) ? kind : "General",
        gateScope: SCOPES.includes(gateScope) ? gateScope : "None",
        audience: AUDIENCES.includes(audience) ? audience : "Manual",
        cadence: CADENCES.includes(cadence) ? cadence : "Once",
      },
    });
    // File the new agreement into Core ▸ Agreements ▸ {kind} immediately (it's
    // created unplaced) so its Drive breadcrumb resolves without waiting for the
    // next Core-drive visit. Idempotent + best-effort — never block creation.
    await ensureCoreDriveRoot(auth.user.sub).catch(() => null);
    // Land on the Drive-namespaced route so the browser opens the agreement in
    // the Drive rather than the admin URL.
    return redirect(`/documents/agreement/${doc.id}`);
  }

  return null;
}

export default SigningDocumentsPage;
