import { useEffect, useRef, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.security";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  addIpRule,
  findOverlappingTrust,
  normalizeCidr,
  removeIpRule,
  type IpRuleKind,
} from "~/lib/ip-rules.server";
import { buttonClasses } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

export const handle = adminHandle("security");

export const meta: Route.MetaFunction = () => [{ title: "Security · Admin · DALI OS" }];

const DURATIONS = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  permanent: null,
} as const;
type Duration = keyof typeof DURATIONS;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const now = new Date();
  const rows = await prisma.ipRule.findMany({
    where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
  });
  const rules = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    cidr: r.cidr,
    reason: r.reason,
    source: r.source,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
  return {
    blocked: rules.filter((r) => r.kind === "block"),
    trusted: rules.filter((r) => r.kind === "trust"),
    canEdit: await isAdmin(auth.user.sub),
  };
}

type ActionResult = { ok: true } | { error: string } | { needsConfirm: string };

export async function action({ request }: Route.ActionArgs): Promise<ActionResult | Response> {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdmin(auth.user.sub))) {
    return Response.json({ error: "Only admins can change IP rules." }, { status: 403 });
  }

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "remove") {
    const id = String(form.get("id") ?? "");
    const removed = id ? await removeIpRule(id) : null;
    if (!removed) return { error: "That rule no longer exists." };
    await logAuditEvent({
      action: "security.ip.remove",
      userId: auth.user.sub,
      metadata: { kind: removed.kind, cidr: removed.cidr },
      request,
    });
    return { ok: true };
  }

  if (intent === "add") {
    const kind = form.get("kind");
    if (kind !== "block" && kind !== "trust") return { error: "Unknown rule type." };
    const cidr = normalizeCidr(String(form.get("cidr") ?? ""));
    if (!cidr) return { error: "Enter an IP address or a range like 129.170.0.0/16." };
    const reason = String(form.get("reason") ?? "").trim() || null;

    let expiresAt: Date | null = null;
    if (kind === "block") {
      const duration = String(form.get("duration") ?? "permanent") as Duration;
      if (!(duration in DURATIONS)) return { error: "Unknown duration." };
      const ms = DURATIONS[duration];
      expiresAt = ms === null ? null : new Date(Date.now() + ms);

      if (form.get("confirmTrusted") !== "1") {
        const overlap = await findOverlappingTrust(cidr);
        if (overlap) return { needsConfirm: overlap };
      }
    }

    await addIpRule({
      kind: kind as IpRuleKind,
      cidr,
      reason,
      expiresAt,
      createdByUserId: auth.user.sub,
    });
    await logAuditEvent({
      action: kind === "block" ? "security.ip.block" : "security.ip.trust",
      userId: auth.user.sub,
      metadata: { cidr, reason, expiresAt: expiresAt?.toISOString() ?? null },
      request,
    });
    return { ok: true };
  }

  return { error: "Invalid intent" };
}

type Rule = ReturnType<typeof useLoaderData<typeof loader>>["blocked"][number];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RuleRow({ rule, canEdit }: { rule: Rule; canEdit: boolean }) {
  const fetcher = useFetcher<ActionResult>();
  const dialog = useDialog();
  const address = rule.cidr.replace(/\/(32|128)$/, "");

  const remove = async () => {
    const ok = await dialog.confirm({
      title: rule.kind === "block" ? `Unblock ${rule.cidr}?` : `Stop trusting ${rule.cidr}?`,
      description:
        rule.kind === "block"
          ? "Sign-in from this address works again within a minute."
          : "This range gets the normal per-IP code limit and can be blocked automatically.",
      tone: "destructive",
      confirmLabel: rule.kind === "block" ? "Unblock" : "Remove",
    });
    if (ok) fetcher.submit({ intent: "remove", id: rule.id }, { method: "post" });
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <span className="min-w-44 font-mono text-sm text-foreground">{rule.cidr}</span>
      <span className="text-sm text-muted-foreground">
        {rule.reason ?? "No reason given"}
        {rule.source === "auto" ? " · automatic" : ""}
      </span>
      <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        {rule.kind === "block" && (
          <span>{rule.expiresAt ? `Until ${formatTime(rule.expiresAt)}` : "Permanent"}</span>
        )}
        <Link
          to={`/admin/activity?person=${encodeURIComponent(address)}`}
          className="underline-offset-2 hover:underline"
        >
          Activity
        </Link>
        {canEdit && (
          <button
            type="button"
            onClick={remove}
            disabled={fetcher.state !== "idle"}
            className={buttonClasses("ghost", "sm")}
          >
            {rule.kind === "block" ? "Unblock" : "Remove"}
          </button>
        )}
      </span>
    </li>
  );
}

function AddRuleForm({ kind }: { kind: IpRuleKind }) {
  const fetcher = useFetcher<ActionResult>();
  const dialog = useDialog();
  const { formClass, fieldLabel, formTrigger } = useOsChrome();
  const formRef = useRef<HTMLFormElement>(null);
  const [duration, setDuration] = useState<Duration>("24h");

  useEffect(() => {
    const data = fetcher.data;
    if (!data || fetcher.state !== "idle") return;
    if ("ok" in data) formRef.current?.reset();
    if (!("needsConfirm" in data) || !formRef.current) return;
    const form = new FormData(formRef.current);
    void dialog
      .confirm({
        title: `Block an address on a trusted network?`,
        description: `This is inside ${data.needsConfirm}, which many members share. Blocking it may cut off everyone on that network.`,
        tone: "destructive",
        confirmLabel: "Block anyway",
      })
      .then((ok) => {
        if (!ok) return;
        form.set("confirmTrusted", "1");
        fetcher.submit(form, { method: "post" });
      });
  }, [fetcher.data, fetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  return (
    <fetcher.Form ref={formRef} method="post" className={cn(formClass, "flex flex-wrap items-end gap-3")}>
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="kind" value={kind} />
      <label className={cn(fieldLabel, "min-w-48 flex-1")}>
        {kind === "block" ? "IP address or range" : "Range"}
        <input
          type="text"
          name="cidr"
          required
          placeholder={kind === "block" ? "203.0.113.7" : "10.8.0.0/16"}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className={cn(fieldLabel, "min-w-48 flex-[2]")}>
        Reason
        <input type="text" name="reason" placeholder={kind === "block" ? "Scripted sign-in attempts" : "Lab VPN"} />
      </label>
      {kind === "block" && (
        <div className={cn(fieldLabel, "w-40")}>
          For
          <Select<Duration>
            name="duration"
            value={duration}
            onChange={setDuration}
            ariaLabel="Block duration"
            buttonClassName={formTrigger}
            options={[
              { value: "24h", label: "24 hours" },
              { value: "7d", label: "7 days" },
              { value: "permanent", label: "Permanent" },
            ]}
          />
        </div>
      )}
      <button type="submit" disabled={fetcher.state !== "idle"} className={buttonClasses("primary", "sm")}>
        {kind === "block" ? "Block" : "Trust"}
      </button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </fetcher.Form>
  );
}

function RuleSection({
  title,
  description,
  empty,
  rules,
  kind,
  canEdit,
}: {
  title: string;
  description: string;
  empty: string;
  rules: Rule[];
  kind: IpRuleKind;
  canEdit: boolean;
}) {
  const { card, cardPad, sectionTitle, bodyText } = useOsChrome();
  return (
    <section className="flex flex-col gap-3">
      <h2 className={sectionTitle}>{title}</h2>
      <p className={bodyText}>{description}</p>
      <div className={cn(card, cardPad, "flex flex-col gap-2")}>
        {rules.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} canEdit={canEdit} />
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="border-t border-border pt-3">
            <AddRuleForm kind={kind} />
          </div>
        )}
      </div>
    </section>
  );
}

export default function AdminSecurity() {
  const { blocked, trusted, canEdit } = useLoaderData<typeof loader>();
  const { pageTitle } = useOsChrome();
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className={pageTitle}>Security</h1>
      </header>
      <RuleSection
        title="Blocked addresses"
        description="Sign-in from these addresses is refused by every method. An address outside the trusted networks is blocked for 24 hours automatically after it is refused sign-in codes 3 times in an hour."
        empty="No addresses are blocked."
        rules={blocked}
        kind="block"
        canEdit={canEdit}
      />
      <RuleSection
        title="Trusted networks"
        description="Shared networks like campus Wi-Fi, where many members sign in from one address. They are never blocked automatically and allow 50 code requests per address every 10 minutes instead of 10. Each person is still limited to 3 codes every 10 minutes."
        empty="No trusted networks."
        rules={trusted}
        kind="trust"
        canEdit={canEdit}
      />
    </div>
  );
}
