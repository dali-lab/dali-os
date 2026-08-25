import { redirect, useLoaderData, Link } from "react-router";
import { useState } from "react";
import { Plus, FileText } from "lucide-react";
import type { Route } from "./+types/domains.$domainId";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { isSkillDomain, currentDomainLeads } from "~/lib/domains.server";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import { ensureGrowthBindings, growthFlowState } from "~/projects/lib/growth.server";
import { currentTerm } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import { prisma } from "~/lib/db";
import { ensureDomainHubRoot, loadDomainHubPages } from "~/domains/lib/domain-hub.server";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { Avatar } from "~/components/ui/Avatar";
import { buttonClasses } from "~/components/ui/Button";

export const handle = {
  breadcrumb: (data: unknown) => {
    const d = data as { domain?: { displayName?: string } } | undefined;
    return d?.domain?.displayName ?? "Domain";
  },
};

export const meta: Route.MetaFunction = ({ data }) => {
  const d = data as { domain?: { displayName?: string } } | undefined;
  const name = d?.domain?.displayName ?? "Domain";
  return [{ title: `${name} · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const roles = await getUserRoles(auth.user.sub, request);
  const enabled = await isFeatureEnabled("domain-hubs", auth.user.sub, roles, request);
  if (!enabled) return redirect("/projects");

  const domainId = params.domainId!;

  // Validate this is a skill domain.
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, displayName: true, description: true, active: true, isSystem: true, isInternProgram: true },
  });
  if (!domain || !isSkillDomain(domain)) {
    throw new Response("Not found", { status: 404 });
  }

  // Ensure hub root + growth bindings in parallel where possible.
  const term = await currentTerm(request);

  const [hub, leads, myEligibility, presenceUser] = await Promise.all([
    ensureDomainHubRoot(domainId, auth.user.sub),
    currentDomainLeads(domainId, request),
    prisma.domainEligibility.findUnique({
      where: { userId_domainId: { userId: auth.user.sub, domainId } },
      select: { level: true },
    }),
    getPresenceUser(
      auth.user.sub,
      [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email,
    ),
  ]);

  // Growth flow setup requires a term; skip gracefully when no term is active.
  let levelUpState: Awaited<ReturnType<typeof growthFlowState>> = {
    open: false,
    reason: "not-configured",
    formId: null,
    publicToken: null,
  };
  let joinState: Awaited<ReturnType<typeof growthFlowState>> = {
    open: false,
    reason: "not-configured",
    formId: null,
    publicToken: null,
  };
  if (term) {
    const cycle = await ensureStaffingCycle(term.id, term.code);
    await ensureGrowthBindings(cycle.id);
    [levelUpState, joinState] = await Promise.all([
      growthFlowState(cycle.id, "level-up"),
      growthFlowState(cycle.id, "domain-join"),
    ]);
  }

  const hubPages = await loadDomainHubPages(hub.folderId, hub.overviewPageId);
  const collabToken = parseSessionCookie(request);
  const userName =
    presenceUser?.name ??
    ([auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
      auth.user.email);

  const myLevel = (myEligibility?.level ?? null) as "P1" | "P2" | "P3" | null;
  const inDomain = myLevel !== null;

  return {
    domain: {
      id: domain.id,
      displayName: domain.displayName,
      description: domain.description,
    },
    leads,
    myLevel,
    inDomain,
    hub: {
      folderId: hub.folderId,
      overviewPageId: hub.overviewPageId,
      overviewDocId: hub.overviewDocId,
    },
    pages: hubPages,
    levelUpState,
    joinState,
    isCore: roles.isCore,
    collabToken,
    userName,
    currentUserId: auth.user.sub,
    photoUrl: presenceUser?.photoUrl ?? null,
  };
}

const LEVEL_RUNGS: Array<{ key: "P1" | "P2" | "P3"; label: string }> = [
  { key: "P1", label: "P1 — Learner" },
  { key: "P2", label: "P2 — Doer" },
  { key: "P3", label: "P3 — Mentor" },
];

export default function DomainHubPage() {
  const {
    domain,
    leads,
    myLevel,
    inDomain,
    hub,
    pages,
    levelUpState,
    joinState,
    isCore,
    collabToken,
    userName,
    currentUserId,
    photoUrl,
  } = useLoaderData<typeof loader>();

  const [addingPage, setAddingPage] = useState(false);

  // Which Growth flow applies and what its state is.
  const growthState = inDomain ? levelUpState : joinState;
  const ctaLabel = inDomain ? "Request a level up" : "Request to join";
  const ctaHref =
    growthState.open && growthState.publicToken
      ? `/forms/fill/${growthState.publicToken}`
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-2xl font-bold text-foreground">{domain.displayName}</h1>
            {domain.description && (
              <p className="text-sm text-muted-foreground">{domain.description}</p>
            )}
          </div>

          {/* CTA: only show when a flow is configured (even if closed) */}
          {growthState.reason !== "not-configured" && (
            <div className="flex-shrink-0">
              {ctaHref ? (
                <a href={ctaHref} className={buttonClasses("primary", "sm")}>
                  {ctaLabel}
                </a>
              ) : (
                <button type="button" disabled className={buttonClasses("ghost", "sm")}>
                  Requests closed
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Leads */}
          {leads.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1">
                {leads.map((lead) => (
                  <Avatar
                    key={lead.id}
                    name={fullName(lead)}
                    photoUrl={lead.photoUrl}
                    size="sm"
                    className="ring-2 ring-background"
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {leads.length === 1 ? fullName(leads[0]) : `${leads.length} leads`}
              </span>
            </div>
          )}

          {/* Level ladder — only for members in this domain */}
          {inDomain && myLevel && (
            <div className="flex items-center gap-1.5" aria-label="Your level in this domain">
              {LEVEL_RUNGS.map((r) => {
                const isAchieved = myLevel >= r.key;
                const isCurrent = myLevel === r.key;
                return (
                  <span
                    key={r.key}
                    title={r.label}
                    className={
                      isCurrent
                        ? "inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border bg-accent-teal/15 text-accent-teal border-accent-teal/40"
                        : isAchieved
                          ? "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border bg-muted text-muted-foreground border-border"
                          : "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border border-dashed border-border text-muted-foreground/50"
                    }
                  >
                    {r.key}
                    {isCurrent && " ●"}
                    {isAchieved && !isCurrent && " ✓"}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {/* Overview doc + page navigator */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Overview DocEditor — takes most of the width */}
        <div className="flex-1 min-w-0">
          <div className="border border-border rounded-md overflow-hidden">
            {collabToken ? (
              <PresenceProvider
                pageId={`domain:${domain.id}:overview`}
                token={collabToken}
                userName={userName}
                userId={currentUserId}
                photoUrl={photoUrl}
              >
                <DocEditor
                  features="notes"
                  editable={isCore}
                  aiEnabled={isCore}
                  collab={{
                    documentName: hub.overviewDocId,
                    token: collabToken,
                    userName,
                    userId: currentUserId,
                  }}
                  placeholder={
                    isCore
                      ? "Add an overview for this domain — use headings and @-page mentions to build structure."
                      : undefined
                  }
                />
              </PresenceProvider>
            ) : (
              <div className="px-4 py-3 text-sm text-muted-foreground italic">
                Sign in again to view the overview.
              </div>
            )}
          </div>
        </div>

        {/* Page navigator — sidebar on large screens, below on small */}
        <div className="lg:w-64 flex-shrink-0 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Pages
            </span>
            {isCore && !addingPage && (
              <button
                type="button"
                onClick={() => setAddingPage(true)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add page
              </button>
            )}
          </div>

          {pages.length === 0 && !addingPage && (
            <p className="text-xs text-muted-foreground italic">No pages yet.</p>
          )}

          {pages.map((page) => (
            <Link
              key={page.id}
              to={`/documents/${page.id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-foreground hover:bg-muted/30 transition-colors"
            >
              <FileText className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{page.title || "Untitled"}</span>
            </Link>
          ))}

          {isCore && addingPage && (
            <AddPageForm
              folderId={hub.folderId}
              onCancel={() => setAddingPage(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AddPageForm({
  folderId,
  onCancel,
}: {
  folderId: string;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/lab-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), parentPageId: folderId }),
      });
      if (res.ok) {
        const { id } = (await res.json()) as { id: string };
        // Navigate to the new page; the navigator will refresh on next visit.
        window.location.href = `/documents/${id}`;
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Page title"
        className="px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={!title.trim() || loading}
          className={buttonClasses("primary", "sm")}
        >
          {loading ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={buttonClasses("ghost", "sm")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
