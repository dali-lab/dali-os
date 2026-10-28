import { useMemo, useState } from "react";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { CheckCircle2, Link as LinkIcon, Lightbulb, Mail, UserPlus } from "lucide-react";
import type { Route } from "./+types/core.partners.referrals";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { buttonClasses } from "~/components/ui/Button";
import { SearchInput } from "~/components/ui/SearchInput";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import type { PartnerReferralType } from "~/generated/prisma/client";

export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [
  { title: "Partner referrals · DALI OS" },
];

const TYPE_LABELS: Record<PartnerReferralType, string> = {
  ColdLead: "Cold",
  WarmLead: "Warm",
  FundedPitch: "Pitch",
};

const TYPE_ICONS: Record<PartnerReferralType, typeof UserPlus> = {
  ColdLead: UserPlus,
  WarmLead: Mail,
  FundedPitch: Lightbulb,
};

type ReferralRow = {
  id: string;
  createdAtIso: string;
  resolvedAtIso: string | null;
  type: PartnerReferralType;
  referrerName: string;
  referrerEmail: string | null;
  rawName: string | null;
  rawEmail: string | null;
  rawOrg: string | null;
  rawPhone: string | null;
  rawLinkedinUrl: string | null;
  pitchTitle: string | null;
  pitchSummary: string | null;
  notes: string | null;
  applicationId: string | null;
  applicationTitle: string | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const referrals = await prisma.partnerReferral.findMany({
    orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      createdAt: true,
      resolvedAt: true,
      type: true,
      rawName: true,
      rawEmail: true,
      rawOrg: true,
      rawPhone: true,
      rawLinkedinUrl: true,
      pitchTitle: true,
      pitchSummary: true,
      notes: true,
      referrer: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      application: { select: { id: true, title: true } },
    },
  });

  const rows: ReferralRow[] = referrals.map((r) => ({
    id: r.id,
    createdAtIso: r.createdAt.toISOString(),
    resolvedAtIso: r.resolvedAt?.toISOString() ?? null,
    type: r.type,
    referrerName:
      `${r.referrer.firstName ?? ""} ${r.referrer.lastName ?? ""}`.trim() ||
      r.referrer.email ||
      "Unknown",
    referrerEmail: r.referrer.email ?? null,
    rawName: r.rawName,
    rawEmail: r.rawEmail,
    rawOrg: r.rawOrg,
    rawPhone: r.rawPhone,
    rawLinkedinUrl: r.rawLinkedinUrl,
    pitchTitle: r.pitchTitle,
    pitchSummary: r.pitchSummary,
    notes: r.notes,
    applicationId: r.application?.id ?? null,
    applicationTitle: r.application?.title ?? null,
  }));

  return { rows };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to resolve referrals." };
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const referralId = String(form.get("referralId") ?? "");
  if (!referralId) return { error: "Missing referral." };

  if (intent === "resolve") {
    const existing = await prisma.partnerReferral.findUnique({
      where: { id: referralId },
      select: { resolvedAt: true },
    });
    if (!existing) return { error: "Referral not found." };
    const next = existing.resolvedAt ? null : new Date();
    await prisma.partnerReferral.update({
      where: { id: referralId },
      data: { resolvedAt: next, resolvedById: next ? auth.user.sub : null },
    });
    await logAuditEvent({
      action: "partner.referral.resolved",
      userId: auth.user.sub,
      targetId: referralId,
      metadata: { resolved: Boolean(next) },
      request,
    });
    return { ok: true };
  }

  if (intent === "link") {
    const applicationId = String(form.get("applicationId") ?? "");
    if (!applicationId) return { error: "Pick an application to link." };
    const [referral, app] = await Promise.all([
      prisma.partnerReferral.findUnique({
        where: { id: referralId },
        select: { id: true, referrerUserId: true, application: { select: { id: true } } },
      }),
      prisma.partnerApplication.findUnique({
        where: { id: applicationId },
        select: { id: true, referralId: true },
      }),
    ]);
    if (!referral) return { error: "Referral not found." };
    if (!app) return { error: "Application not found." };
    if (referral.application && referral.application.id !== app.id) {
      return { error: "This referral is already linked to another application." };
    }
    if (app.referralId && app.referralId !== referral.id) {
      return { error: "That application already has a different referral linked." };
    }
    await prisma.$transaction([
      prisma.partnerApplication.update({
        where: { id: app.id },
        data: {
          referralId: referral.id,
          referredByUserId: referral.referrerUserId,
        },
      }),
      prisma.partnerReferral.update({
        where: { id: referral.id },
        data: { resolvedAt: new Date(), resolvedById: auth.user.sub },
      }),
    ]);
    await logAuditEvent({
      action: "partner.referral.linked",
      userId: auth.user.sub,
      targetId: referral.id,
      metadata: { applicationId: app.id },
      request,
    });
    return { ok: true };
  }

  return { error: "Unknown intent." };
}

export default function CorePartnersReferrals() {
  const { rows } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"open" | "resolved" | "all">("open");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "open" && r.resolvedAtIso) return false;
      if (tab === "resolved" && !r.resolvedAtIso) return false;
      if (!q) return true;
      const hay = [
        r.referrerName,
        r.rawName,
        r.rawEmail,
        r.rawOrg,
        r.pitchTitle,
        r.pitchSummary,
        r.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, tab]);

  const openCount = rows.filter((r) => !r.resolvedAtIso).length;

  const tabs = [
    { label: "Open", count: openCount, active: tab === "open", onClick: () => setTab("open") },
    { label: "Resolved", active: tab === "resolved", onClick: () => setTab("resolved") },
    { label: "All", active: tab === "all", onClick: () => setTab("all") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PartnerCrmNav />
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by referrer, partner, or notes"
          containerClassName="w-full max-w-[420px] sm:w-72"
        />
        <SegmentedTabButtons items={tabs} label="Status" className="ml-auto" />
      </div>

      {actionData && "error" in actionData && actionData.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-lg px-4 py-10 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "No referrals yet. Members submit them from /partners/refer."
            : "No referrals match this view."}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((row) => (
            <ReferralRowCard key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReferralRowCard({ row }: { row: ReferralRow }) {
  const Icon = TYPE_ICONS[row.type];
  const [linking, setLinking] = useState(false);
  return (
    <li className="bg-card border border-border rounded-lg px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {TYPE_LABELS[row.type]}
        </span>
        <div className="flex-1 min-w-[200px]">
          <div className="text-sm text-foreground">
            {row.pitchTitle ?? row.rawName ?? row.rawEmail ?? "Unnamed referral"}
            {row.rawOrg && (
              <span className="text-muted-foreground"> · {row.rawOrg}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            From {row.referrerName} · {new Date(row.createdAtIso).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {row.applicationId ? (
            <a
              href={`/core/partners/applications/${row.applicationId}`}
              className={buttonClasses("secondary", "xs")}
            >
              <LinkIcon className="h-3.5 w-3.5" aria-hidden />
              Open application
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setLinking((v) => !v)}
              className={buttonClasses("secondary", "xs")}
            >
              <LinkIcon className="h-3.5 w-3.5" aria-hidden />
              Link to application
            </button>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value="resolve" />
            <input type="hidden" name="referralId" value={row.id} />
            <button type="submit" className={buttonClasses("ghost", "xs")}>
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              {row.resolvedAtIso ? "Reopen" : "Resolve"}
            </button>
          </Form>
        </div>
      </div>

      {(row.rawEmail || row.rawPhone || row.rawLinkedinUrl) && (
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          {row.rawEmail && <span>{row.rawEmail}</span>}
          {row.rawPhone && <span>{row.rawPhone}</span>}
          {row.rawLinkedinUrl && (
            <a
              href={row.rawLinkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              LinkedIn
            </a>
          )}
        </div>
      )}

      {row.pitchSummary && (
        <p className="text-sm text-foreground whitespace-pre-wrap">
          {row.pitchSummary}
        </p>
      )}
      {row.notes && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
          {row.notes}
        </p>
      )}

      {linking && !row.applicationId && (
        <Form method="post" className="flex items-center gap-2 pt-2 border-t border-border">
          <input type="hidden" name="intent" value="link" />
          <input type="hidden" name="referralId" value={row.id} />
          <input
            name="applicationId"
            placeholder="Application id"
            required
            className="px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground w-64"
          />
          <button type="submit" className={buttonClasses("primary", "xs")}>
            Link
          </button>
          <button
            type="button"
            onClick={() => setLinking(false)}
            className={buttonClasses("ghost", "xs")}
          >
            Cancel
          </button>
        </Form>
      )}
    </li>
  );
}
