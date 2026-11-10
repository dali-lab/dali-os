// Core triage view for the Partner Bounty referrals that members submit at
// /refer. Replaces the old slot-based generic-form submissions database — each
// row is a PartnerReferral, grouped visually by tier, with an at-a-glance
// "reached out?" marker so Partner Relations knows what's still untouched.

import { Link, redirect, useLoaderData } from "react-router";
import { Check, Handshake, Rocket, Snowflake } from "lucide-react";
import type { Route } from "./+types/core.partners.referrals";
import { useFilteredList } from "~/hooks/useFilteredList";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { useSearchParamState } from "~/hooks/useSearchParamState";
import { SearchInput } from "~/components/ui/SearchInput";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import {
  REFERRAL_TIER_LABEL,
  REFERRAL_TIER_PAYOUT_USD,
} from "~/partners/lib/referral-quiz";
import {
  listReferralsForCore,
  type ReferralListRow,
} from "~/partners/lib/referrals.server";
import { relativeTime } from "~/lib/relative-time";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [
  { title: "Referrals · DALI OS" },
];

// Shell owns the subnav; this page draws its own PartnerCrmNav.
export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");
  const referrals = await listReferralsForCore();
  return { referrals };
}

const TIER_ICON = {
  Cold: Snowflake,
  Warm: Handshake,
  FullPitch: Rocket,
} as const;

export default function PartnerReferralsList() {
  const { referrals } = useLoaderData<typeof loader>();
  const [search, setSearch] = useSearchParamState("q", { debounceMs: 300 });

  const { filtered } = useFilteredList(referrals, {
    search,
    searchFields: (r) => [
      r.partnerName,
      r.partnerEmail ?? "",
      r.partnerOrgName ?? "",
      r.referrerName,
    ],
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PartnerCrmNav className="shrink-0" />
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by partner, email, or referrer"
          aria-label="Search referrals"
          containerClassName="flex-1 min-w-[180px] max-w-[360px]"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState anyExist={referrals.length > 0} />
      ) : (
        <div className="overflow-hidden rounded-os-card bg-os-card">
          <table className="w-full text-sm">
            <thead className="border-b border-os-container text-left text-xs text-os-grey">
              <tr>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium">Partner</th>
                <th className="px-4 py-3 font-medium">Referred by</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <ReferralRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReferralRow({ row }: { row: ReferralListRow }) {
  const Icon = TIER_ICON[row.tier];
  return (
    <tr className="border-b border-os-container last:border-0 hover:bg-os-card-hover">
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-2 text-xs text-os-grey">
          <Icon className="h-3.5 w-3.5" />
          {REFERRAL_TIER_LABEL[row.tier]}
          <span className="text-muted-foreground">
            · ${REFERRAL_TIER_PAYOUT_USD[row.tier]}
          </span>
        </span>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/core/partners/referrals/${row.id}`}
          className="font-medium text-foreground hover:underline"
        >
          {row.partnerName}
        </Link>
        {row.partnerOrgName && (
          <div className="text-xs text-muted-foreground">
            {row.partnerOrgName}
          </div>
        )}
        {row.partnerEmail && (
          <div className="text-xs text-muted-foreground">{row.partnerEmail}</div>
        )}
      </td>
      <td className="px-4 py-3 text-foreground">{row.referrerName}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {relativeTime(row.createdAt)}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs",
            row.reachedOutAt ? "text-foreground" : "text-os-amber",
          )}
        >
          {row.reachedOutAt ? (
            <>
              <Check className="h-3 w-3" /> Reached out
            </>
          ) : (
            <>New</>
          )}
        </span>
      </td>
    </tr>
  );
}

function EmptyState({ anyExist }: { anyExist: boolean }) {
  return (
    <div className="rounded-os-card bg-os-card px-6 py-12 text-center text-sm text-muted-foreground">
      {anyExist
        ? "No referrals match your search."
        : "No referrals yet. When members refer partners at /refer they'll show up here."}
    </div>
  );
}
