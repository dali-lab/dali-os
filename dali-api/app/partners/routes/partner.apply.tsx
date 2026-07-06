import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.apply";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { currentTerm } from "~/lib/roles";
import { requirePartner } from "~/partners/lib/partner-auth.server";

export const meta: Route.MetaFunction = () => [
  { title: "Pitch a project · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  await requirePartner(request);
  const current = await currentTerm();
  const [terms, domains] = await Promise.all([
    prisma.term.findMany({
      // Only current + future terms make sense as staffing targets.
      where: current ? { sortKey: { gte: current.sortKey } } : undefined,
      orderBy: { sortKey: "asc" },
      take: 6,
      select: { id: true, code: true },
    }),
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
  ]);
  return { terms, domains };
}

// Plain text from the form, stored as the single-paragraph ProseMirror doc
// the internal scope editor round-trips (see PartnerApplicationDomain schema
// comment).
function wrapChallenges(text: string) {
  if (!text) return null;
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { auth, partnerUser } = await requirePartner(request);
  const form = await request.formData();

  const title = (form.get("title") as string | null)?.trim() ?? "";
  const summary = (form.get("summary") as string | null)?.trim() || null;
  const termIds = form.getAll("termIds").map(String).filter(Boolean);
  const domainIds = form.getAll("domainIds").map(String).filter(Boolean);

  if (!title) return { error: "Give your pitch a title." };

  // Validate the picked ids exist (form data is client-controlled).
  const [validTerms, validDomains] = await Promise.all([
    prisma.term.findMany({ where: { id: { in: termIds } }, select: { id: true } }),
    prisma.domain.findMany({ where: { id: { in: domainIds }, active: true }, select: { id: true } }),
  ]);

  const application = await prisma.partnerApplication.create({
    data: {
      partnerOrgId: partnerUser.partnerOrgId,
      title,
      summary,
      targetTerms: {
        create: validTerms.map((t) => ({ termId: t.id })),
      },
      domains: {
        create: validDomains.map((d) => {
          const members = Number(form.get(`expectedMembers:${d.id}`) ?? 0);
          const challenges =
            (form.get(`challenges:${d.id}`) as string | null)?.trim() ?? "";
          return {
            domainId: d.id,
            expectedMembers: Number.isFinite(members) && members > 0 ? Math.floor(members) : 0,
            expectedChallenges: wrapChallenges(challenges) ?? undefined,
          };
        }),
      },
    },
    select: { id: true },
  });

  await logAuditEvent({
    action: "partner.application.submitted",
    userId: auth.user.sub,
    targetId: application.id,
    metadata: { partnerOrgId: partnerUser.partnerOrgId },
    request,
  });

  return redirect(`/partner/applications/${application.id}`);
}

export default function PartnerApply({ actionData }: Route.ComponentProps) {
  const { terms, domains } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;

  const inputClass =
    "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";
  const labelClass = "block text-sm font-medium text-dark-blue mb-1";

  return (
    <div className="max-w-2xl">
      <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">
        Pitch a project
      </h1>
      <p className="text-muted-foreground mb-8">
        Tell the lab what you'd like to build. After you submit, you can draft
        a fuller statement of work together with the DALI team.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <Form method="post" className="flex flex-col gap-6">
        <div>
          <label htmlFor="title" className={labelClass}>
            Project title
          </label>
          <input id="title" name="title" required className={inputClass} />
        </div>

        <div>
          <label htmlFor="summary" className={labelClass}>
            Short pitch <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="summary"
            name="summary"
            rows={4}
            placeholder="What problem are you trying to solve, and for whom?"
            className={inputClass}
          />
        </div>

        {terms.length > 0 && (
          <fieldset>
            <legend className={labelClass}>
              Which terms would you like the team working?
            </legend>
            <div className="flex flex-wrap gap-3 mt-1">
              {terms.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-2 text-sm text-dark-blue bg-card border border-border rounded-lg px-3 py-2"
                >
                  <input type="checkbox" name="termIds" value={t.id} className="rounded" />
                  {t.code}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className={labelClass}>
            What kinds of work do you expect?
          </legend>
          <div className="flex flex-col gap-3 mt-1">
            {domains.map((d) => (
              <details key={d.id} className="bg-card border border-border rounded-xl">
                <summary className="flex items-center gap-2 text-sm text-dark-blue px-4 py-3 cursor-pointer select-none">
                  <input type="checkbox" name="domainIds" value={d.id} className="rounded" onClick={(e) => e.stopPropagation()} />
                  {d.displayName}
                </summary>
                <div className="px-4 pb-4 flex flex-col gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">
                      Expected team members (rough)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      name={`expectedMembers:${d.id}`}
                      defaultValue={0}
                      className="mt-1 w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">
                      What should this discipline tackle?
                    </span>
                    <textarea
                      name={`challenges:${d.id}`}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              </details>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit pitch"}
        </button>
      </Form>
    </div>
  );
}
