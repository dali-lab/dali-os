// Partner-portal contract signing. Parallel to app/signing/routes/sign.
// $bindingId.tsx, but gated by contact ownership (requirePartnerAccount)
// instead of the generic member-audience cohort check — a partner contact is
// a one-off recipient (scopeKey `partner-app:<id>`), never a member of
// SigningAudience's NewMembers/Members/Mentors/HiringParticipants/Group
// cohorts, so the generic /sign/:bindingId route would always redirect them
// away (see partner-contract.server.ts's header comment).

import { redirect, Link, useLoaderData, useActionData } from "react-router";
import { ShieldCheck, Download } from "lucide-react";
import type { Route } from "./+types/partner.applications.$id.sign-contract";
import { prisma } from "~/lib/db";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { collectSigningFields } from "~/lib/signing-fields";
import { recordSignature } from "~/signing/lib/sign.server";
import {
  partnerContractStatus,
  resolvePartnerContractVariables,
  onPartnerContractSigned,
} from "~/partners/lib/partner-contract.server";
import { SigningFillView } from "~/signing/components/SigningFillView";

export const meta: Route.MetaFunction = ({ data }) => {
  const title = (data as { title?: string } | undefined)?.title;
  return [{ title: title ? `Sign contract · ${title} · DALI OS` : "Sign contract · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const ctx = await requirePartnerAccount(request);

  // Scoped by contact — another contact's application (or wrong contact
  // entirely) 404s, never 403, matching the rest of the portal.
  const application = await prisma.partnerApplication.findFirst({
    where: { id: params.id, applicantContactId: ctx.contact.id },
    select: { id: true, title: true, contractBindingId: true },
  });
  if (!application?.contractBindingId) throw new Response("Not found", { status: 404 });

  const binding = await prisma.signingBinding.findUnique({
    where: { id: application.contractBindingId },
    select: {
      id: true,
      versionId: true,
      version: { select: { body: true } },
      signatures: {
        where: { signerUserId: ctx.contact.userId, roleKey: "member" },
        select: { versionId: true },
      },
    },
  });
  if (!binding) throw new Response("Not found", { status: 404 });

  const signed = binding.signatures.some((s) => s.versionId === binding.versionId);
  const body = ensureBlocks(binding.version.body);
  const variables = await resolvePartnerContractVariables(application.id);

  return {
    applicationId: application.id,
    title: application.title,
    bindingId: binding.id,
    body,
    fields: collectSigningFields(body),
    variables,
    signed,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const ctx = await requirePartnerAccount(request);
  const application = await prisma.partnerApplication.findFirst({
    where: { id: params.id, applicantContactId: ctx.contact.id },
    select: { id: true, contractBindingId: true },
  });
  if (!application?.contractBindingId) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  if ((form.get("intent") as string | null) !== "sign") return { error: "Unknown action." };

  let fieldValues: Record<string, unknown> = {};
  try {
    fieldValues = JSON.parse((form.get("fieldValues") as string) || "{}");
  } catch {
    return { error: "Could not read your inputs. Please try again." };
  }

  const status = await partnerContractStatus(application.id);
  if (status.state === "Signed") {
    return { error: "You've already signed this contract." };
  }

  const variables = await resolvePartnerContractVariables(application.id);
  const result = await recordSignature({
    bindingId: application.contractBindingId,
    signerUserId: ctx.contact.userId,
    fieldValues,
    request,
    roleKey: "member",
    variables,
  });
  if (!result.ok) return { error: result.error };

  await onPartnerContractSigned({
    applicationId: application.id,
    bindingId: application.contractBindingId,
  });

  return redirect(`/partner/applications/${application.id}/sign-contract`);
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function SignPartnerContract() {
  const data = useLoaderData() as LoaderData;
  const actionData = useActionData<typeof action>();
  const error = actionData && "error" in actionData ? actionData.error : null;

  if (data.signed) {
    return (
      <div className="max-w-3xl mx-auto py-10 space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-accent-teal" />
          <h1 className="text-2xl font-bold text-foreground">You signed the contract for {data.title}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Thanks for signing. A copy has been emailed to you and is available to download below.
        </p>
        <div className="flex items-center gap-3">
          <a
            href={`/sign/${data.bindingId}/pdf`}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-md text-foreground bg-card border border-border hover:bg-muted/50"
          >
            <Download className="h-4 w-4" /> Download PDF
          </a>
          <Link
            to={`/partner/applications/${data.applicationId}`}
            className="text-sm text-accent-coral hover:underline"
          >
            Back to your application
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-10 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">{data.title}</h1>
      <p className="text-sm text-muted-foreground">
        Please read the contract below and complete your fields to sign.
      </p>
      <SigningFillView
        body={data.body}
        variables={data.variables}
        fields={data.fields}
        next={null}
        error={error}
        signerRole="member"
      />
    </div>
  );
}
