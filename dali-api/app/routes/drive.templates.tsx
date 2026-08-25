import { redirect, Link, useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/drive.templates";
import { useState } from "react";
import {
  FileText,
  ClipboardList,
  NotebookPen,
  Mail,
  FileSignature,
  LayoutTemplate,
  ArrowRight,
} from "lucide-react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadTemplates, type TemplateItem, type TemplateKind } from "~/lib/drive-templates.server";

export const meta: Route.MetaFunction = () => [{ title: "Templates · DALI OS" }];

export const handle = {
  docKey: "drive.templates",
  docTitle: "Templates",
};

// The unified Drive Templates gallery: every template system (documents, forms,
// mentor notes, email, agreements) in one browseable place, role-gated per kind
// by loadTemplates. Gated behind the `templates` feature flag.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const roles = await getUserRoles(auth.user.sub);
  if (!(await isFeatureEnabled("templates", auth.user.sub, roles))) {
    return redirect("/drive");
  }

  const templates = await loadTemplates(auth.user.sub);
  return { templates };
}

// Display metadata per kind. Order here is the section order in the gallery.
const KIND_META: { kind: TemplateKind; label: string; icon: React.ReactNode; blurb: string }[] = [
  { kind: "page", label: "Documents", icon: <FileText className="w-4 h-4" />, blurb: "Start a new document pre-filled with this layout." },
  { kind: "form", label: "Forms", icon: <ClipboardList className="w-4 h-4" />, blurb: "Open the form to duplicate it as a starting point." },
  { kind: "mentorNote", label: "Mentor notes", icon: <NotebookPen className="w-4 h-4" />, blurb: "Applied automatically when a mentor starts a weekly note." },
  { kind: "email", label: "Email", icon: <Mail className="w-4 h-4" />, blurb: "Reusable email bodies bound to hiring & education decisions." },
  { kind: "signing", label: "Agreements", icon: <FileSignature className="w-4 h-4" />, blurb: "Signable agreement templates with placeable fields." },
];

export default function DriveTemplates() {
  const { templates } = useLoaderData() as { templates: Awaited<ReturnType<typeof loadTemplates>> };
  const navigate = useNavigate();
  const [creating, setCreating] = useState<string | null>(null);

  // Spin a new Lab document off a page template, then open it. Mirrors the
  // TemplatePicker create flow in drive.hub.
  async function createFromPage(item: TemplateItem) {
    setCreating(item.id);
    try {
      const res = await fetch("/api/page-templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templatePageId: item.id, targetWorkspaceType: "Lab" }),
      });
      if (!res.ok) throw new Error("Failed to create from template");
      const { id } = (await res.json()) as { id: string };
      navigate(`/documents/${id}`);
    } catch {
      setCreating(null);
    }
  }

  const byKind = (kind: TemplateKind) => templates.items.filter((i) => i.kind === kind);
  const hasAny = templates.items.length > 0;

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <LayoutTemplate className="w-5 h-5 text-muted-foreground" /> Templates
        </h1>
        <p className="text-sm text-muted-foreground">
          Reusable starting points across the lab. What you see depends on your role.
        </p>
      </div>

      {!hasAny && (
        <p className="text-sm text-muted-foreground italic py-8 text-center">
          No templates are available to you yet. Mark any Lab document as a template
          (its ⋯ menu → “Save as template”) to see it here.
        </p>
      )}

      {KIND_META.map(({ kind, label, icon, blurb }) => {
        const items = byKind(kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <span className="text-muted-foreground">{icon}</span>
                {label}
              </h2>
              <span className="text-xs text-muted-foreground">{blurb}</span>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <TemplateCard
                    item={item}
                    creating={creating === item.id}
                    disabled={creating !== null}
                    onCreate={() => void createFromPage(item)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TemplateCard({
  item,
  creating,
  disabled,
  onCreate,
}: {
  item: TemplateItem;
  creating: boolean;
  disabled: boolean;
  onCreate: () => void;
}) {
  const inner = (
    <span className="flex items-center gap-2 min-w-0">
      {item.iconEmoji ? (
        <span className="text-base leading-none shrink-0">{item.iconEmoji}</span>
      ) : (
        <LayoutTemplate className="w-4 h-4 text-muted-foreground shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground truncate">
          {item.name || "Untitled template"}
        </span>
        {item.description && (
          <span className="block text-xs text-muted-foreground truncate">{item.description}</span>
        )}
      </span>
    </span>
  );

  const cardClass =
    "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-border bg-background text-left hover:bg-muted/50 hover:border-muted-foreground/30 transition-colors disabled:opacity-50";

  // "create" kinds spin off a new artifact in place; "open" kinds link to the
  // template's own manager/editor.
  if (item.action === "create") {
    return (
      <button type="button" onClick={onCreate} disabled={disabled} className={cardClass}>
        {inner}
        <span className="text-xs text-muted-foreground shrink-0">
          {creating ? "Creating…" : "Use"}
        </span>
      </button>
    );
  }
  return (
    <Link to={item.useHref} className={cardClass}>
      {inner}
      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
