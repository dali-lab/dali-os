import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.project-bids.$userId";
import { requireAuth } from "~/lib/auth";
import { canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import { getSlotBinding } from "../lib/form-slots";
import { resolveTermFilter } from "~/lib/terms";
import { buildSubmissionView } from "../lib/submission-view.server";

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
  if (auth.user.type === "applicant") return redirect("/portal");
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
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/projects/project-bids"
          className="text-sm text-accent-coral hover:underline"
        >
          ← Back to Project Bids
        </Link>
        <h1 className="font-heading text-2xl font-bold text-foreground mt-2">
          {data.record.name}
        </h1>
        <p className="text-sm text-muted-foreground">{data.cycleName}</p>
      </div>

      {data.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This submission is empty.
        </p>
      ) : (
        <dl className="bg-card border border-border rounded-lg divide-y divide-border">
          {data.fields.map((f) => (
            <div
              key={f.key}
              className="px-4 py-3 flex flex-col sm:flex-row sm:gap-4"
            >
              <dt className="sm:w-56 shrink-0 text-sm font-medium text-foreground">
                {f.label}
                {!f.mapped && (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    (not in table)
                  </span>
                )}
              </dt>
              <dd className="text-sm text-foreground mt-1 sm:mt-0 whitespace-pre-wrap break-words">
                {f.value === "" ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  f.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
