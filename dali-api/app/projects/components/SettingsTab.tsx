import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";
import type { WorkspaceData } from "~/projects/lib/queries";
import type { ProjectMembership } from "~/lib/projectAuth";

interface RoleRequestRow {
  id: string;
  projectId: string;
  termId: string;
  domainId: string;
  level: "P1" | "P2" | "P3";
  slots: number;
  domain: { id: string; code: string; displayName: string };
}

interface PartnerLink {
  id: string;
  partnerOrg: { id: string; name: string };
  endedAt: Date | string | null;
}

interface Data {
  roleRequests: RoleRequestRow[];
  termStatus: { isContinuing: boolean } | null;
  partners: PartnerLink[];
  partnerOrgs: { id: string; name: string }[];
  terms: { id: string; code: string }[];
  domains: { id: string; code: string; displayName: string }[];
  currentTermId: string | null;
  currentTermCode: string | null;
}

interface Props {
  data: Data;
  workspace: WorkspaceData;
  membership: ProjectMembership;
}

export function SettingsTab({ data, workspace, membership }: Props) {
  const revalidator = useRevalidator();
  const [name, setName] = useState(workspace.project.name);
  const [calendarEmail, setCalendarEmail] = useState(
    workspace.project.calendarEmail ?? "",
  );
  const [savingMeta, setSavingMeta] = useState(false);

  async function saveMeta() {
    setSavingMeta(true);
    try {
      await fetch(`/api/projects/${workspace.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          calendarEmail: calendarEmail.trim() || null,
        }),
      });
      revalidator.revalidate();
    } finally {
      setSavingMeta(false);
    }
  }

  async function setStatus(status: "Active" | "Paused" | "Archived") {
    const label =
      status === "Active" ? "reactivate" : status === "Paused" ? "pause" : "archive";
    if (!confirm(`Are you sure you want to ${label} this project?`)) return;
    await fetch(`/api/projects/${workspace.project.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    revalidator.revalidate();
  }

  async function toggleContinuing(isContinuing: boolean) {
    if (!data.currentTermId) return;
    await fetch(`/api/projects/${workspace.project.id}/term-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termId: data.currentTermId, isContinuing }),
    });
    revalidator.revalidate();
  }

  return (
    <div className="space-y-8">
      {membership.canEditSettings && (
        <Section title="Project details">
          <div className="space-y-3">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Calendar email">
              <input
                value={calendarEmail}
                onChange={(e) => setCalendarEmail(e.target.value)}
                placeholder="e.g. projectalpha@dali.dartmouth.edu"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            </Field>
            <Button size="sm" onClick={saveMeta} disabled={savingMeta}>
              {savingMeta ? "Saving…" : "Save details"}
            </Button>
          </div>
        </Section>
      )}

      {membership.canEditSettings && (
        <Section
          title="Continuing into next term"
          subtitle={
            data.currentTermCode
              ? `Mark this project as continuing into ${data.currentTermCode} (used by Staffing).`
              : "Set the active term first."
          }
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!data.termStatus?.isContinuing}
              onChange={(e) => toggleContinuing(e.target.checked)}
              disabled={!data.currentTermId}
            />
            Continuing
          </label>
        </Section>
      )}

      {membership.canEditSettings && (
        <Section
          title="Role requests"
          subtitle={`Roles this project needs for ${data.currentTermCode ?? "the upcoming term"}.`}
        >
          <RoleRequestEditor
            projectId={workspace.project.id}
            rows={data.roleRequests}
            domains={data.domains}
            currentTermId={data.currentTermId}
            onChanged={() => revalidator.revalidate()}
          />
        </Section>
      )}

      {membership.canEditSettings && (
        <Section title="Partners">
          <PartnerLinker
            projectId={workspace.project.id}
            links={data.partners}
            partnerOrgs={data.partnerOrgs}
            onChanged={() => revalidator.revalidate()}
          />
        </Section>
      )}

      {membership.canArchive && (
        <Section title="Lifecycle">
          <div className="flex gap-2 flex-wrap">
            {workspace.project.status === "Archived" ? (
              <Button size="sm" variant="secondary" onClick={() => setStatus("Active")}>
                Reactivate
              </Button>
            ) : (
              <>
                {workspace.project.status !== "Paused" && (
                  <Button size="sm" variant="secondary" onClick={() => setStatus("Paused")}>
                    Pause
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setStatus("Archived")}
                >
                  Archive project
                </Button>
              </>
            )}
            {workspace.project.status === "Paused" && (
              <Button size="sm" variant="secondary" onClick={() => setStatus("Active")}>
                Resume
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Archive ends partner access and locks the workspace. Pause keeps it
            in the directory without current-term assignments.
          </p>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </header>
      {children}
    </section>
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

function RoleRequestEditor({
  projectId,
  rows,
  domains,
  currentTermId,
  onChanged,
}: {
  projectId: string;
  rows: RoleRequestRow[];
  domains: { id: string; code: string; displayName: string }[];
  currentTermId: string | null;
  onChanged: () => void;
}) {
  const [domainId, setDomainId] = useState(domains[0]?.id ?? "");
  const [level, setLevel] = useState<"P1" | "P2" | "P3">("P2");
  const [slots, setSlots] = useState(1);

  async function add() {
    if (!domainId || !currentTermId) return;
    await fetch(`/api/projects/${projectId}/role-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termId: currentTermId, domainId, level, slots }),
    });
    onChanged();
  }
  async function update(id: string, patch: Partial<RoleRequestRow>) {
    await fetch(`/api/projects/${projectId}/role-requests`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    onChanged();
  }
  async function remove(id: string) {
    await fetch(`/api/projects/${projectId}/role-requests`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    onChanged();
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No role requests yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="font-medium min-w-[140px]">
                {r.domain.displayName}
              </span>
              <select
                value={r.level}
                onChange={(e) => update(r.id, { level: e.target.value as "P1" | "P2" | "P3" })}
                className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
              >
                <option value="P1">P1 Learner</option>
                <option value="P2">P2 Doer</option>
                <option value="P3">P3 Mentor</option>
              </select>
              <input
                type="number"
                min={1}
                max={20}
                value={r.slots}
                onChange={(e) =>
                  update(r.id, { slots: parseInt(e.target.value, 10) || 1 })
                }
                className="w-16 rounded-lg border border-border bg-card px-2 py-1 text-xs"
              />
              <button
                onClick={() => remove(r.id)}
                className="text-xs text-muted-foreground hover:text-destructive ml-auto"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {currentTermId && (
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
          <select
            value={domainId}
            onChange={(e) => setDomainId(e.target.value)}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
          >
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </select>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as "P1" | "P2" | "P3")}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
          >
            <option value="P1">P1 Learner</option>
            <option value="P2">P2 Doer</option>
            <option value="P3">P3 Mentor</option>
          </select>
          <input
            type="number"
            min={1}
            max={20}
            value={slots}
            onChange={(e) => setSlots(parseInt(e.target.value, 10) || 1)}
            className="w-16 rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
          />
          <Button size="sm" onClick={add}>
            Add request
          </Button>
        </div>
      )}
    </div>
  );
}

function PartnerLinker({
  projectId,
  links,
  partnerOrgs,
  onChanged,
}: {
  projectId: string;
  links: PartnerLink[];
  partnerOrgs: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const linkedIds = new Set(
    links.filter((l) => !l.endedAt).map((l) => l.partnerOrg.id),
  );
  const availableOrgs = partnerOrgs.filter((p) => !linkedIds.has(p.id));
  const [pickId, setPickId] = useState(availableOrgs[0]?.id ?? "");

  async function add() {
    if (!pickId) return;
    await fetch(`/api/projects/${projectId}/partners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnerOrgId: pickId }),
    });
    onChanged();
  }
  async function unlink(projectPartnerId: string) {
    await fetch(`/api/projects/${projectId}/partners`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPartnerId }),
    });
    onChanged();
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {links
          .filter((l) => !l.endedAt)
          .map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-sm">
              <span className="font-medium">{l.partnerOrg.name}</span>
              <button
                onClick={() => unlink(l.id)}
                className="text-xs text-muted-foreground hover:text-destructive ml-auto"
              >
                unlink
              </button>
            </li>
          ))}
      </ul>
      {availableOrgs.length > 0 ? (
        <div className="flex items-center gap-2 pt-3 border-t border-border">
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
          >
            {availableOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={add}>
            Link partner
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          All existing partner orgs are linked. Create a new one under Core Hub
          &gt; Partners.
        </p>
      )}
    </div>
  );
}
