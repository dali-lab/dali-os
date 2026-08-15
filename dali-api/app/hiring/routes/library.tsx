import { redirect } from "react-router";
import type { Route } from "./+types/library";
import { prisma } from "~/lib/db";
import { requireCoreOrDomainLead } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import Library from "~/hiring/components/Library";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Library · Hiring · DALI OS" }];

// Single home for the reusable hiring artifacts — challenges, rubrics, and
// confidentiality agreements — selected via pills. Each was its own list page;
// they share the same audience and CRUD shape, so they live behind one route
// and one loader/action keyed by an `entity` discriminator.
export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireCoreOrDomainLead(request);
  if (!gate.ok) return gate.response;

  const roles = await getUserRoles(gate.auth.user.sub);
  const [domains, rubrics, agreements] = await Promise.all([
    prisma.domain.findMany({ orderBy: { name: "asc" } }),
    prisma.rubric.findMany({
      include: {
        versions: {
          include: { createdBy: true },
          orderBy: { versionNumber: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.signingDocument.findMany({
      where: { kind: "Confidentiality", archivedAt: null },
      include: {
        versions: {
          include: { createdBy: true },
          orderBy: { versionNumber: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    domains,
    rubrics,
    agreements,
    canEdit: true,
    pillRoles: {
      isCore: roles.isCore,
      isDomainLead: roles.isDomainLead,
      isAdmin: roles.isAdmin,
      isInterviewer: roles.isInterviewer,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const gate = await requireCoreOrDomainLead(request);
  if (!gate.ok) return gate.response;

  const formData = await request.formData();
  const entity = formData.get("entity") as string;
  const intent = formData.get("intent") as string;

  if (entity === "rubric") {
    if (intent === "create") {
      const name = (formData.get("name") as string)?.trim();
      if (!name) return { error: "Name is required" };
      const rubric = await prisma.rubric.create({ data: { name } });
      return redirect(`/hiring/rubrics/${rubric.id}`);
    }
    return null;
  }

  if (entity === "agreement") {
    if (intent === "create") {
      const name = (formData.get("name") as string)?.trim();
      if (!name) return { error: "Name is required" };
      // Confidentiality agreements are now SigningDocuments (kind
      // Confidentiality), gated to hiring cycles.
      const base =
        "confidentiality-" +
        (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) ||
          "agreement");
      let slug = base;
      let n = 1;
      while (await prisma.signingDocument.findUnique({ where: { slug }, select: { id: true } })) {
        n += 1;
        slug = `${base}-${n}`;
      }
      const agreement = await prisma.signingDocument.create({
        data: {
          name,
          slug,
          kind: "Confidentiality",
          gateScope: "HiringCycle",
          audience: "HiringParticipants",
        },
      });
      return redirect(`/hiring/confidentiality-agreements/${agreement.id}`);
    }
    return null;
  }

  return null;
}

export default Library;
