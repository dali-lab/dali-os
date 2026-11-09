import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { Plus } from "lucide-react";
import type { Route } from "./+types/mentorship.warnings";
import { prisma } from "~/lib/db";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { Avatar } from "~/components/ui/Avatar";
import { DateField } from "~/components/ui/DateField";
import { Field } from "~/components/ui/modal-fields";
import { Segmented } from "~/components/ui/Segmented";
import { SearchInput } from "~/components/ui/SearchInput";
import { Combobox, Select } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { modalCardClass } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { EmptyState } from "../components/EmptyState";
import {
  WARNING_REASONS,
  reasonLabel,
  validateWarning,
  type WarningReason,
  type WarningStatus,
} from "../lib/warnings";
import { requireWarningsAdmin } from "../lib/warnings.server";

export const meta: Route.MetaFunction = () => [{ title: "Mentorship warnings · DALI OS" }];

type Person = { id: string; name: string; photoUrl: string | null };
type Warning = {
  id: string;
  member: Person;
  reason: string;
  notes: string;
  occurredOn: string;
  status: WarningStatus;
};

const personName = (u: { name: string; firstName: string; lastName: string }) =>
  u.name?.trim() || `${u.firstName} ${u.lastName}`.trim();

export async function loader({ request }: Route.LoaderArgs) {
  await requireWarningsAdmin(request);
  const [rows, users] = await Promise.all([
    prisma.mentorshipWarning.findMany({
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      include: { member: { select: { id: true, name: true, firstName: true, lastName: true, photoUrl: true } } },
    }),
    prisma.user.findMany({
      where: { membershipStatus: "Active" },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, name: true, firstName: true, lastName: true, photoUrl: true },
    }),
  ]);
  const warnings: Warning[] = rows.map((w) => ({
    id: w.id,
    member: { id: w.member.id, name: personName(w.member), photoUrl: w.member.photoUrl },
    reason: w.reason,
    notes: w.notes,
    occurredOn: w.occurredOn.toISOString().slice(0, 10),
    status: w.status === "resolved" ? "resolved" : "open",
  }));
  const members: Person[] = users.map((u) => ({ id: u.id, name: personName(u), photoUrl: u.photoUrl }));
  return { warnings, members };
}

type ActionResult = { ok: true; message: string; intent: string } | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  const userId = await requireWarningsAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  if (intent === "create" || intent === "update") {
    const input = {
      memberId: String(form.get("memberId") ?? ""),
      reason: String(form.get("reason") ?? "") as WarningReason,
      notes: String(form.get("notes") ?? "").trim(),
      occurredOn: String(form.get("occurredOn") ?? ""),
    };
    const invalid = validateWarning(input);
    if (invalid) return { ok: false, error: invalid };
    const member = await prisma.user.findUnique({ where: { id: input.memberId }, select: { id: true } });
    if (!member) return { ok: false, error: "That member no longer exists." };
    const data = {
      memberId: input.memberId,
      reason: input.reason,
      notes: input.notes,
      occurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`),
    };
    if (intent === "create") {
      await prisma.mentorshipWarning.create({ data: { ...data, createdById: userId } });
      return { ok: true, intent, message: "Warning saved." };
    }
    await prisma.mentorshipWarning.update({ where: { id }, data });
    return { ok: true, intent, message: "Warning updated." };
  }

  if (intent === "status") {
    const status = String(form.get("status"));
    if (status !== "open" && status !== "resolved") return { ok: false, error: "Invalid status." };
    await prisma.mentorshipWarning.update({ where: { id }, data: { status } });
    return { ok: true, intent, message: status === "resolved" ? "Marked resolved." : "Reopened." };
  }

  if (intent === "delete") {
    await prisma.mentorshipWarning.delete({ where: { id } });
    return { ok: true, intent, message: "Warning deleted." };
  }

  return { ok: false, error: "Unknown action." };
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function StatusBadge({ status }: { status: WarningStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        status === "open" ? "bg-os-accent/10 text-os-accent" : "bg-muted text-muted-foreground",
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", status === "open" ? "bg-os-accent" : "bg-muted-foreground/60")} />
      {status === "open" ? "Open" : "Resolved"}
    </span>
  );
}

export default function MentorshipWarnings() {
  const { warnings, members } = useLoaderData<typeof loader>();
  const { pageTitle, panel } = useOsChrome();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | WarningStatus>("all");
  const [panelState, setPanelState] = useState<{ mode: "create" } | { mode: "view" | "edit"; id: string } | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return warnings.filter(
      (w) => (filter === "all" || w.status === filter) && (!q || w.member.name.toLowerCase().includes(q)),
    );
  }, [warnings, query, filter]);

  const active = panelState && panelState.mode !== "create" ? warnings.find((w) => w.id === panelState.id) : undefined;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className={pageTitle}>Mentorship warnings</h1>
          <button type="button" className="os-btn-primary os-btn-primary--sm" onClick={() => setPanelState({ mode: "create" })}>
            <Plus className="h-4 w-4" aria-hidden />
            Add warning
          </button>
        </div>
        <p className="text-sm text-muted-foreground">Track and manage participation concerns across the lab.</p>
        <Link to="/mentorship/browse" className="mt-1 text-sm text-muted-foreground hover:underline self-start">
          ← Mentorship notes
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          size="sm"
          aria-label="Search members"
          placeholder="Search members"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          containerClassName="w-full sm:w-64"
        />
        <Segmented
          ariaLabel="Filter by status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "open", label: "Open" },
            { value: "resolved", label: "Resolved" },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState>{warnings.length === 0 ? "No warnings recorded." : "No warnings match."}</EmptyState>
      ) : (
        <ul className={cn(panel, "divide-y divide-border overflow-hidden p-0")}>
          {shown.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => setPanelState({ mode: "view", id: w.id })}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-os-accent/40 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_7rem_6.5rem]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={w.member.name} photoUrl={w.member.photoUrl} size="sm" />
                  <span className="truncate text-sm font-medium">{w.member.name}</span>
                </span>
                <span className="order-3 col-span-2 truncate pl-11 text-sm text-muted-foreground sm:order-none sm:col-span-1 sm:pl-0">
                  {reasonLabel(w.reason)}
                </span>
                <span className="order-4 hidden text-sm text-muted-foreground sm:block">{formatDate(w.occurredOn)}</span>
                <span className="justify-self-end sm:justify-self-start">
                  <StatusBadge status={w.status} />
                </span>
                <span className="order-5 col-span-2 pl-11 text-xs text-muted-foreground sm:hidden">{formatDate(w.occurredOn)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {panelState?.mode === "create" && (
        <WarningModal key="create" mode="create" members={members} onClose={() => setPanelState(null)} />
      )}
      {active && panelState && panelState.mode !== "create" && (
        <WarningModal
          key={active.id}
          mode={panelState.mode}
          warning={active}
          members={members}
          onEdit={() => setPanelState({ mode: "edit", id: active.id })}
          onClose={() => setPanelState(null)}
        />
      )}
    </main>
  );
}

function WarningModal({
  mode,
  warning,
  members,
  onEdit,
  onClose,
}: {
  mode: "create" | "view" | "edit";
  warning?: Warning;
  members: Person[];
  onEdit?: () => void;
  onClose: () => void;
}) {
  const fetcher = useFetcher<ActionResult>();
  const toast = useToast();
  const dialog = useDialog();
  const editing = mode !== "view";
  const [memberId, setMemberId] = useState(warning?.member.id ?? "");
  const [reason, setReason] = useState<WarningReason>((warning?.reason as WarningReason) ?? "missed_meeting");
  const [notes, setNotes] = useState(warning?.notes ?? "");
  const [date, setDate] = useState(warning?.occurredOn ?? todayIso());
  const [error, setError] = useState<string | null>(null);
  const memberRef = useRef<HTMLInputElement>(null);
  const handled = useRef<unknown>(null);

  const busy = fetcher.state !== "idle";
  const titleId = "mentorship-warning-modal-title";

  useEffect(() => {
    const d = fetcher.data;
    if (!d || handled.current === d) return;
    handled.current = d;
    if (d.ok) {
      toast.success(d.message);
      onClose();
    } else {
      setError(d.error);
    }
  }, [fetcher.data, onClose, toast]);

  const submit = (fields: Record<string, string>) => fetcher.submit(fields, { method: "post" });

  const save = () => {
    const invalid = validateWarning({ memberId, reason, notes, occurredOn: date });
    if (invalid) return setError(invalid);
    setError(null);
    submit({
      intent: mode === "create" ? "create" : "update",
      ...(warning ? { id: warning.id } : {}),
      memberId,
      reason,
      notes,
      occurredOn: date,
    });
  };

  const memberOptions = members.map((m) => ({
    value: m.id,
    label: m.name,
    icon: <Avatar name={m.name} photoUrl={m.photoUrl} size="xs" />,
  }));

  return (
    <Modal open onClose={onClose} labelledBy={titleId} disableEscape={busy} containerClassName={modalCardClass("max-w-md")} initialFocusRef={editing ? memberRef : undefined}>
      <ModalHeader
        titleId={titleId}
        title={mode === "create" ? "Add warning" : mode === "edit" ? "Edit warning" : "Warning"}
        onClose={onClose}
      />

      {!editing && warning ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={warning.member.name} photoUrl={warning.member.photoUrl} size="md" />
            <div className="min-w-0">
              <p className="truncate font-medium">{warning.member.name}</p>
              <StatusBadge status={warning.status} />
            </div>
          </div>
          <dl className="grid grid-cols-[5rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Reason</dt>
            <dd>{reasonLabel(warning.reason)}</dd>
            <dt className="text-muted-foreground">Date</dt>
            <dd>{formatDate(warning.occurredOn)}</dd>
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="whitespace-pre-wrap">{warning.notes || <span className="text-muted-foreground">None</span>}</dd>
          </dl>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="os-btn-ghost mr-auto text-red-600"
              disabled={busy}
              onClick={async () => {
                const ok = await dialog.confirm({
                  title: "Delete this warning?",
                  description: `This permanently removes the warning for ${warning.member.name}.`,
                  confirmLabel: "Delete",
                  tone: "destructive",
                });
                if (ok) submit({ intent: "delete", id: warning.id });
              }}
            >
              Delete
            </button>
            <button type="button" className="os-edit-btn" onClick={onEdit}>
              Edit
            </button>
            <button
              type="button"
              className="os-btn-primary os-btn-primary--sm"
              disabled={busy}
              onClick={() =>
                submit({ intent: "status", id: warning.id, status: warning.status === "open" ? "resolved" : "open" })
              }
            >
              {warning.status === "open" ? "Mark resolved" : "Reopen"}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Member">
            <Combobox
              value={memberId}
              options={memberOptions}
              onChange={setMemberId}
              ariaLabel="Member"
              placeholder="Search members"
              emptyLabel="No members found"
            />
          </Field>
          <Field label="Reason">
            <Select
              value={reason}
              options={WARNING_REASONS.map((r) => ({ value: r.value, label: r.label }))}
              onChange={(v) => setReason(v as WarningReason)}
              ariaLabel="Reason"
            />
          </Field>
          <Field label={reason === "other" ? "Notes (required)" : "Notes"}>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the concern or relevant context..."
            />
          </Field>
          <Field label="Date">
            <DateField mode="date" value={date} onChange={setDate} ariaLabel="Date" />
          </Field>
          {mode === "create" && (
            <p className="text-sm text-muted-foreground">
              Status: <span className="font-medium text-foreground">Open</span>
            </p>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <ModalFooter onCancel={mode === "edit" ? onClose : onClose} cancelDisabled={busy}>
            <button type="submit" className="os-btn-primary os-btn-primary--sm" disabled={busy}>
              {busy ? "Saving…" : "Save warning"}
            </button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}
