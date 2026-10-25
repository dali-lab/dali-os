import { useEffect, useRef, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { History, Plus, ShieldCheck, X } from "lucide-react";
import type { Route } from "./+types/admin.security";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState } from "~/admin/components/console-ui";
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
import { Select, Tooltip } from "~/components/ui/floating";
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
  const canEdit = await isAdmin(auth.user.sub);
  return {
    blocked: rules.filter((r) => r.kind === "block"),
    trusted: rules.filter((r) => r.kind === "trust"),
    canEdit,
    isAdmin: canEdit,
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

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RuleRow({ rule, canEdit }: { rule: Rule; canEdit: boolean }) {
  const fetcher = useFetcher<ActionResult>();
  const dialog = useDialog();
  const { iconBtn } = useOsChrome();
  const address = rule.cidr.replace(/\/(32|128)$/, "");
  const isBlock = rule.kind === "block";
  const removeLabel = isBlock ? `Unblock ${rule.cidr}` : `Stop trusting ${rule.cidr}`;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  const remove = async () => {
    const ok = await dialog.confirm({
      title: isBlock ? `Unblock ${rule.cidr}?` : `Stop trusting ${rule.cidr}?`,
      description: isBlock
        ? "Sign-in from this address works again within a minute."
        : "This range gets the normal per-IP code limit and can be blocked automatically.",
      tone: "destructive",
      confirmLabel: isBlock ? "Unblock" : "Remove",
    });
    if (ok) fetcher.submit({ intent: "remove", id: rule.id }, { method: "post" });
  };

  return (
    <li className="flex items-start gap-4 border-t border-os-container/70 px-6 py-4 first:border-t-0">
      {!isBlock && <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-os-green" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="break-all font-mono text-sm text-foreground">{rule.cidr}</p>
        <p className="mt-0.5 text-sm text-os-grey">
          {rule.reason ?? "No reason given"}
          {rule.source === "auto" ? " · automatic" : ""}
        </p>
        <p className="mt-1 text-xs text-os-muted">
          Added {formatDay(rule.createdAt)}
          {isBlock && ` · ${rule.expiresAt ? `Until ${formatTime(rule.expiresAt)}` : "Permanent"}`}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip content="Activity from this address">
          <Link
            to={`/admin/insights/audit-log?person=${encodeURIComponent(address)}`}
            aria-label={`Activity from ${address}`}
            className={iconBtn}
          >
            <History className="h-4 w-4" />
          </Link>
        </Tooltip>
        {canEdit && (
          <Tooltip content={isBlock ? "Unblock" : "Remove"}>
            <button
              type="button"
              onClick={remove}
              disabled={fetcher.state !== "idle"}
              aria-label={removeLabel}
              className={cn(iconBtn, "disabled:opacity-50")}
            >
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

function AddRuleForm({ kind }: { kind: IpRuleKind }) {
  const fetcher = useFetcher<ActionResult>();
  const dialog = useDialog();
  const { formClass, formTrigger, actionBtn, actionBtnPrimary } = useOsChrome();
  const formRef = useRef<HTMLFormElement>(null);
  const [duration, setDuration] = useState<Duration>("24h");
  const isBlock = kind === "block";

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
  const busy = fetcher.state !== "idle";

  const cidrInput = (
    <input
      type="text"
      name="cidr"
      required
      aria-label={isBlock ? "IP address or range" : "Range"}
      placeholder={isBlock ? "IP address or range" : "10.8.0.0/16"}
      autoComplete="off"
      spellCheck={false}
      className={cn("min-w-0 font-mono", isBlock ? "sm:w-48" : "flex-1")}
    />
  );
  const reasonInput = (
    <input
      type="text"
      name="reason"
      aria-label="Reason"
      placeholder={isBlock ? "Reason" : "Label, like Lab VPN"}
      className={cn("min-w-0", isBlock && "flex-1")}
    />
  );

  return (
    <fetcher.Form ref={formRef} method="post" className={cn(formClass, "flex flex-col gap-2")}>
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="kind" value={kind} />
      {isBlock ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {cidrInput}
          {reasonInput}
          <div className="sm:w-36">
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
          <button type="submit" disabled={busy} className={cn(actionBtnPrimary, "disabled:opacity-50")}>
            Block
          </button>
        </div>
      ) : (
        <>
          {reasonInput}
          <div className="flex gap-2">
            {cidrInput}
            <button type="submit" disabled={busy} className={cn(actionBtn(), "disabled:opacity-50")}>
              <Plus className="h-4 w-4" /> Trust
            </button>
          </div>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </fetcher.Form>
  );
}

function RuleSection({
  id,
  title,
  description,
  empty,
  rules,
  kind,
  canEdit,
}: {
  id: string;
  title: string;
  description: string;
  empty: string;
  rules: Rule[];
  kind: IpRuleKind;
  canEdit: boolean;
}) {
  const { panel, sectionTitle, bodyText } = useOsChrome();
  const form = canEdit && (
    <div className={cn("p-4", kind === "block" ? "border-b" : "border-t", "border-os-container/70")}>
      <AddRuleForm kind={kind} />
    </div>
  );
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={id}>
      <div>
        <h2 id={id} className={sectionTitle}>
          {title}
        </h2>
        <p className={cn(bodyText, "mt-1")}>{description}</p>
      </div>
      <div className={panel}>
        {kind === "block" && form}
        {rules.length === 0 ? (
          <EmptyState>{empty}</EmptyState>
        ) : (
          <ul>
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} canEdit={canEdit} />
            ))}
          </ul>
        )}
        {kind === "trust" && form}
      </div>
    </section>
  );
}

export default function AdminSecurity() {
  const { blocked, trusted, canEdit } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader section="accounts" />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <RuleSection
          id="blocked-title"
          title="Blocked addresses"
          description="Sign-in from these addresses is refused by every method. An address outside the trusted networks is blocked for 24 hours automatically after it is refused sign-in codes 3 times in an hour."
          empty="No addresses are blocked."
          rules={blocked}
          kind="block"
          canEdit={canEdit}
        />
        <RuleSection
          id="trusted-title"
          title="Trusted networks"
          description="Shared networks like campus Wi-Fi, where many members sign in from one address. They are never blocked automatically and allow 50 code requests per address every 10 minutes instead of 10. Each person is still limited to 3 codes every 10 minutes, 5 an hour and 10 a day."
          empty="No trusted networks."
          rules={trusted}
          kind="trust"
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
