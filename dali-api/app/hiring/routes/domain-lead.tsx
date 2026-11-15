import { useEffect } from "react";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";
import { useActionData, useLoaderData, useSearchParams } from "react-router";
import { redirect } from "react-router";
import type { Route } from "./+types/domain-lead";
import { requireAuth } from "~/lib/auth";
import { loadDomainLeadDashboard } from "~/hiring/lib/domain-lead-dashboard.server";
import { DOMAIN_LEAD_ACTIONS, resolveLeadDomain } from "~/hiring/lib/domain-lead-actions.server";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { SegmentedTabButtons } from "~/components/ui/SegmentedTabs";
import { DomainPanel } from "~/hiring/components/domain-lead/DomainPanel";

export const meta: Route.MetaFunction = () => [{ title: "Domain lead · DALI OS" }];

// Only ?cycle= reaches the loader; ?domain=, ?q=, ?sort= and the like are client-only.
const LOADER_SEARCH_PARAMS = ["cycle"] as const;

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return skipClientOnlySearchChange(args, LOADER_SEARCH_PARAMS);
}

export async function loader(args: Route.LoaderArgs) {
  return loadDomainLeadDashboard(args);
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const domainId = await resolveLeadDomain(formData, auth.user.sub);
  if (!domainId) return Response.json({ error: "Forbidden" }, { status: 403 });

  const handler = Object.hasOwn(DOMAIN_LEAD_ACTIONS, intent) ? DOMAIN_LEAD_ACTIONS[intent] : null;
  if (!handler) return redirect("/hiring/domain-lead");
  return handler({ request, formData, domainId, actorId: auth.user.sub });
}

export default function DomainLeadDashboard() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { notice?: string; error?: string } | undefined;
  const toast = useToast();
  const os = useOsChrome();
  const domainData = data.domainData;
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (actionData?.notice) toast.success(actionData.notice);
    if (actionData?.error) toast.error(actionData.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per action result
  }, [actionData]);

  if (domainData.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className={os.bodyText}>You don't lead a domain yet.</p>
      </div>
    );
  }

  // One domain at a time; leads of several switch between them.
  const domainParam = searchParams.get("domain");
  const current = domainData.find((d) => d.assignment.domainId === domainParam) ?? domainData[0];
  const setDomain = (domainId: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("domain", domainId);
        next.delete("cycle");
        return next;
      },
      { preventScrollReset: true },
    );

  return (
    <div className="flex flex-col gap-6">
      {domainData.length > 1 && (
        <SegmentedTabButtons
          label="Domain"
          items={domainData.map((d) => ({
            label: d.assignment.domain.name,
            active: d === current,
            onClick: () => setDomain(d.assignment.domainId),
          }))}
        />
      )}
      <DomainPanel key={`${current.assignment.id}-${current.cycle?.id ?? "none"}`} entry={current} allForms={data.allForms ?? []} emailEngagement={data.emailEngagement ?? {}} />
    </div>
  );
}
