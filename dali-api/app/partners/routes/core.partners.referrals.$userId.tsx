import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.partners.referrals.$userId";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import { getSlotBinding } from "~/projects/lib/form-slots";
import { resolveTermFilter } from "~/lib/terms";
import { buildSubmissionView } from "~/projects/lib/submission-view.server";
import { UserSubmissionShell } from "~/projects/components/UserSubmissionShell";
import { coreHandle } from "~/core/coreNav";

const SLOT = "referrals" as const;

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: `${
      (data as { record?: { name: string } } | undefined)?.record?.name ??
      "Submission"
    } · Referrals · DALI OS`,
  },
];

export const handle = coreHandle(
  "partners",
  (data) => (data as { record?: { name?: string } } | undefined)?.record?.name,
);

// One member's full referral submission for the cycle — every column,
// including ones hidden from the board table. Read-only; same access gate as
// the board (Core).
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

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
  if (!term) return redirect("/core/partners/referrals");

  const cycle = await ensureStaffingCycle(term.id, term.code);
  const binding = await getSlotBinding(cycle.id, SLOT);

  const view = await buildSubmissionView({
    cycleIds: [cycle.id],
    slot: SLOT,
    formId: binding?.formId ?? null,
    userId: params.userId,
  });
  const row = view.rows[0];
  if (!row) return redirect("/core/partners/referrals");

  return {
    record: { name: row.name, email: row.email },
    // Every question on the form (in form order) + builtins. Independent of
    // the manager's column mapping so partial / missing mappings still show
    // the full submission.
    fields: row.detailFields,
    cycleName: cycle.name,
  };
}

export default function ReferralSubmissionDetail() {
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
