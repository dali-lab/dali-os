import { redirect } from "react-router";
import type { Route } from "./+types/confidentiality-agreements";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, isAdmin } from "~/lib/roles";
import ConfidentialityAgreementsList from "~/components/ConfidentialityAgreements";

export const meta: Route.MetaFunction = () => [
  { title: "Confidentiality agreements · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const [hiringLead, domainLead, admin] = await Promise.all([
    isHiringLead(auth.user.sub),
    isDomainLead(auth.user.sub),
    isAdmin(auth.user.sub),
  ]);
  if (!hiringLead && !domainLead && !admin) return redirect("/");

  const agreements = await prisma.confidentialityAgreement.findMany({
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return { agreements, canEdit: hiringLead };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return { error: "Name is required" };
    const agreement = await prisma.confidentialityAgreement.create({
      data: { name },
    });
    return redirect(`/confidentiality-agreements/${agreement.id}`);
  }

  return null;
}

export default ConfidentialityAgreementsList;
