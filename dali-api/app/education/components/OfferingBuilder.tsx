import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";

interface Session {
  id: string;
  sequence: number;
  datetime: string;
  location: string | null;
}

interface Question {
  id: string;
  prompt: string;
  required: boolean;
  position: number;
}

export interface OfferingBuilderProps {
  offering: {
    id: string;
    title: string;
    type: "Miniseries" | "Workshop";
    status: "Draft" | "Published" | "Archived";
    capacity: number;
    registrationOpensAt: string;
    registrationClosesAt: string;
    startsAt: string;
    endsAt: string;
    requiresReview: boolean;
  };
  sessions: Session[];
  questions: Question[];
  templates?: { id: string; name: string; questionCount: number }[];
  emailTemplates?: { id: string; name: string; latestVersionId: string }[];
  decisionEmailBindings?: { status: string; emailTemplateVersionId: string }[];
}

type Tab = "settings" | "sessions" | "questions" | "emails" | "publish";

export function OfferingBuilder({
  offering,
  sessions,
  questions,
  templates,
  emailTemplates,
  decisionEmailBindings,
}: OfferingBuilderProps) {
  const [tab, setTab] = useState<Tab>("settings");

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-4">
        <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">{offering.title || "Untitled offering"}</h1>
        <p className="text-xs text-muted-foreground">
          {offering.type} · Status: <span className="font-semibold">{offering.status}</span>
        </p>
      </header>

      <nav className="border-b border-border mb-5 flex gap-4">
        {(["settings", "sessions", "questions", "emails", "publish"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm capitalize ${
              tab === t
                ? "text-dark-blue font-semibold border-b-2 border-accent-coral"
                : "text-muted-foreground hover:text-dark-blue"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "settings" && <SettingsTab offering={offering} />}
      {tab === "sessions" && <SessionsTab offeringId={offering.id} sessions={sessions} />}
      {tab === "questions" && (
        <QuestionsTab offeringId={offering.id} questions={questions} templates={templates ?? []} />
      )}
      {tab === "emails" && (
        <EmailsTab
          offeringId={offering.id}
          emailTemplates={emailTemplates ?? []}
          bindings={decisionEmailBindings ?? []}
        />
      )}
      {tab === "publish" && <PublishTab offering={offering} />}
    </div>
  );
}

function EmailsTab({
  offeringId,
  emailTemplates,
  bindings,
}: {
  offeringId: string;
  emailTemplates: { id: string; name: string; latestVersionId: string }[];
  bindings: { status: string; emailTemplateVersionId: string }[];
}) {
  const { revalidate } = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byStatus = new Map(bindings.map((b) => [b.status, b.emailTemplateVersionId]));

  async function set(status: string, value: string) {
    setBusy(status);
    setError(null);
    const method = value ? "POST" : "DELETE";
    const res = await fetch(`/api/education/offerings/${offeringId}/decision-emails`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, emailTemplateVersionId: value || undefined }),
    });
    setBusy(null);
    if (res.ok) revalidate();
    else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
    }
  }

  if (emailTemplates.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-brand-tint/30 p-6 text-center">
        <p className="font-heading text-base font-bold text-dark-blue">No email templates yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create one in <a href="/hiring/emails" className="text-accent-coral hover:underline">Hiring → Email templates</a>{" "}
          (they're shared lab-wide) and come back here to bind.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Bind an email template to a decision status. Variables: <code>{`{{firstName}}`}</code> and{" "}
        <code>{`{{domain}}`}</code> (= offering title). Leave unset to use the default text.
      </p>
      {(["Approved", "Waitlisted", "Rejected"] as const).map((status) => (
        <div key={status} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
          <span className="text-sm font-semibold text-dark-blue w-24">{status}</span>
          <select
            value={byStatus.get(status) ?? ""}
            onChange={(e) => set(status, e.target.value)}
            disabled={busy === status}
            className="rounded-lg border border-border bg-card px-2 py-1 text-sm flex-1"
          >
            <option value="">(use default)</option>
            {emailTemplates.map((t) => (
              <option key={t.id} value={t.latestVersionId}>{t.name}</option>
            ))}
          </select>
        </div>
      ))}
      {error && <div className="text-sm text-red-700">{error}</div>}
    </div>
  );
}

function SettingsTab({ offering }: { offering: OfferingBuilderProps["offering"] }) {
  const { revalidate } = useRevalidator();
  const [form, setForm] = useState({
    title: offering.title,
    capacity: offering.capacity,
    requiresReview: offering.requiresReview,
    registrationOpensAt: toLocalInput(offering.registrationOpensAt),
    registrationClosesAt: toLocalInput(offering.registrationClosesAt),
    startsAt: toLocalInput(offering.startsAt),
    endsAt: toLocalInput(offering.endsAt),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/education/offerings/${offering.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        capacity: Number(form.capacity),
        requiresReview: form.requiresReview,
        registrationOpensAt: new Date(form.registrationOpensAt).toISOString(),
        registrationClosesAt: new Date(form.registrationClosesAt).toISOString(),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Save failed");
    } else {
      setSaved(true);
      revalidate();
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Title">
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Capacity">
        <input
          type="number"
          min={1}
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
          className="w-32 rounded-lg border border-border bg-card px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Application required?">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.requiresReview}
            onChange={(e) => setForm({ ...form, requiresReview: e.target.checked })}
          />
          <span className="text-sm">Instructor reviews applications (otherwise RSVP auto-approves)</span>
        </label>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Registration opens">
          <input type="datetime-local" value={form.registrationOpensAt} onChange={(e) => setForm({ ...form, registrationOpensAt: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
        </Field>
        <Field label="Registration closes">
          <input type="datetime-local" value={form.registrationClosesAt} onChange={(e) => setForm({ ...form, registrationClosesAt: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
        </Field>
        <Field label="Starts">
          <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
        </Field>
        <Field label="Ends">
          <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
        </Field>
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}
      {saved && <div className="text-sm text-green-700">Saved.</div>}
      <Button variant="primary" disabled={saving} onClick={save}>
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function SessionsTab({ offeringId, sessions }: { offeringId: string; sessions: Session[] }) {
  const { revalidate } = useRevalidator();
  const [draft, setDraft] = useState({ datetime: "", location: "" });
  const [error, setError] = useState<string | null>(null);

  async function addSession() {
    setError(null);
    const res = await fetch(`/api/education/offerings/${offeringId}/sessions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequence: sessions.length + 1,
        datetime: new Date(draft.datetime).toISOString(),
        location: draft.location || null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to add session");
    } else {
      setDraft({ datetime: "", location: "" });
      revalidate();
    }
  }

  async function removeSession(id: string) {
    if (!confirm("Delete this session?")) return;
    const res = await fetch(`/api/education/sessions/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) revalidate();
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-2">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm">
            <div>
              <span className="font-semibold text-dark-blue">Session {s.sequence}</span>
              <span className="ml-2 text-muted-foreground">{new Date(s.datetime).toLocaleString()}</span>
              {s.location && <span className="ml-2 text-muted-foreground">· {s.location}</span>}
            </div>
            <div className="flex items-center gap-3">
              <a
                href={`/education/manage/sessions/${s.id}/attendance`}
                className="text-xs text-accent-coral hover:underline"
              >
                Attendance →
              </a>
              <button onClick={() => removeSession(s.id)} className="text-xs text-red-600 hover:underline">
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded-lg border border-dashed border-border bg-card p-3 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add session</h4>
        <input type="datetime-local" value={draft.datetime} onChange={(e) => setDraft({ ...draft, datetime: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
        <input placeholder="Location (optional)" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
        {error && <div className="text-sm text-red-700">{error}</div>}
        <Button variant="secondary" size="sm" disabled={!draft.datetime} onClick={addSession}>
          Add
        </Button>
      </div>
    </div>
  );
}

function QuestionsTab({
  offeringId,
  questions,
  templates,
}: {
  offeringId: string;
  questions: Question[];
  templates: { id: string; name: string; questionCount: number }[];
}) {
  const { revalidate } = useRevalidator();
  const [items, setItems] = useState<{ prompt: string; required: boolean }[]>(
    () => questions.map((q) => ({ prompt: q.prompt, required: q.required })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [applying, setApplying] = useState(false);

  async function applyTemplate() {
    if (!selectedTemplate) return;
    if (items.some((q) => q.prompt.trim())) {
      if (!confirm("This replaces all existing questions. Continue?")) return;
    }
    setApplying(true);
    setError(null);
    const res = await fetch(`/api/education/offerings/${offeringId}/questions/from-template`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: selectedTemplate }),
    });
    setApplying(false);
    if (res.ok) {
      const next = await res.json();
      setItems(next.map((q: any) => ({ prompt: q.prompt, required: q.required })));
      revalidate();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Apply failed");
    }
  }

  function update(i: number, patch: Partial<{ prompt: string; required: boolean }>) {
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  }
  function add() {
    setItems((prev) => [...prev, { prompt: "", required: true }]);
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/education/offerings/${offeringId}/questions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: items.filter((q) => q.prompt.trim().length > 0) }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Save failed");
    } else {
      revalidate();
    }
  }

  return (
    <div className="space-y-3">
      {templates.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-card p-3">
          <label className="text-xs text-muted-foreground">Apply a template:</label>
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            className="rounded-lg border border-border bg-card px-2 py-1 text-sm"
          >
            <option value="">Select…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.questionCount} q)</option>
            ))}
          </select>
          <button
            onClick={applyTemplate}
            disabled={!selectedTemplate || applying}
            className="text-xs text-accent-coral hover:underline disabled:opacity-50"
          >
            {applying ? "Applying..." : "Apply"}
          </button>
        </div>
      )}
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          No questions yet. Workshops can leave this blank for a 1-click RSVP.
        </p>
      )}
      {items.map((q, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
          <input
            placeholder="Question text"
            value={q.prompt}
            onChange={(e) => update(i, { prompt: e.target.value })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={q.required} onChange={(e) => update(i, { required: e.target.checked })} />
              Required
            </label>
            <button onClick={() => remove(i)} className="text-xs text-red-600 hover:underline">
              Remove
            </button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" onClick={add}>Add question</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save questions"}
        </Button>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
    </div>
  );
}

function PublishTab({ offering }: { offering: OfferingBuilderProps["offering"] }) {
  const { revalidate } = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function transition(status: "Draft" | "Published" | "Archived") {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/education/offerings/${offering.id}/publish`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Transition failed");
    } else {
      revalidate();
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Current status: <span className="font-semibold text-dark-blue">{offering.status}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {offering.status === "Draft" && (
          <Button variant="primary" disabled={pending} onClick={() => transition("Published")}>
            Publish
          </Button>
        )}
        {offering.status === "Published" && (
          <>
            <Button variant="secondary" disabled={pending} onClick={() => transition("Draft")}>
              Unpublish (back to Draft)
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => transition("Archived")}>
              Archive
            </Button>
          </>
        )}
        {offering.status === "Archived" && (
          <Button variant="secondary" disabled={pending} onClick={() => transition("Published")}>
            Unarchive
          </Button>
        )}
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

function toLocalInput(iso: string): string {
  // datetime-local input expects "YYYY-MM-DDTHH:mm" — strip ISO seconds + Z.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
