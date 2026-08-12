import { redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/drive.hub";
import {
  HardDrive,
  FileText,
  ClipboardList,
  FileSignature,
  LayoutTemplate,
  CheckCircle2,
  Download,
  ExternalLink,
} from "lucide-react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewForms as checkCanViewForms } from "~/lib/roles";
import { loadFormsLevel } from "~/forms/lib/forms-data";
import { FormsBrowser } from "~/forms/components/FormsBrowser";
import { loader as docsLoader, DocumentsHubBody } from "~/routes/documents.hub";
import { listMySignedDocuments } from "~/signing/lib/state.server";
import { loadTemplates } from "~/lib/drive-templates.server";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import type { TemplateKind, TemplateItem } from "~/lib/drive-templates.server";
import { Link } from "react-router";

export const meta: Route.MetaFunction = () => [{ title: "Drive · DALI OS" }];

// The unified Drive hub, surfaced when the drive-consolidation feature flag is
// on. Presents the existing Documents hub and Forms browser as two lenses
// (selected via ?lens=) inside a single route, without altering the underlying
// /documents and /forms routes. Wave 4 adds two read-only lenses: Agreements
// (the viewer's own signed lab documents) and Templates (aggregated view over
// all five template systems). When the flag is off, /drive is not linked from
// the nav and navigating here redirects to /documents.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const userCanViewForms = await checkCanViewForms(auth.user.sub);

  // Delegate to the existing documents loader so the docs lens is always
  // identical to /documents. The loader does its own auth check (cached for
  // the request), so the double call is free in practice.
  const docsResult = await docsLoader({ request } as Parameters<typeof docsLoader>[0]);
  // Surface any redirect the docs loader produces (e.g., re-auth).
  if (docsResult instanceof Response) return docsResult;

  // Load top-level forms data only when the user can see forms.
  const formsData = userCanViewForms ? await loadFormsLevel(null) : null;

  // Agreements — always loaded (the viewer only ever sees their own).
  const signedDocs = await listMySignedDocuments(auth.user.sub);

  // Templates — load for all viewers; loadTemplates gates each category
  // internally and returns only what the viewer is allowed to see.
  const templatesData = await loadTemplates(auth.user.sub);

  return {
    docsData: docsResult,
    formsData,
    canViewForms: userCanViewForms,
    signedDocs,
    templatesData,
  };
}

type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;

const KIND_LABELS: Record<TemplateKind, string> = {
  page: "Document templates",
  form: "Form drafts",
  mentorNote: "Mentor note templates",
  email: "Email templates",
  signing: "Agreement templates",
};

function TemplatesLens({ templatesData }: { templatesData: LoaderData["templatesData"] }) {
  const { items } = templatesData;

  // Group by kind, preserving a stable display order.
  const ORDER: TemplateKind[] = ["page", "form", "mentorNote", "email", "signing"];
  const byKind: Partial<Record<TemplateKind, TemplateItem[]>> = {};
  for (const item of items) {
    (byKind[item.kind] ??= []).push(item);
  }

  const populated = ORDER.filter((k) => (byKind[k]?.length ?? 0) > 0);

  if (populated.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No templates are available to you yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {populated.map((kind) => (
        <section key={kind}>
          <h2 className="text-sm font-semibold text-foreground/70 mb-3">
            {KIND_LABELS[kind]}
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {byKind[kind]!.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <LayoutTemplate className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {item.description}
                      </p>
                    )}
                  </div>
                </div>
                <Link
                  to={item.useHref}
                  className="self-start inline-flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  {kind === "page" ? "Browse" : kind === "form" ? "Open" : "View"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AgreementsLens({ signedDocs }: { signedDocs: LoaderData["signedDocs"] }) {
  const tz = useUserTimeZone();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Your signed lab agreements — read-only archive. To sign a pending
        agreement, visit Settings → Agreements.
      </p>
      {signedDocs.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          You haven't signed any agreements yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {signedDocs.map((s) => (
            <li
              key={s.signatureId}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
            >
              <span className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground text-sm truncate">
                    {s.documentName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {s.context} · signed {formatDateTime(s.signedAt, tz)}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <Link
                  to={`/sign/${s.bindingId}`}
                  className="text-sm font-medium text-accent-coral hover:underline"
                >
                  View
                </Link>
                <a
                  href={`/sign/${s.bindingId}?format=pdf`}
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  title="Download PDF"
                >
                  <Download className="w-4 h-4" /> PDF
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Lens = "docs" | "forms" | "agreements" | "templates";

export default function DriveHub() {
  const { docsData, formsData, canViewForms, signedDocs, templatesData } =
    useLoaderData() as LoaderData;
  const [searchParams, setSearchParams] = useSearchParams();

  // Default lens: "docs". Guard against invalid or gated lens values.
  const rawLens = searchParams.get("lens") as Lens | null;
  const lens: Lens =
    rawLens === "forms" && canViewForms
      ? "forms"
      : rawLens === "agreements"
        ? "agreements"
        : rawLens === "templates"
          ? "templates"
          : "docs";

  function switchLens(next: Lens) {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("lens", next);
        return p;
      },
      { replace: true },
    );
  }

  const pillBase =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors";
  const pillActive = "bg-accent-coral/10 text-accent-coral";
  const pillInactive = "text-muted-foreground hover:text-foreground hover:bg-muted/60";

  return (
    <div className="w-full flex flex-col gap-4 p-4">
      {/* Header + lens picker */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrive className="w-5 h-5 text-accent-coral" />
          <h1 className="text-lg font-semibold text-foreground">Drive</h1>
        </div>
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          <button
            type="button"
            aria-pressed={lens === "docs"}
            onClick={() => switchLens("docs")}
            className={`${pillBase} ${lens === "docs" ? pillActive : pillInactive}`}
          >
            <FileText className="w-4 h-4" />
            Documents
          </button>
          {canViewForms && (
            <button
              type="button"
              aria-pressed={lens === "forms"}
              onClick={() => switchLens("forms")}
              className={`${pillBase} ${lens === "forms" ? pillActive : pillInactive}`}
            >
              <ClipboardList className="w-4 h-4" />
              Forms
            </button>
          )}
          <button
            type="button"
            aria-pressed={lens === "agreements"}
            onClick={() => switchLens("agreements")}
            className={`${pillBase} ${lens === "agreements" ? pillActive : pillInactive}`}
          >
            <FileSignature className="w-4 h-4" />
            Agreements
          </button>
          <button
            type="button"
            aria-pressed={lens === "templates"}
            onClick={() => switchLens("templates")}
            className={`${pillBase} ${lens === "templates" ? pillActive : pillInactive}`}
          >
            <LayoutTemplate className="w-4 h-4" />
            Templates
          </button>
        </div>
      </div>

      {/* Lens content */}
      {lens === "docs" ? (
        <DocumentsHubBody {...docsData} />
      ) : lens === "forms" ? (
        formsData && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Create forms and organize them into folders. Click a folder to
              open it. Editing a form's questions appends a new version; anyone
              filling it out sees the latest.
            </p>
            <FormsBrowser
              folderId={null}
              parentId={null}
              folders={formsData.folders}
              forms={formsData.forms}
              allFolders={formsData.allFolders}
              allForms={formsData.allForms}
            />
          </div>
        )
      ) : lens === "agreements" ? (
        <AgreementsLens signedDocs={signedDocs} />
      ) : (
        <TemplatesLens templatesData={templatesData} />
      )}
    </div>
  );
}
