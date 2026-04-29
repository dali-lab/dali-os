import { redirect } from "react-router";
import type { Route } from "./+types/confidentiality-agreements.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { ConfidentialityAgreementDetail } from "~/components/ConfidentialityAgreementDetail";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.agreement?.name;
  return [{ title: `${name || "Confidentiality agreement"} · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");

  const agreement = await prisma.confidentialityAgreement.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: "desc" },
      },
    },
  });

  return { agreement };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");

  const member = await prisma.dALIMember.findFirst({
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
        createdById: member.id,
      },
    });

    return redirect(`/confidentiality-agreements/${params.id}`);
  }

  if (intent === "rename") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return { error: "Name is required" };
    await prisma.confidentialityAgreement.update({
      where: { id: params.id },
      data: { name },
    });
    return redirect(`/confidentiality-agreements/${params.id}`);
  }

  return null;
}

export default ConfidentialityAgreementDetail;
