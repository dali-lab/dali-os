import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import type { Route } from "./+types/education.manage.new";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { Button } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [{ title: "New offering · Education" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }
  return null;
}

export default function NewOffering() {
  const navigate = useNavigate();
  const today = new Date();
  const inAWeek = new Date(today.getTime() + 7 * 86400000);
  const inTwoWeeks = new Date(today.getTime() + 14 * 86400000);

  const [form, setForm] = useState({
    type: "Workshop" as "Miniseries" | "Workshop",
    title: "",
    capacity: 20,
    registrationOpensAt: toLocalInput(today),
    registrationClosesAt: toLocalInput(inAWeek),
    startsAt: toLocalInput(inAWeek),
    endsAt: toLocalInput(inTwoWeeks),
    requiresReview: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/education/offerings", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.type,
        title: form.title,
        capacity: Number(form.capacity),
        registrationOpensAt: new Date(form.registrationOpensAt).toISOString(),
        registrationClosesAt: new Date(form.registrationClosesAt).toISOString(),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        requiresReview: form.requiresReview,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to create");
      return;
    }
    const created = await res.json();
    navigate(`/education/manage/${created.id}`);
  }

  return (
    <div className="p-6 md:p-10 max-w-2xl mx-auto">
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-4">New offering</h1>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Type</span>
          <select
            value={form.type}
            onChange={(e) => {
              const type = e.target.value as "Miniseries" | "Workshop";
              setForm({ ...form, type, requiresReview: type === "Miniseries" });
            }}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="Workshop">Workshop (single session, RSVP)</option>
            <option value="Miniseries">Miniseries (multi-session, application)</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Title</span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Capacity</span>
          <input
            type="number"
            min={1}
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
            className="w-32 rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Registration opens" value={form.registrationOpensAt} onChange={(v) => setForm({ ...form, registrationOpensAt: v })} />
          <DateField label="Registration closes" value={form.registrationClosesAt} onChange={(v) => setForm({ ...form, registrationClosesAt: v })} />
          <DateField label="Starts" value={form.startsAt} onChange={(v) => setForm({ ...form, startsAt: v })} />
          <DateField label="Ends" value={form.endsAt} onChange={(v) => setForm({ ...form, endsAt: v })} />
        </div>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.requiresReview}
            onChange={(e) => setForm({ ...form, requiresReview: e.target.checked })}
          />
          <span className="text-sm">Require instructor review of applications</span>
        </label>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Creating..." : "Create draft"}
        </Button>
      </form>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
      />
    </label>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
