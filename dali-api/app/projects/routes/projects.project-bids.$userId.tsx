import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.project-bids.$userId";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import { getSlotBinding } from "../lib/form-slots";
import { resolveTermFilter } from "~/lib/terms";
import { buildSubmissionView } from "../lib/submission-view.server";
import { UserSubmissionShell } from "../components/UserSubmissionShell";

const SLOT = "project-bids" as const;

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: `${
      (data as { record?: { name: string } } | undefined)?.record?.name ??
      "Submission"
    } · Project Bids · DALI OS`,
  },
];

// One member's full Project Bids submission for the cycle — every column,
// including ones hidden from the board table. Read-only; same access gate as
// the board (Core/Admin).
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const { termId: filterTermId, isAll } = await resolveTermFilter(request);
  const fallbackTerm = await currentTerm();

  // Detail is per-cycle; the all-terms aggregate has no single binding, so
  // resolve to the selected (or current) term's cycle.
  const term =
    !isAll && filterTermId
      ? await prisma.term.findUnique({
          where: { id: filterTermId },
          select: { id: true, code: true },
        })
      : fallbackTerm
        ? { id: fallbackTerm.id, code: fallbackTerm.code }
        : null;
  if (!term) return redirect("/projects/project-bids");

  const cycle = await ensureStaffingCycle(term.id, term.code);
  const binding = await getSlotBinding(cycle.id, SLOT);

  const view = await buildSubmissionView({
    cycleIds: [cycle.id],
    slot: SLOT,
    formId: binding?.formId ?? null,
    userId: params.userId,
  });
  const row = view.rows[0];
  if (!row) return redirect("/projects/project-bids");

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

export default function ProjectBidSubmissionDetail() {
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
