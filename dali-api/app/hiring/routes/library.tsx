import { redirect } from "react-router";
import type { Route } from "./+types/library";
import { prisma } from "~/lib/db";
import { requireCoreOrDomainLead } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import Library from "~/hiring/components/Library";

export const meta: Route.MetaFunction = () => [{ title: "Library · Hiring · DALI OS" }];

// Single home for the reusable hiring artifacts — challenges, rubrics, and
// confidentiality agreements — selected via pills. Each was its own list page;
// they share the same audience and CRUD shape, so they live behind one route
// and one loader/action keyed by an `entity` discriminator.
export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireCoreOrDomainLead(request);
  if (!gate.ok) return gate.response;

  const roles = await getUserRoles(gate.auth.user.sub);
  const [domains, challenges, rubrics, agreements] = await Promise.all([
    prisma.domain.findMany({ orderBy: { name: "asc" } }),
    prisma.challenge.findMany({
      include: {
        versions: {
          include: { domain: true, createdBy: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rubric.findMany({
      include: {
        versions: {
          include: { createdBy: true },
          orderBy: { versionNumber: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.confidentialityAgreement.findMany({
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
    challenges,
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

  if (entity === "challenge") {
    if (intent === "create") {
      const name = (formData.get("name") as string)?.trim();
      const domainId = formData.get("domainId") as string | null;
      const isGeneral = formData.get("general") === "1";
      if (!name) return { error: "Name is required" };

      const challenge = await prisma.challenge.create({ data: { name } });
      const dest = isGeneral
        ? `/hiring/challenges/${challenge.id}?general=1`
        : domainId
          ? `/hiring/challenges/${challenge.id}?domainId=${domainId}`
          : `/hiring/challenges/${challenge.id}`;
      return redirect(dest);
    }
    if (intent === "delete") {
      const id = formData.get("id") as string;
      // Delete all versions first (cascade not set in schema).
      await prisma.challengeVersion.deleteMany({ where: { challengeId: id } });
      await prisma.challenge.delete({ where: { id } });
      return null;
    }
    return null;
  }

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
      const agreement = await prisma.confidentialityAgreement.create({
        data: { name },
      });
      return redirect(`/hiring/confidentiality-agreements/${agreement.id}`);
    }
    return null;
  }

  return null;
}

export default Library;
