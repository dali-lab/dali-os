import { redirect } from "react-router";
import type { Route } from "./+types/confidentiality-agreements.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isDomainLead, isAdmin } from "~/lib/roles";
import { ConfidentialityAgreementDetail } from "~/hiring/components/ConfidentialityAgreementDetail";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.agreement?.name;
  return [{ title: `${name || "Confidentiality agreement"} · DALI OS` }];
};

export const handle = {
  // The Library owns confidentiality agreements (list at
  // /hiring/library?tab=agreements); the bare prefix has no page.
  breadcrumbTrail: (data: unknown) => {
    const name = (data as { agreement?: { name?: string } } | undefined)
      ?.agreement?.name;
    return [
      { label: "Hiring", to: "/hiring" },
      { label: "Confidentiality", to: "/hiring/library?tab=agreements" },
      { label: name || "Agreement" },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const [hiringLead, domainLead, admin] = await Promise.all([
    isCore(auth.user.sub),
    isDomainLead(auth.user.sub),
    isAdmin(auth.user.sub),
  ]);
  if (!hiringLead && !domainLead && !admin) return redirect("/");

  const agreement = await prisma.confidentialityAgreement.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: "desc" },
      },
    },
  });

  return { agreement, canEdit: hiringLead || domainLead || admin };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const [hiringLead, domainLead, admin] = await Promise.all([
    isCore(auth.user.sub),
    isDomainLead(auth.user.sub),
    isAdmin(auth.user.sub),
  ]);
  if (!hiringLead && !domainLead && !admin) return redirect("/");

  const member = await prisma.dALIMember.findUnique({
    where: { userId: auth.user.sub },
  });
  if (!member) return redirect("/login");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-version") {
    const bodyRaw = formData.get("body") as string;
    let body: unknown;
    try {
      body = JSON.parse(bodyRaw);
    } catch {
      return { error: "Body must be valid JSON" };
    }

    const lastVersion = await prisma.confidentialityAgreementVersion.findFirst({
      where: { agreementId: params.id },
      orderBy: { versionNumber: "desc" },
    });
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    await prisma.confidentialityAgreementVersion.create({
      data: {
        agreementId: params.id,
        versionNumber,
        body: body as any,
        createdById: auth.user.sub,
      },
    });

    return redirect(`/hiring/confidentiality-agreements/${params.id}`);
  }

  if (intent === "rename") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return { error: "Name is required" };
    await prisma.confidentialityAgreement.update({
      where: { id: params.id },
      data: { name },
    });
    return redirect(`/hiring/confidentiality-agreements/${params.id}`);
  }

  return null;
}

export default ConfidentialityAgreementDetail;
