import { useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
  useSubmit,
} from "react-router";
import { Select, type SelectOption } from "~/components/ui/floating";
import { Pencil } from "lucide-react";
import type { Route } from "./+types/partners.applications.$id";
import { prisma } from "~/lib/db";
import { githubTeamSlug } from "~/lib/github-slug";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseSessionCookie } from "~/lib/cookies";
import { canViewStaffing, isCore } from "~/lib/roles";
import {
  PARTNER_APPLICATION_STATUSES as STATUSES,
  PARTNER_APPLICATION_STATUS_LABELS as STATUS_LABEL,
  isPartnerApplicationStatus,
  type PartnerApplicationStatus as Status,
} from "../lib/partner-application";
import { formAnswerRows } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { EditModeToggle, useEditMode } from "~/components/EditModeToggle";
import { isEmptyBlocks } from "~/lib/blocks";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { useDialog, useConfirmSubmit } from "~/components/ui/dialog";

export const meta: Route.MetaFunction = ({ data }) => {
  const a = (data as { application?: { title: string } } | undefined)
    ?.application;
  return [
    {
      title: a
        ? `${a.title} · Partner Applications · DALI OS`
        : "Partner Application · DALI OS",
    },
  ];
};

// Resolves the dynamic leaf crumb so the trail reads
// "Partners › Applications › <title>" instead of a raw id.
export const handle = {
  breadcrumb: (data: unknown) =>
    (data as { application?: { title?: string } } | undefined)?.application
      ?.title ?? null,
};


export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const application = await prisma.partnerApplication.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      summary: true,
      status: true,
      sowDocId: true,
      resultingProjectId: true,
      partnerOrg: { select: { id: true, name: true, logoUrl: true } },
      targetTerms: {
        orderBy: { term: { sortKey: "asc" } },
        select: { termId: true, term: { select: { code: true } } },
      },
      domains: {
        orderBy: { domain: { displayName: "asc" } },
        select: {
          id: true,
          domainId: true,
          expectedChallenges: true,
          expectedMembers: true,
          domain: { select: { displayName: true } },
        },
      },
      formSubmission: {
        select: {
          answers: true,
          formVersion: { select: { questions: true } },
        },
      },
    },
  });
  if (!application) throw new Response("Not found", { status: 404 });

  // The partner's answers to the bound application form (if one was bound
  // when they applied), resolved to label/value pairs for display.
  const formAnswers = application.formSubmission
    ? await formAnswerRows(
        (application.formSubmission.formVersion.questions as unknown as Question[]) ?? [],
        (application.formSubmission.answers as Record<string, unknown>) ?? {},
      )
    : [];

  const [allDomains, terms, canEdit] = await Promise.all([
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true },
    }),
    isCore(auth.user.sub),
  ]);

  // Domains not yet on this application — offered in the "add scope" picker.
  const usedDomainIds = new Set(application.domains.map((d) => d.domainId));
  const availableDomains = allDomains.filter((d) => !usedDomainIds.has(d.id));

  const collabToken = parseSessionCookie(request);
  const userName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;

  return {
    application: {
      id: application.id,
      title: application.title,
      summary: application.summary,
      status: application.status,
      sowDocId: application.sowDocId,
      resultingProjectId: application.resultingProjectId,
      targetTerms: application.targetTerms.map((t) => ({
        termId: t.termId,
        code: t.term.code,
      })),
      partner: application.partnerOrg,
      domains: application.domains.map((d) => ({
        id: d.id,
        domainId: d.domainId,
        domainName: d.domain.displayName,
        // Legacy ProseMirror scope docs convert to block JSON on read; edits
        // save blocks back to the same column.
        expectedChallenges: ensureBlocks(d.expectedChallenges),
        expectedMembers: d.expectedMembers,
      })),
    },
    formAnswers,
    availableDomains,
    terms,
    canEdit,
    collabToken,
    userName,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to edit this application." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "details";

  if (intent === "title") {
    const title = (form.get("title") as string | null)?.trim() ?? "";
    if (!title) return { error: "Title is required." };
    await prisma.partnerApplication.update({
      where: { id: params.id },
      data: { title },
    });
  } else if (intent === "status") {
    const status = form.get("status");
    if (!isPartnerApplicationStatus(status)) {
      return { error: "Invalid status." };
    }
    await prisma.partnerApplication.update({
      where: { id: params.id },
      data: { status },
    });
  } else if (intent === "details") {
    const summaryRaw = (form.get("summary") as string | null)?.trim() ?? "";
    // The form posts one targetTermId per selected term; blank/duplicate
    // entries are dropped so an empty list cleanly clears all target terms.
    const termIds = [
      ...new Set(
        form
          .getAll("targetTermId")
          .map((v) => String(v).trim())
          .filter(Boolean),
      ),
    ];
    if (termIds.length > 0) {
      const found = await prisma.term.findMany({
        where: { id: { in: termIds } },
        select: { id: true },
      });
      if (found.length !== termIds.length) {
        return { error: "One of those terms no longer exists." };
      }
    }
    // Replace the whole target-term set in one transaction: scalar fields,
    // then drop and recreate the join rows.
    await prisma.$transaction([
      prisma.partnerApplication.update({
        where: { id: params.id },
        data: { summary: summaryRaw === "" ? null : summaryRaw },
      }),
      prisma.partnerApplicationTargetTerm.deleteMany({
        where: { applicationId: params.id },
      }),
      prisma.partnerApplicationTargetTerm.createMany({
        data: termIds.map((termId) => ({
          applicationId: params.id,
          termId,
        })),
      }),
    ]);
  } else if (intent === "promote") {
    // Spin up a Project from this application and link the two so they share
    // partner + scope data. Idempotent on resultingProjectId so a double
    // submit can't create two projects.
    const app = await prisma.partnerApplication.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        summary: true,
        resultingProjectId: true,
        partnerOrgId: true,
        targetTerms: {
          orderBy: { term: { sortKey: "asc" } },
          select: { termId: true },
        },
        domains: {
          select: { domainId: true, expectedMembers: true },
        },
      },
    });
    if (!app) return { error: "That application no longer exists." };
    if (app.resultingProjectId) {
      return redirect(`/projects/${app.resultingProjectId}`);
    }

    // Earliest target term (targetTerms is sorted by sortKey asc) seeds the
    // project's term set and scopes the per-domain role requests. Without a
    // target term we still create the project, just with no terms and no role
    // requests (ProjectRoleRequest requires a termId).
    const firstTermId = app.targetTerms[0]?.termId ?? null;
    // PartnerApplicationDomain carries headcount but no level; new role
    // requests default to P1 (Learner) — the staffing board can refine.
    const roleRequestRows = firstTermId
      ? app.domains
          .filter((d) => d.expectedMembers > 0)
          .map((d) => ({
            termId: firstTermId,
            domainId: d.domainId,
            level: "P1" as const,
            slots: d.expectedMembers,
          }))
      : [];
    // The project's declared domains are INHERITED from the role requests: the
    // distinct domains the project needs people in. No role requests → no
    // domains inherited. After promotion these stay editable the usual way
    // (the `domains` intent on the project page), so this is just the initial
    // seed, not a binding.
    const inheritedDomainIds = Array.from(
      new Set(roleRequestRows.map((r) => r.domainId)),
    );

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name: app.title,
          // Auto-derive the GitHub team slug from the title (editable later).
          githubTeamSlug: githubTeamSlug(app.title) || null,
          description: app.summary,
          ...(firstTermId
            ? { projectTerms: { create: { termId: firstTermId } } }
            : {}),
          partners: { create: { partnerOrgId: app.partnerOrgId } },
          ...(roleRequestRows.length > 0
            ? { roleRequests: { create: roleRequestRows } }
            : {}),
          ...(inheritedDomainIds.length > 0
            ? {
                domains: {
                  create: inheritedDomainIds.map((domainId) => ({ domainId })),
                },
              }
            : {}),
        },
        select: { id: true },
      });
      await tx.partnerApplication.update({
        where: { id: app.id },
        data: { resultingProjectId: created.id },
      });
      return created;
    });
    return redirect(`/projects/${project.id}`);
  } else {
    return { error: "Unknown action." };
  }
  return redirect(`/partners/applications/${params.id}`);
}

// loader returns redirect() (a Response) on auth-fail branches; the component
// only renders on the data branch, so narrow it out.
type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;

export default function PartnerApplicationDetail() {
  const {
    application,
    formAnswers,
    availableDomains,
    terms,
    canEdit: canEditPerm,
    collabToken,
    userName,
  } = useLoaderData() as LoaderData;
  const { editing: canEdit, editMode, setEditMode } = useEditMode(canEditPerm);
  const actionData = useActionData<typeof action>();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <EditModeToggle
          canEdit={canEditPerm}
          editMode={editMode}
          setEditMode={setEditMode}
        />
      </div>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      <Header application={application} canEdit={canEdit} />

      <DetailsSection
        application={application}
        terms={terms}
        canEdit={canEdit}
      />

      {formAnswers.length > 0 && (
        <section className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Application answers
          </h2>
          <dl className="flex flex-col gap-3">
            {formAnswers.map((row) => (
              <div key={row.key}>
                <dt className="text-xs font-medium text-muted-foreground mb-0.5">
                  {row.label}
                </dt>
                <dd className="text-sm text-foreground whitespace-pre-wrap">
                  {row.value || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <DomainScopeBlock
        applicationId={application.id}
        domains={application.domains}
        availableDomains={availableDomains}
        canEdit={canEdit}
      />

      <SowBlock
        applicationId={application.id}
        canEdit={canEdit}
        collabToken={collabToken}
        userName={userName}
      />
    </div>
  );
}

function Header({
  application,
  canEdit,
}: {
  application: LoaderData["application"];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const submit = useSubmit();
  const confirmSubmit = useConfirmSubmit();

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {editing ? (
          <Form
            method="post"
            onSubmit={() => setEditing(false)}
            className="flex items-center gap-2"
          >
            <input type="hidden" name="intent" value="title" />
            <input
              name="title"
              defaultValue={application.title}
              autoFocus
              aria-label="Application title"
              className="font-heading text-xl font-bold text-foreground px-2 py-1 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
            <button
              type="submit"
              className="px-2.5 py-1 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-2.5 py-1 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </Form>
        ) : (
          <>
            <h1 className="font-heading text-2xl font-bold text-foreground">
              {application.title}
            </h1>
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Edit title"
                title="Edit title"
                className="text-muted-foreground hover:text-accent-coral transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}

        {canEdit ? (
          <Select
            name="status"
            defaultValue={application.status}
            ariaLabel="Application status"
            onChange={(value) => {
              const fd = new FormData();
              fd.set("intent", "status");
              fd.set("status", value);
              submit(fd, { method: "post" });
            }}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            buttonClassName="text-xs px-2 py-1 border border-border rounded-full bg-background text-muted-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
        ) : (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
            {STATUS_LABEL[application.status]}
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        <Link
          to={`/projects?q=${encodeURIComponent(application.partner.name)}`}
          className="text-accent-coral hover:underline"
        >
          {application.partner.name}
        </Link>
        {application.targetTerms.length > 0
          ? ` · Target ${application.targetTerms.map((t) => t.code).join(", ")}`
          : " · No target term"}
        {application.resultingProjectId && (
          <>
            {" · "}
            <Link
              to={`/projects/${application.resultingProjectId}`}
              className="text-accent-coral hover:underline"
            >
              View project
            </Link>
          </>
        )}
      </p>

      {canEdit && !application.resultingProjectId && (
        <Form
          method="post"
          onSubmit={confirmSubmit({
            title: "Create a project from this application?",
            description:
              "It will carry over the partner, start term, and per-domain role requests, and the two will be linked.",
            confirmLabel: "Create project",
          })}
        >
          <input type="hidden" name="intent" value="promote" />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
          >
            Promote to project →
          </button>
        </Form>
      )}
    </header>
  );
}

function DetailsSection({
  application,
  terms,
  canEdit,
}: {
  application: LoaderData["application"];
  terms: LoaderData["terms"];
  canEdit: boolean;
}) {
  return (
    <Form
      method="post"
      className="bg-card border border-border rounded-lg p-4 flex flex-col gap-4"
    >
      <input type="hidden" name="intent" value="details" />
      <h2 className="text-sm font-semibold text-foreground">Details</h2>

      {/* Core-written synopsis — partners never see or set this (their prose
          lives in the application answers). Hidden in read mode when empty
          so partner-submitted applications don't render a blank row. */}
      {(canEdit || application.summary !== null) && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Internal summary</span>
          {canEdit ? (
            <textarea
              name="summary"
              rows={3}
              defaultValue={application.summary ?? ""}
              placeholder="One-paragraph synopsis for the lab — partners don't see this. The full SOW lives below."
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          ) : (
            <span className="px-2 py-1.5 text-sm text-foreground whitespace-pre-wrap">
              {application.summary}
            </span>
          )}
        </label>
      )}

      <TargetTermsField
        terms={terms}
        selected={application.targetTerms}
        canEdit={canEdit}
      />

      {canEdit && (
        <div className="flex justify-end">
          <button
            type="submit"
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
          >
            Save changes
          </button>
        </div>
      )}
    </Form>
  );
}

// Multiple target terms: one dropdown row per selected term, each posting its
// value as `targetTermId` (the action reads all of them). A term already
// picked in another row is hidden from the remaining dropdowns so the same
// term can't be added twice. An empty list posts no targetTermId, which the
// action treats as "clear all target terms".
function TargetTermsField({
  terms,
  selected,
  canEdit,
}: {
  terms: LoaderData["terms"];
  selected: LoaderData["application"]["targetTerms"];
  canEdit: boolean;
}) {
  // "" is the placeholder for a freshly-added, not-yet-chosen row.
  const [rows, setRows] = useState<string[]>(() =>
    selected.map((t) => t.termId),
  );

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-1 text-xs sm:max-w-xs">
        <span className="text-muted-foreground">Target terms</span>
        <span className="px-2 py-1.5 text-sm text-foreground">
          {selected.length > 0
            ? selected.map((t) => t.code).join(", ")
            : "—"}
        </span>
      </div>
    );
  }

  const chosen = new Set(rows.filter(Boolean));

  return (
    <fieldset className="flex flex-col gap-2 text-xs sm:max-w-xs">
      <legend className="text-muted-foreground mb-1">
        Target terms
        <span className="ml-1 text-muted-foreground/70">
          (add one per expected term)
        </span>
      </legend>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          No target terms.
        </p>
      )}

      {rows.map((value, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select
            name="targetTermId"
            value={value}
            onChange={(newValue) =>
              setRows((r) => r.map((v, j) => (j === i ? newValue : v)))
            }
            placeholder="Select a term…"
            options={[
              { value: "", label: "Select a term…" },
              ...terms
                .filter((t) => t.id === value || !chosen.has(t.id))
                .map((t) => ({ value: t.id, label: t.code })),
            ]}
            buttonClassName="flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <button
            type="button"
            onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
            aria-label="Remove term"
            className="px-2 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Remove
          </button>
        </div>
      ))}

      {chosen.size < terms.length && (
        <button
          type="button"
          onClick={() => setRows((r) => [...r, ""])}
          className="self-start text-xs font-medium text-accent-coral hover:underline"
        >
          + Add term
        </button>
      )}
    </fieldset>
  );
}

function DomainScopeBlock({
  applicationId,
  domains,
  availableDomains,
  canEdit,
}: {
  applicationId: string;
  domains: LoaderData["application"]["domains"];
  availableDomains: LoaderData["availableDomains"];
  canEdit: boolean;
}) {
  const revalidator = useRevalidator();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newDomainId, setNewDomainId] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    fn()
      .then(() => revalidator.revalidate())
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Something went wrong"),
      )
      .finally(() => setBusy(false));
  }

  async function call(url: string, method: "POST" | "DELETE", body?: unknown) {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `Request failed: ${res.status}`);
    }
  }

  const total = domains.reduce((s, d) => s + d.expectedMembers, 0);

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Expected scope per domain
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Drives the projected lab headcount for the target term.
          </p>
        </div>
        {canEdit && !adding && availableDomains.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            + Add domain
          </button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {adding && canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newDomainId) return;
            run(async () => {
              await call(
                `/api/partner-applications/${applicationId}/domains`,
                "POST",
                { domainId: newDomainId },
              );
              setAdding(false);
              setNewDomainId("");
            });
          }}
          className="flex items-end gap-2 mb-3"
        >
          <label className="flex flex-col gap-1 text-xs flex-1">
            <span className="text-muted-foreground">Domain</span>
            <Select
              value={newDomainId}
              onChange={(value) => setNewDomainId(value)}
              placeholder="Select a domain…"
              options={[
                { value: "", label: "Select a domain…" },
                ...availableDomains.map((d) => ({ value: d.id, label: d.displayName })),
              ]}
              buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !newDomainId}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewDomainId("");
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      {domains.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground italic">
          No domain scope defined yet.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {domains.map((d) =>
            editId === d.id ? (
              <DomainScopeEditRow
                key={d.id}
                row={d}
                busy={busy}
                onCancel={() => setEditId(null)}
                onSave={(members, challenges) => {
                  run(async () => {
                    await call(
                      `/api/partner-application-domains/${d.id}`,
                      "POST",
                      {
                        expectedMembers: members,
                        expectedChallenges: challenges,
                      },
                    );
                    setEditId(null);
                  });
                }}
              />
            ) : (
              <div key={d.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {d.domainName}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-foreground tabular-nums">
                        {d.expectedMembers}{" "}
                        {d.expectedMembers === 1 ? "member" : "members"}
                      </span>
                    </div>
                    {!isEmptyBlocks(d.expectedChallenges) ? (
                      <DocEditor
                        key={d.id}
                        features="notes"
                        density="compact"
                        editable={false}
                        initialContent={d.expectedChallenges}
                        className="text-sm text-muted-foreground mt-1"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground italic mt-1">
                        No scope description.
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditId(d.id)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            !(await dialog.confirm({
                              title: `Remove ${d.domainName} from this application?`,
                              confirmLabel: "Remove",
                              tone: "destructive",
                            }))
                          )
                            return;
                          run(() =>
                            call(
                              `/api/partner-application-domains/${d.id}`,
                              "DELETE",
                            ),
                          );
                        }}
                        className="text-xs text-destructive hover:underline disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          {domains.length > 0 && (
            <div className="py-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Total expected members
              </span>
              <span className="font-semibold text-foreground tabular-nums">
                {total}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DomainScopeEditRow({
  row,
  busy,
  onCancel,
  onSave,
}: {
  row: LoaderData["application"]["domains"][number];
  busy: boolean;
  onCancel: () => void;
  onSave: (expectedMembers: number, expectedChallenges: unknown) => void;
}) {
  const [members, setMembers] = useState<string>(String(row.expectedMembers));
  const [challenges, setChallenges] = useState<unknown>(row.expectedChallenges);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = Math.max(0, Number(members) || 0);
        onSave(n, isEmptyBlocks(challenges) ? null : challenges);
      }}
      className="py-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {row.domainName}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      <label className="flex flex-col gap-1 text-xs sm:max-w-[180px]">
        <span className="text-muted-foreground">Expected members</span>
        <input
          type="number"
          min={0}
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">
          Expected challenges / scope
        </span>
        <DocEditor
          features="notes"
          density="compact"
          initialContent={row.expectedChallenges}
          onChange={setChallenges}
          placeholder="What does the partner expect this domain to deliver?"
          className="rounded-md border border-border bg-card py-2"
        />
      </label>
    </form>
  );
}

function SowBlock({
  applicationId,
  canEdit,
  collabToken,
  userName,
}: {
  applicationId: string;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
}) {
  // The SOW is a single collab doc per application. Versioning + history come
  // for free from the CollabDocumentVersion auto-snapshot machinery (same as
  // project documents); the editor exposes the version-history panel itself.
  const documentName = `partnersow:${applicationId}:body`;
  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Statement of Work
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Versioned automatically — open version history from the editor
            toolbar.
          </p>
        </div>
      </div>
      {collabToken ? (
        <PresenceProvider
          pageId={`partnersow:${applicationId}`}
          token={collabToken}
          userName={userName}
        >
          <DocEditor
            features="notes"
            editable={canEdit}
            placeholder="Draft the statement of work…"
            className="border border-border rounded-md bg-card py-2"
            collab={{
              documentName,
              token: collabToken,
              userName,
            }}
          />
        </PresenceProvider>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Sign in again to edit the statement of work.
        </p>
      )}
    </section>
  );
}
