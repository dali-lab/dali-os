import type { Route } from "./+types/certificates.$certificateId.pdf";
import { requireAuth } from "~/lib/auth";
import { getCertificate } from "~/education/lib/certificates.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { renderCertificatePdf } from "~/education/lib/certificate-pdf.server";

// Resource route (outside the app layout so the Response streams as a bare
// PDF body). Same access gate as the certificate page.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });

  const certificate = await getCertificate(params.certificateId!);
  if (!certificate) return new Response("Not found", { status: 404 });

  const isOwner = certificate.applicantUserId === auth.user.sub;
  if (!isOwner && !(await isOfferingManager(auth.user.sub, certificate.offeringId))) {
    return new Response("Not found", { status: 404 });
  }

  const pdf = await renderCertificatePdf(certificate);
  const safeTitle =
    certificate.offeringTitle.replace(/[^A-Za-z0-9 ._-]/g, "").trim().replace(/\s+/g, "_") ||
    "certificate";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="DALI_${safeTitle}.pdf"`,
    },
  });
}
