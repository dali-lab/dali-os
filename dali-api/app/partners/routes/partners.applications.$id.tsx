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
import { Pencil } from "lucide-react";
import type { Route } from "./+types/partners.applications.$id";
import { prisma } from "~/lib/db";
import { githubTeamSlug } from "~/lib/github-slug";
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { canViewStaffing, isCore } from "~/lib/roles";
import {
  PARTNER_APPLICATION_STATUSES as STATUSES,
  PARTNER_APPLICATION_STATUS_LABELS as STATUS_LABEL,
  isPartnerApplicationStatus,
  partnerDisplayName,
  type PartnerApplicationStatus as Status,
} from "../lib/partner-application";
import {
  EVAL_CRITERIA,
  RECOMMENDATION_OPTIONS,
  AMBIGUITY_OPTIONS,
  ACCEPT_CHECKLIST_TEMPLATE,
  FIRST_MEETING_TEMPLATE,
  parseEvaluation,
  evaluationHasContent,
  resolveChecklist,
  noteText,
} from "../lib/partner-review";
import { notifyPartnerApplicationEvent } from "../lib/partner-emails.server";
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
  if (!auth.ok) return redirect("/login");
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
      sowSharedAt: true,
      contractFee: true,
      contractSentAt: true,
      contractSignedAt: true,
      contractSignerName: true,
      contractSignerIp: true,
      contractSignedHash: true,
      legalEntityName: true,
      legalEntityAddress: true,
      resultingProjectId: true,
      evaluation: true,
      acceptChecklist: true,
      notes: {
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, body: true, createdAt: true },
      },
      partnerOrg: { select: { id: true, name: true, logoUrl: true } },
      // Account-first: the applicant is the person; the org may not exist yet.
      applicant: {
        select: { firstName: true, lastName: true, personalEmail: true },
      },
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
      sowSharedAt: application.sowSharedAt,
      contractFee: application.contractFee,
      contractSentAt: application.contractSentAt,
      contractSignedAt: application.contractSignedAt,
      contractSignerName: application.contractSignerName,
      contractSignerIp: application.contractSignerIp,
      contractSignedHash: application.contractSignedHash,
      legalEntityName: application.legalEntityName,
      legalEntityAddress: application.legalEntityAddress,
      resultingProjectId: application.resultingProjectId,
      targetTerms: application.targetTerms.map((t) => ({
        termId: t.termId,
        code: t.term.code,
      })),
      partner: application.partnerOrg,
      applicant: application.applicant,
      partnerName: partnerDisplayName(
        application.partnerOrg,
        application.applicant,
      ),
      domains: application.domains.map((d) => ({
        id: d.id,
        domainId: d.domainId,
        domainName: d.domain.displayName,
        // Legacy ProseMirror scope docs convert to block JSON on read; edits
        // save blocks back to the same column.
        expectedChallenges: ensureBlocks(d.expectedChallenges),
        expectedMembers: d.expectedMembers,
      })),
      evaluation: parseEvaluation(application.evaluation),
      checklist: resolveChecklist(application.acceptChecklist),
      notes: application.notes.map((n) => ({
        id: n.id,
        kind: n.kind,
        text: noteText(n.body),
        createdAt: n.createdAt,
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
  if (!auth.ok) return redirect("/login");
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
    // Push the partner-actionable decisions to their inbox (pull + push).
    const decisionEvent =
      status === "Accepted"
        ? ("accepted" as const)
        : status === "Rejected"
          ? ("rejected" as const)
          : status === "OnHold"
            ? ("onhold" as const)
            : null;
    if (decisionEvent) {
      void notifyPartnerApplicationEvent(params.id!, { kind: decisionEvent }).catch(
        (e) => console.error("partner status notify failed", e),
      );
    }
  } else if (intent === "eval") {
    const criteria: Record<string, string> = {};
    for (const c of EVAL_CRITERIA) {
      const v = (form.get(`crit:${c.key}`) as string | null)?.trim() ?? "";
      if (v) criteria[c.key] = v;
    }
    const recommendationRaw = String(form.get("recommendation") ?? "Undecided");
    const ambiguityRaw = String(form.get("ambiguityRating") ?? "");
    const evaluation = {
      criteria,
      concerns: (form.get("concerns") as string | null)?.trim() ?? "",
      shouldMeet: form.get("shouldMeet") === "on",
      recommendation: (RECOMMENDATION_OPTIONS as readonly string[]).includes(
        recommendationRaw,
      )
        ? recommendationRaw
        : "Undecided",
      ambiguityRating: (AMBIGUITY_OPTIONS as readonly string[]).includes(
        ambiguityRaw,
      )
        ? ambiguityRaw
        : "",
    };
    await prisma.partnerApplication.update({
      where: { id: params.id },
      data: { evaluation },
    });
  } else if (intent === "checklist") {
    // The whole checklist posts on every toggle (checkboxes named `check`).
    const checked = new Set(form.getAll("check").map(String));
    const items = ACCEPT_CHECKLIST_TEMPLATE.map((t) => ({
      key: t.key,
      label: t.label,
      done: checked.has(t.key),
    }));
    await prisma.partnerApplication.update({
      where: { id: params.id },
      data: { acceptChecklist: items },
    });
  } else if (intent === "note") {
    const kind = form.get("kind") === "meeting" ? "meeting" : "note";
    const text = (form.get("text") as string | null)?.trim() ?? "";
    if (!text) return { error: "A note can't be empty." };
    await prisma.partnerApplicationNote.create({
      data: {
        applicationId: params.id!,
        authorId: auth.user.sub,
        kind,
        body: { text },
      },
    });
  } else if (intent === "note-delete") {
    const noteId = String(form.get("noteId") ?? "");
    await prisma.partnerApplicationNote.deleteMany({
      where: { id: noteId, applicationId: params.id },
    });
  } else if (intent === "sow-share") {
    const share = form.get("share") === "on";
    const already = await prisma.partnerApplication.findUnique({
      where: { id: params.id },
      select: { sowSharedAt: true },
    });
    await prisma.partnerApplication.update({
      where: { id: params.id },
      data: { sowSharedAt: share ? new Date() : null },
    });
    // Notify only on the transition into "shared", not on re-saves.
    if (share && !already?.sowSharedAt) {
      void notifyPartnerApplicationEvent(params.id!, { kind: "sow-shared" }).catch(
        (e) => console.error("partner sow notify failed", e),
      );
    }
  } else if (intent === "contract") {
    const trimOrNull = (k: string) =>
      (form.get(k) as string | null)?.trim() || null;
    const send = form.get("send") === "on";
    // Sending requires a legal entity — it's the whole point of the contract
    // step and what the org record is built from at promotion.
    const legalEntityName = trimOrNull("legalEntityName");
    if (send && !legalEntityName) {
      return { error: "Add the partner's legal entity name before sending." };
    }
    const priorContract = await prisma.partnerApplication.findUnique({
      where: { id: params.id },
      select: { contractSentAt: true },
    });
    await prisma.partnerApplication.update({
      where: { id: params.id },
      data: {
        legalEntityName,
        legalEntityAddress: trimOrNull("legalEntityAddress"),
        contractFee: trimOrNull("contractFee"),
        // A fresh doc id the first time the contract is opened, so the collab
        // body has a stable name to bind to.
        contractDocId: `partnercontract:${params.id}:body`,
        contractSentAt: send ? new Date() : null,
      },
    });
    if (send && !priorContract?.contractSentAt) {
      void notifyPartnerApplicationEvent(params.id!, { kind: "contract-sent" }).catch(
        (e) => console.error("partner contract notify failed", e),
      );
    }
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
        applicantUserId: true,
        legalEntityName: true,
        legalEntityAddress: true,
        applicant: { select: { firstName: true, lastName: true } },
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

    // Account-first: the PartnerOrg is born HERE, at promotion, when its
    // identity is finally settled — not at signup. Legacy applications already
    // carry an org (set at apply time for existing partners); those reuse it.
    const applicantName = [app.applicant?.firstName, app.applicant?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    const project = await prisma.$transaction(async (tx) => {
      let orgId = app.partnerOrgId;
      if (!orgId) {
        // A legal entity means a real organization; its absence means a solo
        // partner (a professor, say) — a single-person org named after them.
        const isIndividual = !app.legalEntityName;
        const orgName =
          app.legalEntityName?.trim() || applicantName || app.title;
        const org = await tx.partnerOrg.create({
          data: {
            name: orgName,
            legalName: app.legalEntityName,
            legalAddress: app.legalEntityAddress,
            isIndividual,
          },
          select: { id: true },
        });
        orgId = org.id;
        // Graduate the applicant into their first org membership. Guard the
        // one-org-per-person unique: if they somehow already belong to one, the
        // org is still created and Core can invite them.
        if (app.applicantUserId) {
          try {
            const pu = await tx.partnerUser.create({
              data: {
                userId: app.applicantUserId,
                partnerOrgId: org.id,
                authProvider: "MagicLink",
              },
              select: { id: true },
            });
            await tx.partnerOrg.update({
              where: { id: org.id },
              data: { primaryContactId: pu.id },
            });
          } catch (e) {
            if ((e as { code?: string })?.code !== "P2002") throw e;
          }
        }
        await tx.partnerApplication.update({
          where: { id: app.id },
          data: { partnerOrgId: org.id },
        });
      }

      const created = await tx.project.create({
        data: {
          name: app.title,
          // Auto-derive the GitHub team slug from the title (editable later).
          githubTeamSlug: githubTeamSlug(app.title) || null,
          description: app.summary,
          ...(firstTermId
            ? { projectTerms: { create: { termId: firstTermId } } }
            : {}),
          partners: { create: { partnerOrgId: orgId } },
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

      <EvaluationSection application={application} canEdit={canEdit} />

      <MeetingNotesSection application={application} canEdit={canEdit} />

      <DomainScopeBlock
        applicationId={application.id}
        domains={application.domains}
        availableDomains={availableDomains}
        canEdit={canEdit}
      />

      <AcceptChecklistSection application={application} canEdit={canEdit} />

      <SowBlock
        applicationId={application.id}
        canEdit={canEdit}
        sowSharedAt={application.sowSharedAt}
        collabToken={collabToken}
        userName={userName}
      />

      <ContractBlock
        application={application}
        canEdit={canEdit}
        collabToken={collabToken}
        userName={userName}
      />
    </div>
  );
}

// The formal contract: legal entity + free-text fee + a collab body doc, sent
// to the applicant to sign. Distinct from the SOW (scope, iterated earlier).
function ContractBlock({
  application,
  canEdit,
  collabToken,
  userName,
}: {
  application: LoaderData["application"];
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
}) {
  const sent = application.contractSentAt !== null;
  const signed = application.contractSignedAt !== null;
  const documentName = `partnercontract:${application.id}:body`;

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Contract</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {signed
              ? `Signed by ${application.contractSignerName ?? "the partner"}${
                  application.contractSignedAt
                    ? ` on ${new Date(application.contractSignedAt).toLocaleDateString()}`
                    : ""
                }.`
              : sent
                ? "Sent to the applicant — awaiting their signature."
                : "Draft the agreement, then send it for signature."}
          </p>
        </div>
        {signed && (
          <span className="text-xs rounded-full bg-accent-teal/25 text-accent-teal px-2 py-0.5">
            Signed
          </span>
        )}
      </div>

      {signed && (
        <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground flex flex-col gap-1">
          <a
            href={`/partner/applications/${application.id}/contract.pdf`}
            className="text-accent-coral hover:underline w-fit"
          >
            Download signed contract (PDF)
          </a>
          {application.contractSignerIp && (
            <span>Signer IP: {application.contractSignerIp}</span>
          )}
          {application.contractSignedHash && (
            <span className="break-all">
              Body hash: {application.contractSignedHash}
            </span>
          )}
        </div>
      )}

      {canEdit && (
        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="contract" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Legal entity name</span>
              <input
                name="legalEntityName"
                defaultValue={application.legalEntityName ?? ""}
                placeholder="The entity that will sign"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Fee (free text)</span>
              <input
                name="contractFee"
                defaultValue={application.contractFee ?? ""}
                placeholder="e.g. $18K / term, one term"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Legal entity address</span>
            <textarea
              name="legalEntityAddress"
              rows={2}
              defaultValue={application.legalEntityAddress ?? ""}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              name="send"
              defaultChecked={sent}
              className="rounded"
            />
            Send to applicant for signature
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
              Save contract
            </button>
          </div>
        </Form>
      )}

      {collabToken ? (
        <PresenceProvider
          pageId={`partnercontract:${application.id}`}
          token={collabToken}
          userName={userName}
        >
          <DocEditor
            features="notes"
            editable={canEdit && !signed}
            placeholder="Draft the contract…"
            className="border border-border rounded-md bg-card py-2"
            collab={{ documentName, token: collabToken, userName }}
          />
        </PresenceProvider>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Sign in again to edit the contract.
        </p>
      )}
    </section>
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
          <Form method="post" onChange={(e) => submit(e.currentTarget)}>
            <input type="hidden" name="intent" value="status" />
            <select
              name="status"
              defaultValue={application.status}
              aria-label="Application status"
              className="text-xs px-2 py-1 border border-border rounded-full bg-background text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Form>
        ) : (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
            {STATUS_LABEL[application.status]}
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {application.partner ? (
          <Link
            to={`/projects?q=${encodeURIComponent(application.partner.name)}`}
            className="text-accent-coral hover:underline"
          >
            {application.partner.name}
          </Link>
        ) : (
          <span className="text-dark-blue">{application.partnerName}</span>
        )}
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

// Core's structured review against the 8-point reading rubric. Partners never
// see this. Read mode shows only what's been filled in.
function EvaluationSection({
  application,
  canEdit,
}: {
  application: LoaderData["application"];
  canEdit: boolean;
}) {
  const e = application.evaluation;
  const filled = evaluationHasContent(e);

  if (!canEdit) {
    return (
      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Evaluation</h2>
        {!filled ? (
          <p className="text-sm text-muted-foreground">Not yet evaluated.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-muted px-2 py-0.5">
                Recommendation: {e.recommendation}
              </span>
              {e.ambiguityRating && (
                <span className="rounded-full bg-muted px-2 py-0.5">
                  Ambiguity: {e.ambiguityRating}
                </span>
              )}
              {e.shouldMeet && (
                <span className="rounded-full bg-accent-teal/15 text-accent-teal px-2 py-0.5">
                  Should meet
                </span>
              )}
            </div>
            <dl className="flex flex-col gap-2">
              {EVAL_CRITERIA.filter((c) => e.criteria[c.key]).map((c) => (
                <div key={c.key}>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {c.label}
                  </dt>
                  <dd className="text-sm text-foreground whitespace-pre-wrap">
                    {e.criteria[c.key]}
                  </dd>
                </div>
              ))}
            </dl>
            {e.concerns && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">
                  Questions / concerns
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {e.concerns}
                </p>
              </div>
            )}
          </>
        )}
      </section>
    );
  }

  return (
    <Form
      method="post"
      className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
    >
      <input type="hidden" name="intent" value="eval" />
      <h2 className="text-sm font-semibold text-foreground">Evaluation</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {EVAL_CRITERIA.map((c) => (
          <label key={c.key} className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{c.label}</span>
            <textarea
              name={`crit:${c.key}`}
              rows={2}
              defaultValue={e.criteria[c.key] ?? ""}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Questions / concerns</span>
        <textarea
          name="concerns"
          rows={2}
          defaultValue={e.concerns}
          placeholder="What do we want to know more about?"
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Recommendation</span>
          <select
            name="recommendation"
            defaultValue={e.recommendation}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          >
            {RECOMMENDATION_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Ambiguity rating</span>
          <select
            name="ambiguityRating"
            defaultValue={e.ambiguityRating}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          >
            <option value="">—</option>
            {AMBIGUITY_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="shouldMeet"
            defaultChecked={e.shouldMeet}
            className="rounded"
          />
          Should meet with them
        </label>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
        >
          Save evaluation
        </button>
      </div>
    </Form>
  );
}

// Dated meeting / review notes. Newest first. "Add meeting note" pre-fills the
// first-meeting template.
function MeetingNotesSection({
  application,
  canEdit,
}: {
  application: LoaderData["application"];
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<"note" | "meeting">("note");

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Meeting notes</h2>

      {canEdit && (
        <Form
          method="post"
          className="flex flex-col gap-2"
          onSubmit={() => {
            setDraft("");
            setKind("note");
          }}
        >
          <input type="hidden" name="intent" value="note" />
          <input type="hidden" name="kind" value={kind} />
          <textarea
            name="text"
            rows={kind === "meeting" ? 8 : 3}
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            placeholder="Jot a note…"
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!draft.trim()}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-50"
            >
              Add note
            </button>
            <button
              type="button"
              onClick={() => {
                setKind("meeting");
                setDraft((d) => d || FIRST_MEETING_TEMPLATE);
              }}
              className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:border-accent-coral transition-colors"
            >
              Use first-meeting template
            </button>
          </div>
        </Form>
      )}

      {application.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {application.notes.map((n) => (
            <li key={n.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs text-muted-foreground">
                  {n.kind === "meeting" && (
                    <span className="mr-1.5 rounded-full bg-accent-teal/15 text-accent-teal px-2 py-0.5">
                      Meeting
                    </span>
                  )}
                  {new Date(n.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                {canEdit && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="note-delete" />
                    <input type="hidden" name="noteId" value={n.id} />
                    <button
                      type="submit"
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    >
                      Delete
                    </button>
                  </Form>
                )}
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {n.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The accept checklist from the partner-lead process. Toggling any box posts
// the whole set (auto-submit), same pattern as the status dropdown.
function AcceptChecklistSection({
  application,
  canEdit,
}: {
  application: LoaderData["application"];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  return (
    <Form
      method="post"
      className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2"
      onChange={(e) => canEdit && submit(e.currentTarget)}
    >
      <input type="hidden" name="intent" value="checklist" />
      <h2 className="text-sm font-semibold text-foreground">Accept checklist</h2>
      {application.checklist.map((item) => (
        <label
          key={item.key}
          className="flex items-center gap-2 text-sm text-foreground"
        >
          <input
            type="checkbox"
            name="check"
            value={item.key}
            defaultChecked={item.done}
            disabled={!canEdit}
            className="rounded"
          />
          <span className={item.done ? "text-muted-foreground line-through" : ""}>
            {item.label}
          </span>
        </label>
      ))}
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
          <select
            name="targetTermId"
            value={value}
            onChange={(e) =>
              setRows((r) =>
                r.map((v, j) => (j === i ? e.target.value : v)),
              )
            }
            className="flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          >
            <option value="">Select a term…</option>
            {terms
              .filter((t) => t.id === value || !chosen.has(t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code}
                </option>
              ))}
          </select>
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
            <select
              autoFocus
              value={newDomainId}
              onChange={(e) => setNewDomainId(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            >
              <option value="">Select a domain…</option>
              {availableDomains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName}
                </option>
              ))}
            </select>
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
  sowSharedAt,
  collabToken,
  userName,
}: {
  applicationId: string;
  canEdit: boolean;
  sowSharedAt: Date | string | null;
  collabToken: string | null;
  userName: string;
}) {
  const submit = useSubmit();
  // The SOW is a single collab doc per application. Versioning + history come
  // for free from the CollabDocumentVersion auto-snapshot machinery (same as
  // project documents); the editor exposes the version-history panel itself.
  const documentName = `partnersow:${applicationId}:body`;
  const shared = sowSharedAt !== null;
  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Statement of Work
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {shared
              ? "Shared with the applicant — you're drafting this together."
              : "Private to the lab until you share it. Versioned automatically."}
          </p>
        </div>
        {canEdit && (
          <Form method="post" onChange={(e) => submit(e.currentTarget)}>
            <input type="hidden" name="intent" value="sow-share" />
            <label className="flex items-center gap-2 text-xs text-foreground whitespace-nowrap">
              <input
                type="checkbox"
                name="share"
                defaultChecked={shared}
                className="rounded"
              />
              Share with applicant
            </label>
          </Form>
        )}
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
