import { useMemo, useState } from "react";
import { useFetcher, useRevalidator, useSearchParams } from "react-router";
import { Plus, X } from "lucide-react";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { Drawer } from "~/components/ui/Drawer";
import { Toggle } from "~/components/ui/Toggle";
import { DateField } from "~/components/ui/DateField";
import { ToggleChip } from "~/components/ui/ToggleChip";
import { IconButton } from "~/components/ui/IconButton";
import { Combobox, Select } from "~/components/ui/floating";
import { useConfirmSubmit, useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { DocEditor } from "~/components/doc";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { orderGroupsForPicker } from "~/lib/group-kind";
import { cn } from "~/lib/cn";

type Base = {
  id: string;
  title: string;
  body: string | null;
  author: string;
  audience: string;
  sendAt: string;
  dueAt: string | null;
  ccDartmouth: boolean;
  recipients: number;
};

export type AnnouncementsData = {
  members: { id: string; name: string; email: string | null }[];
  groups: { id: string; name: string; systemKey: string | null; memberCount: number }[];
  publishedForms: { id: string; name: string }[];
  scheduled: (Base & { lastError: string | null })[];
  sent: (Base & { completed: number })[];
};

type View = "scheduled" | "sent";

const WHEN: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
const DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

function fmt(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString("en-US", opts);
}

export function AnnouncementsPage({ data }: { data: AnnouncementsData }) {
  const os = useOsChrome();
  const [searchParams] = useSearchParams();
  // A deep link (the staffing boards' "Send to members") opens the composer
  // with the form and whole-lab audience already picked.
  const seedFormId = data.publishedForms.some((f) => f.id === searchParams.get("formId"))
    ? searchParams.get("formId")!
    : "";
  const [view, setView] = useState<View>("scheduled");
  const [composing, setComposing] = useState(Boolean(seedFormId));
  const visible = view === "scheduled" ? data.scheduled : data.sent;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabButtons
          label="Announcement status"
          items={[
            { label: "Scheduled", count: data.scheduled.length, active: view === "scheduled", onClick: () => setView("scheduled") },
            { label: "Sent", count: data.sent.length, active: view === "sent", onClick: () => setView("sent") },
          ]}
        />
        <button type="button" className="os-add-btn" onClick={() => setComposing(true)}>
          <Plus className="h-4 w-4" strokeWidth={3} /> New announcement
        </button>
      </div>

      <p className={os.bodyText}>
        Announcements reach lab members in the app, by email and Slack DM, and land in their Tasks.
      </p>

      <ul className={os.panel}>
        {visible.map((a, i) => (
          <li
            key={a.id}
            className={cn(
              "grid gap-4 px-6 py-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] md:items-center",
              i > 0 && "border-t border-os-container/70",
            )}
          >
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{a.title}</p>
              {a.body && <p className="mt-0.5 truncate text-sm text-os-grey">{a.body}</p>}
              <p className="mt-1.5 text-xs text-os-muted">
                {a.audience} · {a.author} ·{" "}
                {view === "scheduled" ? `Sends ${fmt(a.sendAt, WHEN)}` : `Sent ${fmt(a.sendAt, DAY)}`}
                {a.ccDartmouth && " · CC Dartmouth email"}
              </p>
              {"lastError" in a && a.lastError && (
                <p className="mt-1 text-xs text-destructive">Didn't send: {a.lastError}</p>
              )}
            </div>
            {"completed" in a ? (
              <Completion done={a.completed} total={a.recipients} due={a.dueAt} title={a.title} />
            ) : (
              <div className="text-sm text-os-grey">
                {a.recipients} recipients
                {a.dueAt && <span className="text-os-muted"> · due {fmt(a.dueAt, DAY)}</span>}
              </div>
            )}
            <div className="flex justify-start md:justify-end">
              {"completed" in a ? (
                <Pill dot={a.recipients > 0 && a.completed === a.recipients ? "success" : "neutral"}>
                  {a.recipients ? Math.round((a.completed / a.recipients) * 100) : 0}%
                </Pill>
              ) : (
                !a.lastError && <CancelScheduled id={a.id} />
              )}
            </div>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-6 py-14 text-center text-sm text-os-muted">Nothing {view} yet.</li>
        )}
      </ul>

      <Composer
        open={composing}
        onClose={() => setComposing(false)}
        onDone={(scheduled) => {
          setComposing(false);
          setView(scheduled ? "scheduled" : "sent");
        }}
        data={data}
        seedFormId={seedFormId}
        seedAllMembers={searchParams.get("audience") === "all"}
      />
    </div>
  );
}

function Completion({ done, total, due, title }: { done: number; total: number; due: string | null; title: string }) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-os-grey">{due ? `Done · due ${fmt(due, DAY)}` : "Seen"}</span>
        <span className="tabular-nums text-foreground">
          {done}/{total}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${title} completion`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 overflow-hidden rounded-full bg-os-container"
      >
        <div className="h-full rounded-full bg-os-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CancelScheduled({ id }: { id: string }) {
  const fetcher = useFetcher();
  const os = useOsChrome();
  const confirmSubmit = useConfirmSubmit();
  return (
    <fetcher.Form
      method="post"
      onSubmit={confirmSubmit({
        title: "Cancel this scheduled announcement?",
        description: "It won't send. You'd need to write and schedule it again.",
        confirmLabel: "Cancel announcement",
        cancelLabel: "Keep it scheduled",
        tone: "destructive",
      })}
    >
      <input type="hidden" name="intent" value="cancel-scheduled" />
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={fetcher.state !== "idle"} className={os.actionBtn()}>
        Cancel send
      </button>
    </fetcher.Form>
  );
}

function Composer({
  open,
  onClose,
  onDone,
  data,
  seedFormId,
  seedAllMembers,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (scheduled: boolean) => void;
  data: AnnouncementsData;
  seedFormId: string;
  seedAllMembers: boolean;
}) {
  const os = useOsChrome();
  const toast = useToast();
  const dialog = useDialog();
  const revalidator = useRevalidator();

  const [title, setTitle] = useState("");
  const [bodyBlocks, setBodyBlocks] = useState<unknown>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [allMembers, setAllMembers] = useState(seedAllMembers);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [formId, setFormId] = useState(seedFormId);
  const [dueAt, setDueAt] = useState("");
  const [sendLater, setSendLater] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [ccDartmouth, setCcDartmouth] = useState(false);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);

  const orderedGroups = useMemo(() => orderGroupsForPicker(data.groups, groupIds), [data.groups, groupIds]);
  const groupName = (id: string) => data.groups.find((g) => g.id === id)?.name ?? "Group";
  const memberName = (id: string) => data.members.find((m) => m.id === id)?.name ?? "Member";

  const hasAudience = allMembers || groupIds.length > 0 || userIds.length > 0;
  const errors = {
    title: !title.trim() ? "Add a title" : "",
    audience: !hasAudience ? "Pick who it goes to" : "",
    sendAt: sendLater && (!sendAt || new Date(sendAt) <= new Date()) ? "Pick a time in the future" : "",
  };

  const reset = () => {
    setTitle("");
    setBodyBlocks(null);
    setEditorKey((k) => k + 1);
    setAllMembers(false);
    setGroupIds([]);
    setUserIds([]);
    setFormId("");
    setDueAt("");
    setSendLater(false);
    setSendAt("");
    setCcDartmouth(false);
    setTried(false);
  };

  async function send() {
    setTried(true);
    if (errors.title || errors.audience || errors.sendAt) return;
    const who = allMembers
      ? `the whole lab (${data.members.length})`
      : [
          groupIds.length > 0 && `${groupIds.length} ${groupIds.length === 1 ? "group" : "groups"}`,
          userIds.length > 0 && `${userIds.length} ${userIds.length === 1 ? "person" : "people"}`,
        ]
          .filter(Boolean)
          .join(" and ");
    const ok = await dialog.confirm({
      title: sendLater ? `Schedule for ${who}?` : `Send to ${who}?`,
      description: sendLater
        ? "It goes out in the app, by email and Slack DM at the time you picked."
        : "It goes out now in the app, by email and Slack DM. You can't take it back.",
      confirmLabel: sendLater ? "Schedule" : "Send now",
    });
    if (!ok) return;

    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        kind: "SystemAnnouncement",
        isTodo: true,
        allMembers,
        groupIds,
        userIds,
      };
      if (Array.isArray(bodyBlocks) && bodyBlocks.length > 0) payload.bodyBlocks = bodyBlocks;
      if (dueAt) payload.dueAt = new Date(dueAt).toISOString();
      if (formId) payload.formId = formId;
      if (sendLater) payload.sendAt = new Date(sendAt).toISOString();
      if (ccDartmouth) payload.ccDartmouth = true;
      const res = await fetch("/api/notifications/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string; count?: number; scheduled?: boolean };
      if (!res.ok) {
        toast.error(out.error ?? `Couldn't send (${res.status})`);
        return;
      }
      toast.success(out.scheduled ? "Announcement scheduled" : `Sent to ${out.count ?? 0} people`);
      reset();
      revalidator.revalidate();
      onDone(Boolean(out.scheduled));
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New announcement"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={os.actionBtn()} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={os.actionBtnPrimary} onClick={send} disabled={sending}>
            {sending ? "Sending…" : sendLater ? "Schedule" : "Send now"}
          </button>
        </div>
      }
    >
      <div className={cn(os.formClass, "flex flex-col gap-6")}>
        <label className={os.fieldLabel}>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="What do people need to do?"
          />
          {tried && errors.title && <span className="text-xs text-destructive">{errors.title}</span>}
        </label>

        <div className={os.fieldLabel}>
          Message
          <DocEditor
            key={editorKey}
            features="field"
            density="compact"
            editable
            onChange={setBodyBlocks}
            placeholder="Select text to format it or add a link"
            className="min-h-[8rem] rounded-[10px] border border-os-container bg-os-well px-1 py-1.5 text-sm text-foreground focus-within:border-os-accent"
          />
          <span className="text-xs text-os-muted">Formatting and links carry through to the email.</span>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm text-os-grey">Send to</legend>
          <div className="flex flex-wrap gap-2">
            <ToggleChip on={allMembers} onToggle={() => setAllMembers((v) => !v)}>
              Whole lab · {data.members.length}
            </ToggleChip>
            {groupIds.map((id) => (
              <ToggleChip key={id} on onToggle={() => setGroupIds((g) => g.filter((x) => x !== id))}>
                {groupName(id)}
              </ToggleChip>
            ))}
            {userIds.map((id) => (
              <ToggleChip key={id} on onToggle={() => setUserIds((u) => u.filter((x) => x !== id))}>
                {memberName(id)}
              </ToggleChip>
            ))}
          </div>
          {!allMembers && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Combobox
                value=""
                ariaLabel="Add a group"
                placeholder="Add a group"
                options={orderedGroups
                  .filter((g) => !groupIds.includes(g.id))
                  .map((g) => ({ value: g.id, label: g.name, description: `${g.memberCount} members` }))}
                onChange={(id) => id && setGroupIds((g) => [...g, id])}
              />
              <Combobox
                value=""
                ariaLabel="Add a person"
                placeholder="Add a person"
                options={data.members
                  .filter((m) => !userIds.includes(m.id))
                  .map((m) => ({ value: m.id, label: m.name, description: m.email ?? undefined }))}
                onChange={(id) => id && setUserIds((u) => [...u, id])}
              />
            </div>
          )}
          {tried && errors.audience && <span className="text-xs text-destructive">{errors.audience}</span>}
        </fieldset>

        <div className={os.fieldLabel}>
          Attach a form (optional)
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Select
                value={formId}
                ariaLabel="Attached form"
                placeholder={data.publishedForms.length ? "No form" : "No published forms yet"}
                disabled={data.publishedForms.length === 0}
                buttonClassName={os.formTrigger}
                options={data.publishedForms.map((f) => ({ value: f.id, label: f.name }))}
                onChange={setFormId}
              />
            </div>
            {formId && <IconButton label="Remove form" icon={X} onClick={() => setFormId("")} />}
          </div>
          <span className="text-xs text-os-muted">It shows up in their Tasks until they fill it in.</span>
        </div>

        <label className={os.fieldLabel}>
          Due date (optional)
          <DateField mode="datetime-local" value={dueAt} onChange={setDueAt} ariaLabel="Due date" className="sm:w-64" buttonClassName={os.formTrigger} />
        </label>

        <div className="flex flex-col gap-3 rounded-os-item bg-os-well p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-foreground">Schedule for later</span>
            <Toggle tone="os" checked={sendLater} onChange={(e) => setSendLater(e.target.checked)} aria-label="Schedule for later" />
          </div>
          {sendLater && (
            <>
              <DateField mode="datetime-local" value={sendAt} onChange={setSendAt} ariaLabel="Send at" buttonClassName={os.formTrigger} />
              {tried && errors.sendAt && <span className="text-xs text-destructive">{errors.sendAt}</span>}
            </>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-foreground">Also CC their Dartmouth email</span>
            <Toggle tone="os" checked={ccDartmouth} onChange={(e) => setCcDartmouth(e.target.checked)} aria-label="CC Dartmouth email" />
          </div>
        </div>
      </div>
    </Drawer>
  );
}
