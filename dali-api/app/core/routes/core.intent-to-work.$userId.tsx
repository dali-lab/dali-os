import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.intent-to-work.$userId";
import { coreHandle } from "~/core/coreNav";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import { getSlotBinding } from "~/projects/lib/form-slots";
import { resolveTermFilter } from "~/lib/terms";
import { buildSubmissionView } from "~/projects/lib/submission-view.server";
import { UserSubmissionShell } from "~/projects/components/UserSubmissionShell";

const SLOT = "intent-to-work" as const;

export const handle = coreHandle("intent-to-work");

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: `${
      (data as { record?: { name: string } } | undefined)?.record?.name ??
      "Submission"
    } · Intent to Work · DALI OS`,
  },
];


// One member's full Intent to Work submission for the cycle — every column,
// including ones hidden from the board table. Read-only; Core/Admin only.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const { termId: filterTermId, isAll } = await resolveTermFilter(request);
  const fallbackTerm = await currentTerm();

  const term =
    !isAll && filterTermId
      ? await prisma.term.findUnique({
          where: { id: filterTermId },
          select: { id: true, code: true },
        })
      : fallbackTerm
        ? { id: fallbackTerm.id, code: fallbackTerm.code }
        : null;
  if (!term) return redirect("/core/intent-to-work");

  const cycle = await ensureStaffingCycle(term.id, term.code);
  const binding = await getSlotBinding(cycle.id, SLOT);

  const view = await buildSubmissionView({
    cycleIds: [cycle.id],
    slot: SLOT,
    formId: binding?.formId ?? null,
    userId: params.userId,
  });
  const row = view.rows[0];
  if (!row) return redirect("/core/intent-to-work");

  return {
    record: { name: row.name, email: row.email },
    // Every question on the form (in form order) + builtins. Independent of
    // the manager's column mapping so partial / missing mappings still show
    // the full submission. `mapped: false` rows are flagged so a manager
    // can see they're not currently surfaced in the board table.
    fields: row.detailFields,
    cycleName: cycle.name,
  };
}

export default function IntentSubmissionDetail() {
  const data = useLoaderData<typeof loader>();
  return (
    <UserSubmissionShell
      title={data.record.name}
      subtitle={data.cycleName}
      rows={data.fields.map((f) => ({
        key: f.key,
        label: f.label,
        value: f.value,
        mapped: f.mapped,
      }))}
    />
  );
}
