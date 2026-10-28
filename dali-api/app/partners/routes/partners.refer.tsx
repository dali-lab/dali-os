import { useState } from "react";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { Copy, Mail, Lightbulb, UserPlus } from "lucide-react";
import type { Route } from "./+types/partners.refer";
import { requireAuth, isNonMember, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { logAuditEvent } from "~/lib/audit";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { buttonClasses } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import {
  createReferral,
  validateReferral,
  warmReferralLink,
} from "~/partners/lib/partner-referral.server";
import type { PartnerReferralType } from "~/generated/prisma/client";

export const meta: Route.MetaFunction = () => [
  { title: "Refer a partner · DALI OS" },
];

export const handle = {
  breadcrumb: () => "Refer a partner",
};

type ReferralMode = "cold" | "warm" | "pitch";

const MODE_TO_TYPE: Record<ReferralMode, PartnerReferralType> = {
  cold: "ColdLead",
  warm: "WarmLead",
  pitch: "FundedPitch",
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const toPortal = await redirectPartnerToPortal(auth);
  if (toPortal) return toPortal;
  if (await isNonMember(auth, request)) return redirect("/portal");
  return { userId: auth.user.sub };
}

type ActionSuccess = {
  ok: true;
  mode: ReferralMode;
  referralId: string;
  shareLink: string | null;
};
type ActionError = { ok: false; error: string; mode: ReferralMode };
type ActionResult = ActionSuccess | ActionError;

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");

  const form = await request.formData();
  const rawMode = String(form.get("mode") ?? "");
  const mode: ReferralMode =
    rawMode === "cold" || rawMode === "warm" || rawMode === "pitch" ? rawMode : "cold";
  const type = MODE_TO_TYPE[mode];

  const input = {
    referrerUserId: auth.user.sub,
    type,
    rawName: (form.get("rawName") as string | null) ?? null,
    rawEmail: (form.get("rawEmail") as string | null) ?? null,
    rawOrg: (form.get("rawOrg") as string | null) ?? null,
    rawPhone: (form.get("rawPhone") as string | null) ?? null,
    rawLinkedinUrl: (form.get("rawLinkedinUrl") as string | null) ?? null,
    pitchTitle: (form.get("pitchTitle") as string | null) ?? null,
    pitchSummary: (form.get("pitchSummary") as string | null) ?? null,
    notes: (form.get("notes") as string | null) ?? null,
  };

  const bad = validateReferral(input);
  if (bad) return { ok: false, mode, error: bad };

  const row = await createReferral(input);

  await logAuditEvent({
    action: "partner.referral.submitted",
    userId: auth.user.sub,
    targetId: row.id,
    metadata: { type: row.type },
    request,
  });

  const shareLink =
    row.type === "WarmLead" && row.token ? warmReferralLink(request, row.token) : null;

  return { ok: true, mode, referralId: row.id, shareLink };
}

const TAB_META: Record<
  ReferralMode,
  { label: string; icon: typeof UserPlus; blurb: string }
> = {
  cold: {
    label: "Refer a contact",
    icon: UserPlus,
    blurb:
      "Drop a name, email, or anything else that helps us reach out. We'll follow up with them.",
  },
  warm: {
    label: "Send them our application",
    icon: Mail,
    blurb:
      "Already talked to them? Submit this and we'll give you a personal link to send — we'll know they came through you when they apply.",
  },
  pitch: {
    label: "Pitch an idea",
    icon: Lightbulb,
    blurb:
      "Have an idea you'd like to pitch to a partner? Tell us the partner and the pitch and Core will take it from there.",
  },
};

export default function PartnersReferPage() {
  const { userId: _userId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [mode, setMode] = useState<ReferralMode>(
    actionData && !actionData.ok ? actionData.mode : "cold",
  );
  const submitting = navigation.state === "submitting";
  const chrome = useOsChrome();

  const success = actionData && actionData.ok ? actionData : null;
  const errorText =
    actionData && !actionData.ok && actionData.mode === mode ? actionData.error : null;

  const tabs = (Object.keys(TAB_META) as ReferralMode[]).map((key) => ({
    label: TAB_META[key].label,
    icon: TAB_META[key].icon,
    active: mode === key,
    onClick: () => setMode(key),
  }));

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-medium text-foreground">
          Refer a partner
        </h1>
        <p className="text-sm text-os-grey">
          Know someone who might want to work with DALI? Pick how you'd like to
          refer them. Core will reach out when they're processing it.
        </p>
      </header>

      <SegmentedTabButtons items={tabs} label="Referral type" className="self-start" />

      <p className="text-sm text-os-grey">{TAB_META[mode].blurb}</p>

      {success && success.mode === mode && (
        <SuccessPanel mode={success.mode} shareLink={success.shareLink} />
      )}

      <Form method="post" className={chrome.formClass + " flex flex-col gap-4"}>
        <input type="hidden" name="mode" value={mode} />

        {mode === "pitch" ? <PitchFields /> : <ContactFields />}

        <UncontrolledTextarea
          name="notes"
          label="Notes (optional)"
          rows={3}
          placeholder="Context, how you know them, or how we might open the conversation."
        />

        {errorText && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {errorText}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className={buttonClasses("primary")}
          >
            {submitting ? "Submitting…" : "Submit referral"}
          </button>
        </div>
      </Form>
    </div>
  );
}

function ContactFields() {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UncontrolledField name="rawName" label="Name" placeholder="Jane Smith" />
        <UncontrolledField
          name="rawEmail"
          label="Email"
          type="email"
          placeholder="jane@company.com"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UncontrolledField name="rawOrg" label="Organization" placeholder="Acme Inc." />
        <UncontrolledField name="rawPhone" label="Phone (optional)" />
      </div>
      <UncontrolledField
        name="rawLinkedinUrl"
        label="LinkedIn (optional)"
        placeholder="https://linkedin.com/in/…"
      />
    </>
  );
}

function PitchFields() {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UncontrolledField
          name="rawName"
          label="Partner contact"
          placeholder="Jane Smith (optional if you know the org)"
        />
        <UncontrolledField
          name="rawEmail"
          label="Partner email"
          type="email"
          placeholder="jane@company.com (optional)"
        />
      </div>
      <UncontrolledField
        name="rawOrg"
        label="Partner organization"
        placeholder="Acme Inc."
      />
      <UncontrolledField
        name="pitchTitle"
        label="Pitch title"
        placeholder="e.g. ML-powered inventory forecasting"
      />
      <UncontrolledTextarea
        name="pitchSummary"
        label="Pitch summary"
        rows={4}
        placeholder="A sentence or two on what you'd pitch and why it fits them."
      />
    </>
  );
}

function UncontrolledField({
  name,
  label,
  type = "text",
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
}) {
  const chrome = useOsChrome();
  return (
    <label className={chrome.fieldLabel}>
      <span>{label}</span>
      <input type={type} name={name} placeholder={placeholder} className="w-full" />
    </label>
  );
}

function UncontrolledTextarea({
  name,
  label,
  rows = 3,
  placeholder,
}: {
  name: string;
  label: string;
  rows?: number;
  placeholder?: string;
}) {
  const chrome = useOsChrome();
  return (
    <label className={chrome.fieldLabel}>
      <span>{label}</span>
      <textarea
        name={name}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y leading-6"
      />
    </label>
  );
}

function SuccessPanel({
  mode,
  shareLink,
}: {
  mode: ReferralMode;
  shareLink: string | null;
}) {
  if (mode === "warm" && shareLink) {
    return (
      <div className="rounded-lg border border-accent-coral/40 bg-accent-coral/5 px-4 py-3 flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">
          Nice — here's your personal link.
        </p>
        <p className="text-xs text-os-grey">
          Send this to the partner. When they apply through this link, we'll
          know you brought them in.
        </p>
        <WarmLinkCopy link={shareLink} />
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm text-foreground">
      Got it. Core will reach out when they're processing this.
    </div>
  );
}

function WarmLinkCopy({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access can fail in locked-down browsers; the raw link
      // is still visible for the member to select manually.
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <code className="flex-1 truncate text-xs text-foreground">{link}</code>
      <button
        type="button"
        onClick={copy}
        className={buttonClasses("secondary", "xs")}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
