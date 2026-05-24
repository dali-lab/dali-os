import { redirect } from "react-router";
import type { Route } from "./+types/library";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isDomainLead, isAdmin } from "~/lib/roles";
import Library from "~/hiring/components/Library";

export const meta: Route.MetaFunction = () => [{ title: "Library · Hiring · DALI OS" }];

// Single home for the reusable hiring artifacts — challenges, rubrics, and
// confidentiality agreements — selected via pills. Each was its own list page;
// they share the same audience and CRUD shape, so they live behind one route
// and one loader/action keyed by an `entity` discriminator.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const [hiringLead, domainLead, admin] = await Promise.all([
    isCore(auth.user.sub),
    isDomainLead(auth.user.sub),
    isAdmin(auth.user.sub),
  ]);
  if (!hiringLead && !domainLead && !admin) return redirect("/");

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
    canEdit: hiringLead || domainLead || admin,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const [hiringLead, domainLead, admin] = await Promise.all([
    isCore(auth.user.sub),
    isDomainLead(auth.user.sub),
    isAdmin(auth.user.sub),
  ]);
  if (!hiringLead && !domainLead && !admin) return redirect("/");

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
