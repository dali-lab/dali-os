import { useRef, useState } from "react";
import { Modal } from "~/components/Modal";
import { Button } from "~/components/ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
  terms: { id: string; code: string }[];
  defaultTermId: string | null;
  partnerOrgs: { id: string; name: string }[];
  pmEligibleMembers: { id: string; firstName: string; lastName: string }[];
}

export function ProjectCreateModal({
  open,
  onClose,
  onCreated,
  terms,
  defaultTermId,
  partnerOrgs,
  pmEligibleMembers,
}: Props) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [termId, setTermId] = useState<string>(defaultTermId ?? terms[0]?.id ?? "");
  const [calendarEmail, setCalendarEmail] = useState("");
  const [pmIds, setPmIds] = useState<string[]>([]);
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePm = (id: string) => {
    setPmIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  };
  const togglePartner = (id: string) => {
    setPartnerIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  };

  async function submit() {
    if (submitting) return;
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!termId) {
      setError("Select a term");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/projects/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          firstTermId: termId,
          calendarEmail: calendarEmail.trim() || null,
          initialPmUserIds: pmIds,
          partnerOrgIds: partnerIds,
        }),
        redirect: "follow",
      });
      if (res.redirected) {
        const m = res.url.match(/\/projects\/([^/?#]+)/);
        onCreated(m?.[1] ?? "");
        return;
      }
      if (!res.ok) {
        const body = await res.text();
        setError(body || `Create failed (${res.status})`);
        return;
      }
      const data = await res.json();
      onCreated(data.projectId ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="create-project-title"
      initialFocusRef={nameRef}
      containerClassName="bg-card rounded-2xl shadow-xl max-w-lg w-full p-5 sm:p-6 my-auto"
    >
      <h2
        id="create-project-title"
        ref={titleRef}
        className="text-lg font-semibold text-foreground mb-4"
      >
        New project
      </h2>

      <div className="space-y-3">
        <Field label="Name">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hood Museum AR Tour"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </Field>

        <Field label="First term">
          <select
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Calendar email (optional)">
          <input
            value={calendarEmail}
            onChange={(e) => setCalendarEmail(e.target.value)}
            placeholder="e.g. projectalpha@dali.dartmouth.edu"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Initial PM(s)">
          {pmEligibleMembers.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No members have PM domain eligibility yet. Add the PM domain to
              a member's eligibilities first.
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-card divide-y divide-border">
              {pmEligibleMembers.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-muted text-sm"
                >
                  <input
                    type="checkbox"
                    checked={pmIds.includes(m.id)}
                    onChange={() => togglePm(m.id)}
                  />
                  <span>
                    {m.firstName} {m.lastName}
                  </span>
                </label>
              ))}
            </div>
          )}
        </Field>

        <Field label="Initial partner organizations">
          {partnerOrgs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No partner organizations yet. Create one under Core Hub &gt;
              Partners (or skip and link later).
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-card divide-y divide-border">
              {partnerOrgs.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-muted text-sm"
                >
                  <input
                    type="checkbox"
                    checked={partnerIds.includes(p.id)}
                    onChange={() => togglePartner(p.id)}
                  />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          )}
        </Field>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
