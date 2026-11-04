// Tier-specific referral submission form. Addressed as /refer/new?tier=Cold,
// Warm, or FullPitch. Requires that the member has passed the quiz; if not,
// bounce back to /refer which renders it.

import { useState } from "react";
import { Form, Link, redirect, useLoaderData, useNavigation } from "react-router";
import { ArrowLeft, Handshake, Rocket, Snowflake } from "lucide-react";
import type { Route } from "./+types/refer.new";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import {
  REFERRAL_TIER_BLURB,
  REFERRAL_TIER_LABEL,
  REFERRAL_TIER_PAYOUT_USD,
} from "~/partners/lib/referral-quiz";
import {
  createPartnerReferral,
  hasPassedReferralQuiz,
} from "~/partners/lib/referrals.server";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [
  { title: "New referral · DALI OS" },
];

type Tier = "Cold" | "Warm" | "FullPitch";

function parseTier(raw: string | null): Tier | null {
  if (raw === "Cold" || raw === "Warm" || raw === "FullPitch") return raw;
  return null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const redirectResp = await redirectNonMemberToPortal(auth, request);
  if (redirectResp) return redirectResp;
  if (!(await hasPassedReferralQuiz(auth.user.sub))) {
    return redirect("/refer");
  }
  const url = new URL(request.url);
  const tier = parseTier(url.searchParams.get("tier"));
  if (!tier) return redirect("/refer");
  return { tier };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await hasPassedReferralQuiz(auth.user.sub))) {
    return redirect("/refer");
  }
  const form = await request.formData();
  const tier = parseTier(String(form.get("tier") ?? ""));
  if (!tier) return { error: "Pick a tier before submitting." };

  const partnerName = String(form.get("partnerName") ?? "").trim();
  const context = String(form.get("context") ?? "").trim();
  const partnerEmail = String(form.get("partnerEmail") ?? "").trim();
  const partnerAffiliation = String(form.get("partnerAffiliation") ?? "").trim();
  const partnerOrgName = String(form.get("partnerOrgName") ?? "").trim();
  const pitchBody = String(form.get("pitchBody") ?? "").trim();

  if (!partnerName) return { error: "Who is the partner?" };
  if (!context) return { error: "Add a sentence or two of context." };
  // Warm/FullPitch really do need a way for Core to reach the partner — Cold
  // can be just a name + context if that's all the referrer knows (we'll chase
  // them for more via the referrer).
  if ((tier === "Warm" || tier === "FullPitch") && !partnerEmail) {
    return {
      error:
        "For this tier Core needs a way to reach the partner — add an email.",
    };
  }
  if (tier === "FullPitch" && !pitchBody) {
    return { error: "Add your pitch so Core knows what the partner agreed to." };
  }

  const referral = await createPartnerReferral({
    referredByUserId: auth.user.sub,
    tier,
    partnerName,
    partnerEmail: partnerEmail || null,
    partnerAffiliation: partnerAffiliation || null,
    partnerOrgName: partnerOrgName || null,
    context,
    pitchBody: pitchBody || null,
  });

  return redirect(`/refer/done?id=${referral.id}`);
}

const TIER_ICON = {
  Cold: Snowflake,
  Warm: Handshake,
  FullPitch: Rocket,
} as const;

export default function NewReferral({ actionData }: Route.ComponentProps) {
  const { tier } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error =
    actionData && "error" in actionData ? (actionData as { error: string }).error : null;
  const Icon = TIER_ICON[tier];

  const [partnerEmail, setPartnerEmail] = useState("");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
      <div>
        <Link
          to="/refer"
          className="inline-flex items-center gap-1 text-xs text-os-grey hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Pick a different tier
        </Link>
      </div>

      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-os-container text-os-ink">
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">
              {REFERRAL_TIER_LABEL[tier]}
            </h1>
            <span className="rounded-full bg-os-container px-2 py-0.5 text-xs text-os-grey">
              ${REFERRAL_TIER_PAYOUT_USD[tier]} on signing
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {REFERRAL_TIER_BLURB[tier]}
          </p>
        </div>
      </header>

      <Form method="post" className="flex flex-col gap-5">
        <input type="hidden" name="tier" value={tier} />

        {error && (
          <div className="rounded-os-card border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Field label="Partner name" required>
          <input
            name="partnerName"
            required
            maxLength={200}
            className={inputCls}
            placeholder="Person or organization"
          />
        </Field>

        <Field
          label="Partner email"
          required={tier !== "Cold"}
          hint={
            tier === "Cold"
              ? "Optional — share what you know."
              : "Core will reach out here to coordinate."
          }
        >
          <input
            name="partnerEmail"
            type="email"
            required={tier !== "Cold"}
            value={partnerEmail}
            onChange={(e) => setPartnerEmail(e.target.value)}
            className={inputCls}
            placeholder="name@example.com"
          />
        </Field>

        <Field label="Organization" hint="If separate from the person's name.">
          <input
            name="partnerOrgName"
            className={inputCls}
            placeholder="Their company, lab, nonprofit, etc."
          />
        </Field>

        <Field label="Affiliation" hint="How do you know them?">
          <input
            name="partnerAffiliation"
            className={inputCls}
            placeholder="Family friend, professor, someone I met at…"
          />
        </Field>

        <Field
          label="Context"
          required
          hint="Why this partner? What kind of project do you imagine?"
        >
          <textarea
            name="context"
            required
            maxLength={2000}
            rows={4}
            className={cn(inputCls, "resize-y")}
          />
        </Field>

        {tier === "FullPitch" && (
          <Field
            label="Your pitch"
            required
            hint="What did you pitch to them, and what did they agree to?"
          >
            <textarea
              name="pitchBody"
              required
              maxLength={4000}
              rows={6}
              className={cn(inputCls, "resize-y")}
            />
          </Field>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-os-container pt-4">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit referral"}
          </button>
        </div>
      </Form>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-os-container bg-os-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
