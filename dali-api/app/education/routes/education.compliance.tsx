import { redirect, useLoaderData, useActionData, Form } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.compliance";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import {
  complianceForTerm,
  grantManualCredit,
  creditHistory,
  remindNonCompliant,
} from "~/education/lib/ce-credits.server";
import { redirectDartmouthToPortal } from "~/education/lib/access.server";
import { educationPills } from "~/education/components/educationPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { TermFilter } from "~/components/TermFilter";
import { Button } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "CE Compliance · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) return redirect("/education");

  const { terms, selected, termId } = await resolveTermFilter(request);
  // Compliance is inherently per-term; "All terms" falls back to the newest.
  const effectiveTermId = termId ?? terms[0]?.id ?? null;
  const rows = effectiveTermId ? await complianceForTerm(effectiveTermId) : [];

  // Expandable detail for one member via ?member=.
  const memberId = new URL(request.url).searchParams.get("member");
  const memberHistory = memberId ? await creditHistory(memberId) : null;

  return {
    terms,
    selected,
    termId: effectiveTermId,
    rows,
    expandedMemberId: memberId,
    memberHistory,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "remind-non-compliant") {
    const termId = String(formData.get("termId") ?? "");
    if (!termId) return Response.json({ error: "No term selected" }, { status: 400 });
    const result = await remindNonCompliant({ termId, actorId: auth.user.sub });
    return { ok: true, reminded: result.reminded };
  }
  if (intent !== "grant-credit")
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  const result = await grantManualCredit({
    userId: String(formData.get("userId") ?? ""),
    termId: String(formData.get("termId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    actorId: auth.user.sub,
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return { ok: true };
}

export default function CECompliance() {
  const { terms, selected, termId, rows, expandedMemberId, memberHistory } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: string; reminded?: number }>();
  const confirmSubmit = useConfirmSubmit();
  const nonCompliant = rows.filter((r) => !r.compliant).length;

  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav
        items={educationPills({ canManage: true, isCore: true, active: "compliance" })}
      />
      <div className="flex flex-col gap-4 max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            CE credit compliance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every member needs at least one continuing-education credit per
            term — earned by attending a workshop or miniseries session, or
            granted manually (e.g. the async CEC check-in). Display-only:
            nothing is blocked automatically.
          </p>
        </div>
        <TermFilter terms={terms} selected={selected} />
      </header>

      {actionData?.error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {actionData.error}
        </p>
      )}
      {actionData?.reminded !== undefined && (
        <p className="text-sm text-foreground bg-green-50 border border-green-200 rounded-md px-3 py-2">
          Reminded {actionData.reminded} member{actionData.reminded === 1 ? "" : "s"}.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-foreground">
          {rows.length} current member{rows.length === 1 ? "" : "s"} ·{" "}
          <span className={nonCompliant > 0 ? "text-amber-700 font-semibold" : ""}>
            {nonCompliant} without a credit
          </span>
        </p>
        {nonCompliant > 0 && termId && (
          <Form
            method="post"
            onSubmit={confirmSubmit({
              title: `Remind ${nonCompliant} member${nonCompliant === 1 ? "" : "s"}?`,
              description:
                "Sends an in-app nudge (and email per preference) to everyone who still owes a CE credit this term.",
              confirmLabel: "Send reminders",
            })}
          >
            <input type="hidden" name="intent" value="remind-non-compliant" />
            <input type="hidden" name="termId" value={termId} />
            <Button type="submit" variant="secondary" size="sm">
              Remind {nonCompliant} non-compliant
            </Button>
          </Form>
        )}
      </div>

      <ul className="bg-card border border-border rounded-lg divide-y divide-border">
        {rows.map((r) => (
          <li key={r.userId} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-4">
              <a
                href={`?term=${selected}&member=${r.userId}`}
                className="text-sm text-foreground hover:text-accent-coral"
              >
                {r.name}
              </a>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  r.compliant
                    ? "bg-green-100 text-green-800"
                    : "bg-amber-100 text-amber-800",
                )}
              >
                {r.credits} credit{r.credits === 1 ? "" : "s"}
              </span>
            </div>

            {expandedMemberId === r.userId && (
              <div className="mt-3 pt-3 border-t border-border flex flex-col gap-3">
                {memberHistory && memberHistory.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {memberHistory.map((c) => (
                      <li key={c.id} className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{c.termCode}</span>
                        {" · "}
                        {c.source}
                        {c.manual && c.grantedByName ? ` (granted by ${c.grantedByName})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    No credits on record.
                  </p>
                )}
                {termId && (
                  <Form method="post" className="flex items-end gap-2">
                    <input type="hidden" name="intent" value="grant-credit" />
                    <input type="hidden" name="userId" value={r.userId} />
                    <input type="hidden" name="termId" value={termId} />
                    <label className="block flex-1">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Manual grant reason
                      </span>
                      <input
                        type="text"
                        name="reason"
                        required
                        placeholder="Completed async CEC check-in"
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <Button type="submit" variant="secondary" size="sm">
                      Grant credit
                    </Button>
                  </Form>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      </div>
    </div>
  );
}
