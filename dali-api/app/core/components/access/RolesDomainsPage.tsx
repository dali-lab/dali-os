import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { ChevronRight, Plus, Settings2, Trash2, X } from "lucide-react";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { OsPageHeader } from "~/components/os-section";
import { Avatar } from "~/components/ui/Avatar";
import { Drawer } from "~/components/ui/Drawer";
import { IconButton } from "~/components/ui/IconButton";
import { SearchInput } from "~/components/ui/SearchInput";
import { Segmented } from "~/components/ui/Segmented";
import { Checkbox } from "~/components/ui/Checkbox";
import { Combobox, Select, Tooltip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { cn } from "~/lib/cn";
import type { Level } from "~/lib/level";
import {
  ACCESS_OPTIONS,
  LEVEL_OPTIONS,
  ROLE_FILTERS,
  accessIntent,
  coreLabel,
  domainRoster,
  matchesQuery,
  type AccessDomain,
  type AccessMember,
  type LabAccess,
  type RoleFilter,
} from "~/core/lib/access";

type Data = { members: AccessMember[]; domains: AccessDomain[]; term: string | null; viewerIsAdmin: boolean };

/** Posts one intent to this page's action and toasts the outcome once it lands. */
function useAccessAction() {
  const fetcher = useFetcher<{ error?: string } | null>();
  const toast = useToast();
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || pending.current === null) return;
    const message = pending.current;
    pending.current = null;
    if (fetcher.data?.error) toast.error(fetcher.data.error);
    else if (message) toast(message);
  }, [fetcher.state, fetcher.data, toast]);
  return {
    busy: fetcher.state !== "idle",
    run: (fields: Record<string, string>, success = "") => {
      pending.current = success;
      fetcher.submit(fields, { method: "post" });
    },
  };
}

export function RolesDomainsPage({ data }: { data: Data }) {
  const os = useOsChrome();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [domainId, setDomainId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const domainName = (id: string) => data.domains.find((d) => d.id === id)?.name ?? "Domain";
  const cards = data.domains.filter((d) => d.active && !d.isSystem);
  const selected = data.members.find((m) => m.id === selectedId) ?? null;
  const activeDomain = data.domains.find((d) => d.id === domainId) ?? null;

  const visible = useMemo(
    () =>
      data.members.filter(
        (m) =>
          ROLE_FILTERS[role](m) &&
          (!domainId || m.domains.some((d) => d.domainId === domainId)) &&
          matchesQuery(m, query),
      ),
    [data.members, query, role, domainId],
  );
  const count = (f: RoleFilter) => data.members.filter(ROLE_FILTERS[f]).length;

  return (
    <div className="flex flex-col gap-8">
      <OsPageHeader
        title="Roles & domains"
        description="Who can do what in the lab: Admin and Staff access, Core titles, and each person's domain level and lead roles."
      />

      <section aria-labelledby="domains-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 id="domains-heading" className="text-sm font-semibold text-os-grey">
            Domains <span className="font-normal text-os-muted">· pick one to see who's in it</span>
          </h2>
          {data.viewerIsAdmin && (
            <button type="button" className={os.actionBtn()} onClick={() => setManageOpen(true)}>
              <Settings2 className={os.actionIcon} /> Manage domains
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((d) => {
            const { people, leads, byLevel } = domainRoster(data.members, d.id);
            const on = domainId === d.id;
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={on}
                onClick={() => setDomainId(on ? null : d.id)}
                className={cn(
                  "flex flex-col gap-2 rounded-os-card border bg-os-card px-5 py-4 text-left transition-colors",
                  on ? "border-os-accent" : "border-transparent hover:bg-os-card-hover",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-foreground">{d.name}</span>
                  <span className="text-sm tabular-nums text-os-grey">{people.length}</span>
                </span>
                <span className="truncate text-sm text-os-grey">
                  {leads.length ? (
                    `Led by ${leads.map((m) => m.name.split(" ")[0]).join(", ")}`
                  ) : (
                    <span className="text-os-amber">No lead this term</span>
                  )}
                </span>
                <span className="flex gap-3 text-xs text-os-muted">
                  {byLevel.map((l) => (
                    <span key={l.level}>
                      {l.level} {l.count}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or Core title"
          containerClassName="w-full md:w-80"
        />
        <SegmentedTabButtons
          label="Role"
          items={(
            [
              ["all", "Everyone"],
              ["admins", "Admin & staff"],
              ["core", "Core"],
              ["leads", "Domain leads"],
            ] as const
          ).map(([key, label]) => ({ label, count: count(key), active: role === key, onClick: () => setRole(key) }))}
        />
      </div>

      {activeDomain && (
        <p className="-mt-4 flex items-center gap-2 px-1 text-sm text-os-grey">
          Showing people in <span className="font-semibold text-foreground">{activeDomain.name}</span>
          <button type="button" onClick={() => setDomainId(null)} className="text-os-accent transition-colors hover:text-os-accent-hover">
            Show all domains
          </button>
        </p>
      )}

      <div className={cn(os.panel, "no-scrollbar overflow-x-auto")}>
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="text-left text-xs font-semibold text-os-muted">
              <th className="whitespace-nowrap px-4 py-3 pl-6">Member</th>
              <th className="whitespace-nowrap px-4 py-3">Lab access</th>
              <th className="whitespace-nowrap px-4 py-3">Core</th>
              <th className="whitespace-nowrap px-4 py-3">Domains</th>
              <th className="px-4 py-3 pr-6">
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr
                key={m.id}
                className="cursor-pointer border-t border-os-container/70 transition-colors hover:bg-os-card-hover"
                onClick={() => setSelectedId(m.id)}
              >
                <td className="px-4 py-3.5 pl-6">
                  <div className="flex items-center gap-3">
                    <Avatar photoUrl={m.photoUrl} name={m.name} size="sm" userId={m.id} />
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{m.name}</p>
                      <p className="truncate text-xs text-os-muted">
                        {m.email ?? "No DALI email"}
                        {m.isAlumni && " · Alumni"}
                        {!m.isLabMember && " · Not a member"}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  {m.access === "none" ? (
                    <span className="text-sm text-os-muted">Member</span>
                  ) : (
                    <Pill dot={m.access === "admin" ? "accent" : "neutral"}>
                      {ACCESS_OPTIONS.find((o) => o.value === m.access)?.label}
                    </Pill>
                  )}
                </td>
                <td className="px-4 py-3.5 text-sm">
                  {m.coreTitles.length ? (
                    <span className="text-foreground">{coreLabel(m.coreTitles)}</span>
                  ) : (
                    <span className="text-os-muted">None</span>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  {m.domains.length === 0 ? (
                    <span className="text-sm text-os-muted">None</span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {m.domains.map((d) => (
                        <span
                          key={d.domainId}
                          className={cn(
                            "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs",
                            d.leadAssignmentId ? "bg-os-accent/15 text-os-accent" : "bg-os-well text-os-grey",
                            domainId === d.domainId && "ring-1 ring-os-accent/60",
                          )}
                        >
                          {domainName(d.domainId)}
                          {d.level && ` · ${d.level}`}
                          {d.leadAssignmentId && " · Lead"}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3.5 pr-6 text-right">
                  <ChevronRight className="ml-auto h-4 w-4 text-os-muted" aria-hidden />
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr className="border-t border-os-container/70">
                <td colSpan={5} className="px-6 py-12 text-center text-sm text-os-muted">
                  No one matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <MemberAccessDrawer
        member={selected}
        members={data.members}
        domains={data.domains.filter((d) => d.active || selected?.domains.some((x) => x.domainId === d.id))}
        term={data.term}
        viewerIsAdmin={data.viewerIsAdmin}
        domainName={domainName}
        onClose={() => setSelectedId(null)}
      />

      {data.viewerIsAdmin && (
        <ManageDomainsModal
          open={manageOpen}
          domains={data.domains}
          memberCount={(id) => domainRoster(data.members, id).people.length}
          onClose={() => setManageOpen(false)}
        />
      )}
    </div>
  );
}

function MemberAccessDrawer({
  member: m,
  members,
  domains,
  term,
  viewerIsAdmin,
  domainName,
  onClose,
}: {
  member: AccessMember | null;
  members: AccessMember[];
  domains: AccessDomain[];
  term: string | null;
  viewerIsAdmin: boolean;
  domainName: (id: string) => string;
  onClose: () => void;
}) {
  const os = useOsChrome();
  const dialog = useDialog();
  const act = useAccessAction();
  const [title, setTitle] = useState("");
  useEffect(() => setTitle(""), [m?.id]);

  // Titles other people already hold, offered as suggestions.
  const knownTitles = useMemo(
    () => [...new Set(members.flatMap((x) => x.coreTitles.map((t) => t.title).filter((t): t is string => !!t)))].sort(),
    [members],
  );

  if (!m) return <Drawer open={false} onClose={onClose} title="Member">{null}</Drawer>;

  const first = m.name.split(" ")[0];
  const setAccess = async (to: LabAccess) => {
    const step = accessIntent(m.access, to);
    if (!step) return;
    const label = ACCESS_OPTIONS.find((o) => o.value === to)!.label;
    if (to !== "none") {
      const ok = await dialog.confirm({
        title: `Make ${m.name} ${label.toLowerCase()}?`,
        description: "They get everything in Admin, including payroll and platform settings.",
        confirmLabel: `Make ${label.toLowerCase()}`,
      });
      if (!ok) return;
    }
    act.run({ intent: step.intent, userId: m.id, value: step.value }, `${m.name} is now ${label.toLowerCase()}`);
  };

  const addTitle = () => {
    const t = title.trim();
    if (m.coreTitles.some((x) => (x.title ?? "") === t)) return;
    act.run({ intent: "add-core-title", userId: m.id, leadTitle: t }, t ? `${m.name} added to Core as ${t}` : `${m.name} added to Core`);
    setTitle("");
  };

  const setLevel = async (domainId: string, level: Level | "") => {
    const membership = m.domains.find((d) => d.domainId === domainId);
    if (!level) {
      if (!membership?.eligibilityId) return;
      const ok = await dialog.confirm({
        title: `Remove ${first} from ${domainName(domainId)}?`,
        description: "They lose their level there. A lead role stays until you turn it off.",
        confirmLabel: "Remove",
        tone: "destructive",
      });
      if (ok) act.run({ intent: "remove-eligibility", eligibilityId: membership.eligibilityId }, `${m.name} removed from ${domainName(domainId)}`);
      return;
    }
    act.run(
      { intent: membership?.eligibilityId ? "set-eligibility-level" : "add-eligibility", userId: m.id, domainId, level },
      `${m.name}: ${domainName(domainId)} ${level}`,
    );
  };

  const setLead = (domainId: string, lead: boolean) => {
    const membership = m.domains.find((d) => d.domainId === domainId);
    if (lead) act.run({ intent: "add-domain-lead", userId: m.id, domainId }, `${m.name} now leads ${domainName(domainId)}`);
    else if (membership?.leadAssignmentId)
      act.run({ intent: "remove-domain-lead", assignmentId: membership.leadAssignmentId }, `${m.name} no longer leads ${domainName(domainId)}`);
  };

  const help = ACCESS_OPTIONS.find((o) => o.value === m.access)?.help;

  return (
    <Drawer open onClose={onClose} title={m.name}>
      <div className="flex flex-col gap-8">
        <p className="-mt-2 text-sm text-os-muted">{m.email ?? "No DALI email"} · changes save as you make them</p>

        <section className="flex flex-col gap-3" aria-labelledby="lab-access-title">
          <h3 id="lab-access-title" className="text-sm font-semibold text-foreground">
            Lab access
          </h3>
          {viewerIsAdmin && !m.envAdmin ? (
            <Segmented<LabAccess>
              ariaLabel="Lab access"
              size="md"
              value={m.access}
              onChange={setAccess}
              options={ACCESS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          ) : (
            <p className="text-sm text-foreground">{ACCESS_OPTIONS.find((o) => o.value === m.access)?.label}</p>
          )}
          <p className="text-xs text-os-muted">
            {m.envAdmin
              ? "Admin through the server's admin list, so it can't be changed here."
              : viewerIsAdmin
                ? help
                : `${help} Only admins can change this.`}
          </p>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="core-title">
          <div className="flex items-baseline justify-between">
            <h3 id="core-title" className="text-sm font-semibold text-foreground">
              Core
            </h3>
            {term && <span className="text-xs text-os-muted">{term}</span>}
          </div>
          {m.coreTitles.length === 0 ? (
            <p className="text-sm text-os-grey">Not on Core this term. Add a title to make them Core.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {m.coreTitles.map((t) => (
                <li key={t.id} className="flex items-center gap-1 rounded-full bg-os-accent/15 py-1 pl-3 pr-1 text-sm text-os-accent">
                  {t.title ?? "Core"}
                  <button
                    type="button"
                    disabled={act.busy}
                    onClick={() => act.run({ intent: "remove-core-title", assignmentId: t.id }, `Removed ${t.title ?? "Core"} from ${m.name}`)}
                    aria-label={`Remove ${t.title ?? "Core"}`}
                    className="rounded-full p-1 transition-colors hover:bg-os-accent/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Combobox
                value={title}
                ariaLabel="Core title"
                placeholder="Add a Core title, or leave empty for plain Core"
                options={[
                  ...(title && !knownTitles.includes(title) ? [{ value: title, label: title }] : []),
                  ...knownTitles.filter((t) => !m.coreTitles.some((x) => x.title === t)).map((t) => ({ value: t, label: t })),
                ]}
                allowCustom={(q) => (q.trim() ? { value: q.trim().slice(0, 80), label: `Add "${q.trim()}"` } : null)}
                onChange={setTitle}
              />
            </div>
            <button type="button" className={os.actionBtn()} disabled={act.busy} onClick={addTitle}>
              <Plus className={os.actionIcon} /> Add
            </button>
          </div>
          <p className="text-xs text-os-muted">Core lasts the whole Core cycle. Adding a title tells admins, since it affects pay.</p>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="domains-title">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="domains-title" className="text-sm font-semibold text-foreground">
              Domains
            </h3>
            <span className="text-right text-xs text-os-muted">
              Level decides staffing and notifies them{term ? ` · leads are for ${term}` : ""}
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-os-container/70 rounded-os-item bg-os-well">
            {domains.map((d) => {
              const membership = m.domains.find((x) => x.domainId === d.id);
              const options: { value: Level | ""; label: string }[] = [
                { value: "", label: membership?.level ? "Remove from domain" : "Not in domain" },
                ...LEVEL_OPTIONS,
              ];
              return (
                <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3">
                  <span className={cn("text-sm", membership ? "font-semibold text-foreground" : "text-os-grey")}>{d.name}</span>
                  <Select<Level | "">
                    value={membership?.level ?? ""}
                    ariaLabel={`${d.name} level`}
                    disabled={act.busy}
                    buttonClassName={os.formTrigger}
                    options={options}
                    onChange={(v) => setLevel(d.id, v)}
                    align="right"
                  />
                  <Checkbox
                    tone="os"
                    checked={Boolean(membership?.leadAssignmentId)}
                    disabled={act.busy || !term}
                    onChange={(e) => setLead(d.id, e.target.checked)}
                    label={<span className="text-sm text-foreground">Lead</span>}
                    aria-label={`Leads ${d.name}`}
                  />
                </li>
              );
            })}
          </ul>
          {m.otherLeads.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-os-muted">Lead roles from other terms</p>
              <ul className="flex flex-wrap gap-2">
                {m.otherLeads.map((l) => (
                  <li key={l.id} className="flex items-center gap-1 rounded-full bg-os-well py-1 pl-3 pr-1 text-sm text-os-grey">
                    {domainName(l.domainId)} · {l.term}
                    <button
                      type="button"
                      disabled={act.busy}
                      onClick={() => act.run({ intent: "remove-domain-lead", assignmentId: l.id }, "Lead role removed")}
                      aria-label={`Remove ${domainName(l.domainId)} lead for ${l.term}`}
                      className="rounded-full p-1 transition-colors hover:bg-os-container"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}

const MANAGE_TITLE = "manage-domains-title";

function ManageDomainsModal({
  open,
  domains,
  memberCount,
  onClose,
}: {
  open: boolean;
  domains: AccessDomain[];
  memberCount: (id: string) => number;
  onClose: () => void;
}) {
  const os = useOsChrome();
  const dialog = useDialog();
  const act = useAccessAction();
  const [name, setName] = useState("");
  const taken = domains.some((d) => d.name.toLowerCase() === name.trim().toLowerCase());

  const remove = async (d: AccessDomain) => {
    const ok = await dialog.confirm({
      title: `Delete ${d.name}?`,
      description: "This removes the domain for good.",
      confirmLabel: "Delete domain",
      tone: "destructive",
    });
    if (ok) act.run({ intent: "delete-domain", domainId: d.id }, `${d.name} deleted`);
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy={MANAGE_TITLE} containerClassName={modalCardClass("max-w-lg")}>
      <ModalHeader
        titleId={MANAGE_TITLE}
        title="Manage domains"
        subtitle="A domain can only be deleted once nothing uses it."
        onClose={onClose}
      />
      <div className="flex flex-col gap-5">
        <ul className="flex flex-col divide-y divide-os-container/70 rounded-os-item bg-os-well">
          {domains.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {d.name}
                  {!d.active && <span className="font-normal text-os-muted"> · Hidden</span>}
                  {d.isSystem && <span className="font-normal text-os-muted"> · System</span>}
                </p>
                <p className="text-xs text-os-muted">
                  {d.usage.length ? `Used by ${d.usage.join(", ")}` : "Not used by anything"} · {memberCount(d.id)} members
                </p>
              </div>
              <Tooltip content={d.usage.length ? "In use, so it can't be deleted" : `Delete ${d.name}`}>
                <span>
                  <IconButton
                    label={`Delete ${d.name}`}
                    icon={Trash2}
                    tone="destructive"
                    disabled={d.usage.length > 0 || act.busy}
                    onClick={() => remove(d)}
                  />
                </span>
              </Tooltip>
            </li>
          ))}
        </ul>
        <form
          className={cn(os.formClass, "flex flex-col gap-1.5")}
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || taken) return;
            act.run({ intent: "create-domain", name: name.trim() }, `${name.trim()} added`);
            setName("");
          }}
        >
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New domain name"
              aria-label="New domain name"
              className="min-w-0 flex-1"
            />
            <button type="submit" className={os.actionBtn()} disabled={!name.trim() || taken || act.busy}>
              <Plus className={os.actionIcon} /> Add domain
            </button>
          </div>
          {taken && <span className="text-xs text-destructive">There's already a domain with that name.</span>}
        </form>
      </div>
    </Modal>
  );
}
