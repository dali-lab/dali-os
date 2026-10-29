import { redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/core.partners.renewals";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { Select } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { RenewalsBoard } from "../components/RenewalsBoard";
import { useState } from "react";
import { normalizeNextStep, type RenewalCardModel } from "../lib/partner-renewals";

type TermRef = { id: string; code: string; sortKey: number };
import {
  applyContinue,
  applyNotContinuing,
  applyUndecided,
  loadRenewalCards,
} from "../lib/partner-renewals.server";

export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partner renewals · DALI OS" }];

async function gate(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { redirect: redirectToLogin(request) } as const;
  if (await isNonMember(auth, request)) return { redirect: redirect("/portal") } as const;
  if (!(await isCore(auth.user.sub))) return { redirect: redirect("/") } as const;
  return { userId: auth.user.sub } as const;
}

export async function loader({ request }: Route.LoaderArgs) {
  const g = await gate(request);
  if ("redirect" in g) throw g.redirect;

  const [terms, current, crmSettings, domains] = await Promise.all([
    prisma.term.findMany({ orderBy: { sortKey: "asc" }, select: { id: true, code: true, sortKey: true } }),
    currentTerm(request),
    prisma.partnerCrmSettings.findUnique({ where: { id: "default" } }),
    prisma.domain.findMany({ where: { active: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
  ]);
  const wanted = new URL(request.url).searchParams.get("term");
  const picked =
    terms.find((t) => t.code === wanted) ?? terms.find((t) => t.id === current?.id) ?? terms.at(-1) ?? null;
  if (!picked) {
    return {
      terms,
      picked: null as TermRef | null,
      decisionTerm: null as TermRef | null,
      cards: [] as RenewalCardModel[],
      staleDays: 14,
      domains: [] as { id: string; name: string }[],
    };
  }
  const { decisionTerm, cards } = await loadRenewalCards(picked, terms);
  return {
    terms,
    picked,
    decisionTerm,
    cards,
    staleDays: crmSettings?.staleDays ?? 14,
    domains: domains.map((d) => ({ id: d.id, name: d.displayName })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const g = await gate(request);
  if ("redirect" in g) return g.redirect;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const projectId = String(form.get("projectId") ?? "");
  const decisionTermId = String(form.get("decisionTermId") ?? "");
  if (!projectId || !decisionTermId) return { error: "Missing project or term." };

  const next = normalizeNextStep(String(form.get("nextStep") ?? ""), String(form.get("nextStepDue") ?? ""));

  if (intent === "continue") {
    const termId = String(form.get("termId") ?? "");
    const [chosen, decision] = await Promise.all([
      prisma.term.findUnique({ where: { id: termId }, select: { sortKey: true } }),
      prisma.term.findUnique({ where: { id: decisionTermId }, select: { sortKey: true } }),
    ]);
    if (!chosen || !decision || chosen.sortKey < decision.sortKey) return { error: "Pick a valid term." };
    let roles: { domainId: string; slots: number }[] = [];
    try {
      const parsed = JSON.parse(String(form.get("roles") ?? "[]"));
      if (Array.isArray(parsed)) roles = parsed;
    } catch {
      return { error: "Spots could not be read." };
    }
    const feeRaw = String(form.get("feeCents") ?? "");
    const feeCents = feeRaw === "" ? null : Number(feeRaw);
    if (feeCents != null && !Number.isInteger(feeCents)) return { error: "Fee is not a valid amount." };
    await applyContinue(prisma, { projectId, decisionTermId, chosenTermId: termId, feeCents, roles, userId: g.userId, ...next });
  } else if (intent === "not-continuing") {
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return { error: "Add a reason." };
    await applyNotContinuing(prisma, { projectId, decisionTermId, reason, userId: g.userId, ...next });
  } else if (intent === "undecided") {
    await applyUndecided(prisma, { projectId, decisionTermId, userId: g.userId, ...next });
  } else {
    return { error: "Unknown action." };
  }

  await logAuditEvent({
    action: "partner.project.update",
    userId: g.userId,
    targetId: projectId,
    metadata: { renewalIntent: intent, decisionTermId },
    request,
  });
  return { ok: true };
}

export default function PartnersRenewals() {
  const data = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const { terms, picked, decisionTerm, cards, staleDays, domains } = data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
        <PartnerCrmNav />
        <div className="flex-1" />
        {picked && (
          <Select
            ariaLabel="Active in term"
            value={picked.code}
            onChange={(code) =>
              setSearchParams({ term: code }, { replace: true, preventScrollReset: true })
            }
            options={[...terms].reverse().map((t) => ({ value: t.code, label: `Active in ${t.code}` }))}
          />
        )}
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects or partners"
          aria-label="Search renewals"
          containerClassName="w-full sm:w-56 shrink-0"
        />
      </div>
      {!picked || !decisionTerm ? (
        <p className="text-sm text-muted-foreground">
          {picked ? `There is no term after ${picked.code} yet, so renewals cannot be decided.` : "No terms yet."}
        </p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects are active in {picked.code}.</p>
      ) : (
        <RenewalsBoard
          key={picked.id}
          cards={cards}
          query={query}
          staleDays={staleDays}
          lastTermCode={picked.code}
          decisionTerm={decisionTerm}
          termOptions={terms.filter((t) => t.sortKey >= decisionTerm.sortKey).map((t) => ({ id: t.id, code: t.code }))}
          domains={domains}
        />
      )}
    </div>
  );
}
