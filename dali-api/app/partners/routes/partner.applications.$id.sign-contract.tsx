import { Link, redirect, useLoaderData } from "react-router";
import { Download, ShieldCheck } from "lucide-react";
import type { Route } from "./+types/partner.applications.$id.sign-contract";
import { prisma } from "~/lib/db";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { collectSigningFields } from "~/lib/signing-fields";
import { recordSignature } from "~/signing/lib/sign.server";
import { resolvePartnerContractVariables } from "~/signing/lib/variables.server";
import { SigningFillView } from "~/signing/components/SigningFillView";
import { partnerContractSignature } from "~/partners/lib/partner-contract.server";
import { notifyPartnerApplicationEvent } from "~/partners/lib/partner-emails.server";
import { buttonClasses } from "~/components/ui/Button";
import { PartnerBackLink } from "~/partners/components/PartnerBackLink";

export const meta: Route.MetaFunction = () => [{ title: "Sign contract · DALI OS" }];

// Loads the application (scoped to the signed-in partner) + its contract binding.
async function loadScoped(request: Request, id: string) {
  const { auth, partnerUser } = await requirePartnerAccount(request);
  const application = await prisma.partnerApplication.findFirst({
    where: {
      id,
      OR: [
        { applicantUserId: auth.user.sub },
        ...(partnerUser ? [{ partnerOrgId: partnerUser.partnerOrgId }] : []),
      ],
    },
    select: {
      id: true,
      title: true,
      contractBindingId: true,
      contractSentAt: true,
    },
  });
  return { auth, application };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, application } = await loadScoped(request, params.id!);
  if (!application) throw new Response("Not found", { status: 404 });
  if (!application.contractBindingId || !application.contractSentAt) {
    return redirect(`/partner/applications/${application.id}`);
  }

  const binding = await prisma.signingBinding.findUnique({
    where: { id: application.contractBindingId },
    select: { id: true, version: { select: { body: true } } },
  });
  if (!binding) return redirect(`/partner/applications/${application.id}`);

  const already = await partnerContractSignature(binding.id, auth.user.sub);
  if (already) {
    return {
      applicationId: application.id,
      title: application.title,
      signed: {
        typedName: already.typedName,
        at: already.signedAt.toISOString(),
      },
      body: null,
      variables: {} as Record<string, string>,
      fields: [],
      next: `/partner/applications/${application.id}`,
    };
  }

  const body = ensureBlocks(binding.version.body);
  const fields = collectSigningFields(body);
  const variables = await resolvePartnerContractVariables(
    application.id,
    auth.user.sub,
  );
  return {
    applicationId: application.id,
    title: application.title,
    signed: null,
    body,
    variables,
    fields,
    next: `/partner/applications/${application.id}`,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { auth, application } = await loadScoped(request, params.id!);
  if (!application?.contractBindingId) {
    throw new Response("Not found", { status: 404 });
  }
  const form = await request.formData();
  if ((form.get("intent") as string) !== "sign") return null;

  let fieldValues: Record<string, unknown> = {};
  try {
    fieldValues = JSON.parse((form.get("fieldValues") as string) || "{}");
  } catch {
    return { error: "Could not read your inputs — please try again." };
  }

  const variables = await resolvePartnerContractVariables(
    application.id,
    auth.user.sub,
  );
  const result = await recordSignature({
    bindingId: application.contractBindingId,
    signerUserId: auth.user.sub,
    fieldValues,
    request,
    variables,
  });
  if (!result.ok) return { error: result.error };

  // Mirror the signed state onto the application for quick portal display.
  const sig = await partnerContractSignature(
    application.contractBindingId,
    auth.user.sub,
  );
  await prisma.partnerApplication.update({
    where: { id: application.id },
    data: {
      contractSignedAt: sig?.signedAt ?? new Date(),
      contractSignerName: sig?.typedName ?? null,
    },
  });
  void notifyPartnerApplicationEvent(application.id, {
    kind: "contract-signed",
    signerName: sig?.typedName ?? "",
  }).catch((e) => console.error("partner contract-signed notify failed", e));

  return redirect(`/partner/applications/${application.id}`);
}

export default function PartnerSignContract({ actionData }: Route.ComponentProps) {
  const data = useLoaderData<typeof loader>();
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <div>
        <PartnerBackLink
          to={`/partner/applications/${data.applicationId}`}
          label="Back to application"
        />
        <h1 className="font-heading text-3xl font-bold text-dark-blue mt-2">
          {data.title} — Contract
        </h1>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      {data.signed ? (
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-3">
          <p className="text-sm text-accent-teal flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Signed by {data.signed.typedName} on{" "}
            {new Date(data.signed.at).toLocaleDateString()}.
          </p>
          <a
            href={`/partner/applications/${data.applicationId}/contract.pdf`}
            className={buttonClasses("secondary", "sm", "self-start")}
          >
            <Download className="w-4 h-4" />
            Download signed contract (PDF)
          </a>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Please read the agreement below and complete your fields to sign.
          </p>
          <div className="bg-card border border-border rounded-2xl p-6">
            <SigningFillView
              body={data.body}
              variables={data.variables}
              fields={data.fields}
              next={data.next}
            />
          </div>
        </>
      )}
    </div>
  );
}
