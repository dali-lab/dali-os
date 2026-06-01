import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.level-up.$userId";
import { requireAuth } from "~/lib/auth";
import { canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import { getSlotBinding } from "../lib/form-slots";
import { resolveTermFilter } from "~/lib/terms";
import { buildSubmissionView } from "../lib/submission-view.server";

const SLOT = "level-up" as const;

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: `${
      (data as { record?: { name: string } } | undefined)?.record?.name ??
      "Submission"
    } · Level Up · DALI OS`,
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
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
  if (!term) return redirect("/projects/level-up");

  const cycle = await ensureStaffingCycle(term.id, term.code);
  const binding = await getSlotBinding(cycle.id, SLOT);

  const view = await buildSubmissionView({
    cycleIds: [cycle.id],
    slot: SLOT,
    formId: binding?.formId ?? null,
    userId: params.userId,
  });
  const row = view.rows[0];
  if (!row) return redirect("/projects/level-up");

  return {
    record: { name: row.name, email: row.email },
    fields: row.detailFields,
    cycleName: cycle.name,
  };
}

export default function LevelUpSubmissionDetail() {
  const data = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {data.record.name}
        </h1>
        <p className="text-sm text-muted-foreground">{data.cycleName}</p>
      </div>

      {data.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">This submission is empty.</p>
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
