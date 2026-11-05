// Detail page for one PartnerReferral. Core-only. Shows every field the
// referrer submitted plus a working surface for Partner Relations: Core notes
// and a "we've reached out" toggle. Linking a referral to a resulting
// PartnerApplication is left manual in this pilot — Partner Relations
// cross-matches by partner email on the applications board.

import { Form, Link, redirect, useFetcher, useLoaderData } from "react-router";
import {
  ArrowLeft,
  Check,
  Handshake,
  Mail,
  Rocket,
  Snowflake,
  UserCircle2,
} from "lucide-react";
import type { Route } from "./+types/core.partners.referrals.$id";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import {
  getReferralForCore,
  setReferralReachedOut,
  updateReferralCoreNotes,
} from "~/partners/lib/referrals.server";
import {
  REFERRAL_TIER_BLURB,
  REFERRAL_TIER_LABEL,
  REFERRAL_TIER_PAYOUT_USD,
} from "~/partners/lib/referral-quiz";
import { coreHandle } from "~/core/coreNav";
import { relativeTime } from "~/lib/relative-time";
import { useState } from "react";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: `${
      (data as { referral?: { partnerName: string } } | undefined)?.referral
        ?.partnerName ?? "Referral"
    } · Referrals · DALI OS`,
  },
];

export const handle = coreHandle(
  "partners",
  (data) =>
    (data as { referral?: { partnerName?: string } } | undefined)?.referral
      ?.partnerName,
);

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const referral = await getReferralForCore(params.id);
  if (!referral) return redirect("/core/partners/referrals");
  return { referral };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "save-notes") {
    const raw = String(form.get("coreNotes") ?? "").trim();
    await updateReferralCoreNotes({
      id: params.id,
      coreNotes: raw ? raw : null,
    });
    return { ok: true };
  }

  if (intent === "toggle-reached-out") {
    await setReferralReachedOut({
      id: params.id,
      reached: form.get("reached") === "1",
      actorUserId: auth.user.sub,
    });
    return { ok: true };
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

const TIER_ICON = {
  Cold: Snowflake,
  Warm: Handshake,
  FullPitch: Rocket,
} as const;

export default function ReferralDetail() {
  const { referral } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const Icon = TIER_ICON[referral.tier];
  const [notes, setNotes] = useState(referral.coreNotes ?? "");

  const reached = !!referral.reachedOutAt;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <div>
        <Link
          to="/core/partners/referrals"
          className="inline-flex items-center gap-1 text-xs text-os-grey hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All referrals
        </Link>
      </div>

      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-os-container text-os-ink">
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">
              {referral.partnerName}
            </h1>
            <span className="rounded-full bg-os-container px-2 py-0.5 text-xs text-os-grey">
              {REFERRAL_TIER_LABEL[referral.tier]} · $
              {REFERRAL_TIER_PAYOUT_USD[referral.tier]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {REFERRAL_TIER_BLURB[referral.tier]}
          </p>
          <p className="text-xs text-muted-foreground">
            Received {relativeTime(referral.createdAt)}
          </p>
        </div>
      </header>

      <section className="rounded-os-card bg-os-card">
        <div className="flex items-center justify-between border-b border-os-container px-5 py-3">
          <span className="text-sm font-medium text-foreground">Status</span>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="toggle-reached-out" />
            <input type="hidden" name="reached" value={reached ? "0" : "1"} />
            <button
              type="submit"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition",
                reached
                  ? "bg-os-container text-foreground hover:bg-os-container/70"
                  : "bg-foreground text-background hover:opacity-90",
              )}
            >
              {reached ? (
                <>
                  <Check className="h-3 w-3" /> Reached out — undo
                </>
              ) : (
                "Mark as reached out"
              )}
            </button>
          </fetcher.Form>
        </div>
        {reached && (
          <div className="px-5 py-3 text-xs text-muted-foreground">
            Marked {relativeTime(referral.reachedOutAt!)}
            {referral.reachedOutBy && (
              <>
                {" "}
                by {referral.reachedOutBy.firstName}{" "}
                {referral.reachedOutBy.lastName}
              </>
            )}
            .
          </div>
        )}
      </section>

      <section className="rounded-os-card bg-os-card">
        <FieldRow label="Partner name" value={referral.partnerName} />
        <FieldRow
          label="Partner email"
          value={referral.partnerEmail}
          icon={<Mail className="h-3.5 w-3.5" />}
          mono
        />
        <FieldRow label="Organization" value={referral.partnerOrgName} />
        <FieldRow label="Affiliation" value={referral.partnerAffiliation} />
        <FieldRow label="Context" value={referral.context} multiline />
        {referral.tier === "FullPitch" && (
          <FieldRow label="The pitch" value={referral.pitchBody} multiline />
        )}
      </section>

      <section className="rounded-os-card bg-os-card px-5 py-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <UserCircle2 className="h-4 w-4" />
          Referred by
        </div>
        <div className="text-sm text-foreground">
          {referral.referredBy.firstName} {referral.referredBy.lastName}
        </div>
        {referral.referredBy.daliEmail && (
          <div className="text-xs text-muted-foreground">
            {referral.referredBy.daliEmail}
          </div>
        )}
      </section>

      <section className="rounded-os-card bg-os-card px-5 py-4">
        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="save-notes" />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">
              Core notes
            </span>
            <textarea
              name="coreNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="Internal notes — what Core has done, what to do next."
              className="w-full resize-y rounded-md border border-os-container bg-os-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none"
            />
          </label>
          <div className="flex items-center justify-end">
            <button
              type="submit"
              className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:opacity-90"
            >
              Save notes
            </button>
          </div>
        </Form>
      </section>
    </div>
  );
}

function FieldRow({
  label,
  value,
  icon,
  multiline,
  mono,
}: {
  label: string;
  value: string | null;
  icon?: React.ReactNode;
  multiline?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-os-container px-5 py-3 last:border-0">
      <span className="flex items-center gap-1.5 text-xs text-os-grey">
        {icon}
        {label}
      </span>
      {value ? (
        <span
          className={cn(
            "text-sm text-foreground",
            multiline && "whitespace-pre-wrap",
            mono && "font-mono text-xs",
          )}
        >
          {value}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      )}
    </div>
  );
}
