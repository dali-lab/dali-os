import { useLoaderData } from "react-router";
import type { Route } from "./+types/certificates.$certificateId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getCertificate } from "~/education/lib/certificates.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { formatDateShort } from "~/lib/display";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Certificate · ${data?.certificate.offeringTitle ?? "DALI"}` },
];

// Registered OUTSIDE the member layout (like /forms/fill/:token) so portal
// users can open their certificates without the member shell.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const certificate = await getCertificate(params.certificateId!);
  if (!certificate) throw new Response("Not found", { status: 404 });

  const isOwner = certificate.applicantUserId === auth.user.sub;
  if (!isOwner && !(await isOfferingManager(auth.user.sub, certificate.offeringId))) {
    throw new Response("Not found", { status: 404 });
  }

  return { certificate, isOwner };
}

export default function CertificatePage() {
  const { certificate } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-section-bg p-4 sm:p-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl flex flex-col gap-4">
        <div className="bg-card border-4 border-accent-coral rounded-lg p-10 sm:p-14 text-center shadow-brand-2 print:shadow-none">
          <div className="border border-dark-blue rounded-md p-8 sm:p-12">
            <p className="font-heading text-sm font-bold tracking-[0.3em] text-dark-blue">
              DALI LAB
            </p>
            <h1 className="mt-4 font-heading text-xl text-foreground">
              Certificate of Completion
            </h1>
            <p className="mt-8 text-sm italic text-muted-foreground">
              This certifies that
            </p>
            <p className="mt-2 font-heading text-4xl font-bold text-dark-blue">
              {certificate.studentName}
            </p>
            <p className="mt-6 text-sm italic text-muted-foreground">
              completed the {certificate.offeringType.toLowerCase()}
            </p>
            <p className="mt-2 font-heading text-2xl font-bold text-accent-coral">
              {certificate.offeringTitle}
            </p>
            <p className="mt-5 text-sm text-foreground">
              {certificate.startsAt && certificate.endsAt ? (
                <>
                  {formatDateShort(certificate.startsAt)} –{" "}
                  {formatDateShort(certificate.endsAt)}
                </>
              ) : null}
            </p>
            {certificate.instructorNames.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Taught by {certificate.instructorNames.join(", ")}
              </p>
            )}
            <p className="mt-8 text-xs text-muted-foreground">
              Issued {formatDateShort(certificate.issuedAt)}
            </p>
          </div>
        </div>

        {certificate.feedback && (
          <div className="bg-card border border-border rounded-lg p-5 print:hidden">
            <p className="text-xs font-semibold text-accent-teal">
              Instructor feedback
            </p>
            <p className="text-sm text-foreground whitespace-pre-wrap mt-1">
              {certificate.feedback}
            </p>
          </div>
        )}

        <div className="flex justify-center gap-3 print:hidden">
          <a
            href={`/education/certificates/${certificate.id}/pdf`}
            className={buttonClasses("primary", "sm")}
          >
            Download PDF
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className={buttonClasses("secondary", "sm")}
          >
            Print
          </button>
        </div>
      </div>
    </div>
  );
}
