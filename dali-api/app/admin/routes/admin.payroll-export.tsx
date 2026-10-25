import { useEffect, useMemo, useRef, useState } from "react";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useSearchParams,
  useSubmit,
} from "react-router";
import type { Route } from "./+types/admin.payroll-export";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState, Pill, adminTable } from "~/admin/components/console-ui";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, currentTermMemberWhere } from "~/lib/roles";
import { MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { fullName } from "~/lib/display";
import { logAuditEvent } from "~/lib/audit";
import { AlertTriangle, Download, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { useDialog } from "~/components/ui/dialog";
import { Segmented } from "~/components/ui/Segmented";
import { Select, Popover, Tooltip, InfoTip } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { ALL_LEVELS, isLevel } from "~/lib/level";
import {
  buildPayrollRows,
  listCoreCandidates,
  listInstructorCandidates,
  listTechnigalaCandidates,
  listTermDomains,
  pickDefaultTermId,
  type PayrollRow,
  type RoleCandidate,
} from "~/admin/lib/payroll-export";

type AddableMember = { id: string; name: string; netId: string | null };

function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

export const handle = adminHandle("hire-setup");

export const meta: Route.MetaFunction = () => [
  { title: "Hire setup · Payroll · Admin · DALI OS" },
];

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin/members");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const userId = String(form.get("userId") ?? "");
  const termId = String(form.get("termId") ?? "");
  if (!userId || !termId) {
    return Response.json({ ok: false, error: "Missing userId or termId" }, { status: 400 });
  }

  if (intent === "add-technigala") {
    // Idempotent: a double-click or stale board shouldn't 500 on the unique key.
    await prisma.technigalaAssignment.upsert({
      where: { userId_termId: { userId, termId } },
      update: {},
      create: { userId, termId, createdById: auth.user.sub },
    });
  } else if (intent === "remove-technigala") {
    await prisma.technigalaAssignment.deleteMany({ where: { userId, termId } });
  } else {
    return Response.json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  await logAuditEvent({
    action: `payroll.technigala.${intent === "add-technigala" ? "add" : "remove"}`,
    userId: auth.user.sub,
    targetId: userId,
    metadata: { termId },
    request,
  });

  return Response.json({ ok: true });
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin/members");

  const url = new URL(request.url);
  const requestedTermId = url.searchParams.get("term");
  const selectedDomainIds = parseCsvParam(url.searchParams.get("domain"));
  const selectedLevels = parseCsvParam(url.searchParams.get("level")).filter(isLevel);

  const terms = await prisma.term.findMany({
    orderBy: { sortKey: "desc" },
    select: { id: true, code: true, startDate: true, endDate: true },
  });

  const selectedTermId =
    (requestedTermId && terms.some((t) => t.id === requestedTermId)
      ? requestedTermId
      : pickDefaultTermId(terms));
  const selectedTerm = terms.find((t) => t.id === selectedTermId);

  if (!selectedTerm) {
    return {
      terms: [],
      selectedTermId: null,
      projectRows: [] as PayrollRow[],
      coreCandidates: [] as RoleCandidate[],
      instructorCandidates: [] as RoleCandidate[],
      technigalaCandidates: [] as RoleCandidate[],
      addableMembers: [] as AddableMember[],
      termDomains: [] as { id: string; displayName: string }[],
      selectedDomainIds,
      selectedLevels,
      isAdmin: true,
    };
  }

  const [projectRows, coreCandidates, instructorCandidates, technigalaCandidates, termDomains, addableMembers] =
    await Promise.all([
      buildPayrollRows(selectedTerm.id, {
        domainIds: selectedDomainIds,
        levels: selectedLevels,
      }),
      listCoreCandidates(selectedTerm.id),
      listInstructorCandidates(selectedTerm.id),
      listTechnigalaCandidates(selectedTerm.id),
      listTermDomains(selectedTerm.id),
      // Payroll runs on a recent term, so "who could work Technigala" is the
      // live membership rather than the selected term's roster.
      (async (): Promise<AddableMember[]> => {
        const where = await currentTermMemberWhere();
        const users = await prisma.user.findMany({
          where,
          orderBy: MEMBER_LIST_ORDER_BY,
          select: { id: true, firstName: true, lastName: true, netId: true },
        });
        return users.map((u) => ({ id: u.id, name: fullName(u), netId: u.netId }));
      })(),
    ]);

  const now = new Date();
  const currentTermId =
    terms.find((t) => t.startDate <= now && now <= t.endDate)?.id ?? null;

  return {
    terms: terms.map((t) => ({ id: t.id, code: t.code, isCurrent: t.id === currentTermId })),
    selectedTermId: selectedTerm.id,
    selectedTermCode: selectedTerm.code,
    projectRows,
    coreCandidates,
    instructorCandidates,
    technigalaCandidates,
    addableMembers,
    termDomains,
    selectedDomainIds,
    selectedLevels,
    isAdmin: true,
  };
}

type Role = "Project" | "Core" | "Instructor" | "Technigala";
type RoleView = "all" | Role;

type HireRow = {
  key: string;
  role: Role;
  /** Set for the opt-in roles, whose inclusion is a checkbox. */
  userId: string | null;
  netId: string;
  name: string;
  detail: string;
  jobId: string;
  wage: string;
  hireStart: string;
  hireEnd: string;
  chartStringType: string;
  chartString: string;
  warnings: string[];
};

const ROLE_LABEL: Record<Role, string> = {
  Project: "Project",
  Core: "Core",
  Instructor: "Instructor",
  Technigala: "Technigala",
};

const TECHNIGALA_JOB_ID = "8274";

function candidateRow(role: Exclude<Role, "Project">, c: RoleCandidate): HireRow {
  return {
    key: `${role}-${c.userId}`,
    role,
    userId: c.userId,
    netId: c.netId ?? "",
    name: `${c.firstName} ${c.lastName}`.trim(),
    detail: role === "Technigala" ? "" : c.subtitle,
    jobId: role === "Technigala" ? TECHNIGALA_JOB_ID : "",
    wage: "",
    hireStart: "",
    hireEnd: "",
    chartStringType: "",
    chartString: "",
    warnings: c.netId ? [] : ["User missing NetID"],
  };
}

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export default function PayrollExport() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const fetcher = useFetcher();
  const dialog = useDialog();
  const { panel, actionBtn, actionBtnPrimary, iconBtn, bodyText } = useOsChrome();
  const [view, setView] = useState<RoleView>("all");

  // Every candidate starts checked: admins uncheck people who didn't work the
  // term (Summer is the main case). Not persisted across reloads.
  const [coreSelected, setCoreSelected] = useState<Set<string>>(
    () => new Set(data.coreCandidates.map((c) => c.userId)),
  );
  const [instructorSelected, setInstructorSelected] = useState<Set<string>>(
    () => new Set(data.instructorCandidates.map((c) => c.userId)),
  );

  // Technigala's roster changes in place (add/remove revalidates without a
  // remount), so reconcile the selection when it changes: keep prior state for
  // hires still here, default a new hire to checked, drop removed hires.
  const technigalaHires = data.technigalaCandidates;
  const [technigalaSelected, setTechnigalaSelected] = useState<Set<string>>(
    () => new Set(technigalaHires.map((c) => c.userId)),
  );
  const prevTechIdsRef = useRef<Set<string>>(new Set(technigalaHires.map((c) => c.userId)));
  useEffect(() => {
    const ids = technigalaHires.map((c) => c.userId);
    setTechnigalaSelected((prev) => {
      const next = new Set<string>();
      for (const id of ids) {
        if (!prevTechIdsRef.current.has(id) || prev.has(id)) next.add(id);
      }
      return next;
    });
    prevTechIdsRef.current = new Set(ids);
  }, [technigalaHires]);

  const hiredIds = useMemo(() => new Set(technigalaHires.map((h) => h.userId)), [technigalaHires]);
  const addOptions = useMemo(
    () =>
      data.addableMembers
        .filter((m) => !hiredIds.has(m.id))
        .map((m) => ({ value: m.id, label: m.netId ? `${m.name} · ${m.netId}` : m.name })),
    [data.addableMembers, hiredIds],
  );

  if (!data.selectedTermId) {
    return (
      <div className="flex flex-col gap-8">
        <AdminSectionHeader section="payroll" />
        <div className={panel}>
          <EmptyState title="No terms found">Seed terms before generating a payroll export.</EmptyState>
        </div>
      </div>
    );
  }

  const {
    terms,
    selectedTermId,
    projectRows,
    coreCandidates,
    instructorCandidates,
    termDomains,
    selectedDomainIds,
    selectedLevels,
  } = data;
  const selectedTermCode = "selectedTermCode" in data ? data.selectedTermCode : "";

  const selection: Record<Exclude<Role, "Project">, { set: Set<string>; setter: (s: Set<string>) => void; total: number }> = {
    Core: { set: coreSelected, setter: setCoreSelected, total: coreCandidates.length },
    Instructor: { set: instructorSelected, setter: setInstructorSelected, total: instructorCandidates.length },
    Technigala: { set: technigalaSelected, setter: setTechnigalaSelected, total: technigalaHires.length },
  };

  const rows: HireRow[] = [
    ...projectRows.map((r, i) => ({
      key: `Project-${i}`,
      role: "Project" as const,
      userId: null,
      netId: r.netId,
      name: `${r.firstName} ${r.lastName}`.trim(),
      detail: [r.domain, r.level].filter(Boolean).join(" · "),
      jobId: r.jobId,
      wage: r.hourlyWage,
      hireStart: r.hireStart,
      hireEnd: r.hireEnd,
      chartStringType: r.chartStringType,
      chartString: r.chartString,
      warnings: r.warnings,
    })),
    ...coreCandidates.map((c) => candidateRow("Core", c)),
    ...instructorCandidates.map((c) => candidateRow("Instructor", c)),
    ...technigalaHires.map((c) => candidateRow("Technigala", c)),
  ];

  const isIncluded = (r: HireRow) =>
    r.role === "Project" || (r.userId !== null && selection[r.role].set.has(r.userId));
  const visible = view === "all" ? rows : rows.filter((r) => r.role === view);
  const showActions = visible.some((r) => r.role === "Technigala");
  const flagged = rows.filter((r) => isIncluded(r) && r.warnings.length > 0);

  const filterActive = selectedDomainIds.length > 0 || selectedLevels.length > 0;
  const filterSummary = [
    termDomains
      .filter((d) => selectedDomainIds.includes(d.id))
      .map((d) => d.displayName)
      .join(", "),
    selectedLevels.join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

  const totalRows =
    projectRows.length + coreSelected.size + instructorSelected.size + technigalaSelected.size;

  const csvParams = new URLSearchParams({ term: selectedTermId });
  if (selectedDomainIds.length > 0) csvParams.set("domain", selectedDomainIds.join(","));
  if (selectedLevels.length > 0) csvParams.set("level", selectedLevels.join(","));
  if (coreSelected.size > 0) csvParams.set("core", [...coreSelected].join(","));
  if (instructorSelected.size > 0) csvParams.set("instructor", [...instructorSelected].join(","));
  if (technigalaSelected.size > 0) csvParams.set("technigala", [...technigalaSelected].join(","));
  const csvHref = `/admin/payroll-export.csv?${csvParams.toString()}`;

  function toggleFilterValue(key: "domain" | "level", value: string) {
    const params = new URLSearchParams(searchParams);
    const current = new Set(parseCsvParam(params.get(key)));
    if (current.has(value)) current.delete(value);
    else current.add(value);
    if (current.size > 0) params.set(key, [...current].join(","));
    else params.delete(key);
    submit(params, { method: "get" });
  }

  function clearFilters() {
    const params = new URLSearchParams(searchParams);
    params.delete("domain");
    params.delete("level");
    submit(params, { method: "get" });
  }

  function addTechnigala(userId: string) {
    if (!userId) return;
    fetcher.submit({ intent: "add-technigala", userId, termId: selectedTermId! }, { method: "post" });
  }

  async function removeTechnigala(userId: string, name: string) {
    const ok = await dialog.confirm({
      title: `Remove ${name} from Technigala?`,
      description:
        "Their Technigala hours drop off this payroll export. You can add them back from the picker.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (!ok) return;
    fetcher.submit({ intent: "remove-technigala", userId, termId: selectedTermId! }, { method: "post" });
  }

  const optIn = view === "Core" || view === "Instructor" || view === "Technigala" ? selection[view] : null;
  const optInAll = optIn ? optIn.total > 0 && optIn.set.size === optIn.total : false;
  const optInIds = (role: Exclude<Role, "Project">) =>
    rows.filter((r) => r.role === role).map((r) => r.userId!);

  const emptyLabel: Record<RoleView, string> = {
    all: "No hires for this term.",
    Project: filterActive
      ? "No project assignments match this filter."
      : "No project assignments for this term.",
    Core: "No Core assignments for this term.",
    Instructor: "No Instructor assignments for this term.",
    Technigala: "No Technigala hires for this term. Add lab members with Technigala hire.",
  };

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader
        section="payroll"
        actions={
          <>
            <Select
              value={selectedTermId}
              ariaLabel="Term"
              options={terms.map((t) => ({
                value: t.id,
                label: t.isCurrent ? `${t.code} · current` : t.code,
              }))}
              // Submit the picked value explicitly: the form's DOM still holds
              // the old value in the same tick.
              onChange={(value) => {
                const params = new URLSearchParams(searchParams);
                params.set("term", value);
                // Domain pills come from the term's assignments, so a term
                // switch drops the role filter to avoid stale ids.
                params.delete("domain");
                params.delete("level");
                submit(params, { method: "get" });
              }}
              buttonClassName={cn(actionBtn(), "justify-between")}
            />
            <TechnigalaPicker options={addOptions} onPick={addTechnigala} />
            <a href={csvHref} download data-discover="false" className={actionBtnPrimary}>
              <Download className="h-4 w-4" /> Export CSV
            </a>
          </>
        }
      />

      <div className="flex flex-col gap-1">
        <p className="font-heading text-2xl font-semibold text-foreground">{selectedTermCode}</p>
        <p className={cn(bodyText, "flex flex-wrap items-center gap-1.5")}>
          <span>
            <span className="tabular-nums text-foreground">{totalRows}</span>{" "}
            {totalRows === 1 ? "row" : "rows"} in the export: {projectRows.length} project,{" "}
            {coreSelected.size} Core, {instructorSelected.size} Instructors, {technigalaSelected.size} Technigala.
          </span>
          <InfoTip content="Project assignments are always included. Core, Instructors and Technigala are opt in per person: uncheck anyone not working this term. The trash icon removes a Technigala hire. Supervisors and anticipated hours per week are constants; phone, term and max-hours columns are blank per the payroll spec." />
        </p>
      </div>

      {flagged.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-os-item bg-os-amber/10 px-4 py-3 text-sm text-os-amber"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            {flagged.length} {flagged.length === 1 ? "row" : "rows"} with missing data. Export still works, but
            check {flagged.length === 1 ? "it" : "them"} first:{" "}
            {flagged
              .slice(0, 6)
              .map((r) => `${r.name || r.netId} (${r.warnings.join("; ")})`)
              .join(", ")}
            {flagged.length > 6 ? `, and ${flagged.length - 6} more` : ""}.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<RoleView>
            ariaLabel="Filter by role"
            value={view}
            onChange={setView}
            size="md"
            options={[
              { value: "all", label: "All", count: rows.length },
              { value: "Project", label: "Projects", count: projectRows.length },
              { value: "Core", label: "Core", count: coreCandidates.length },
              { value: "Instructor", label: "Instructors", count: instructorCandidates.length },
              { value: "Technigala", label: "Technigala", count: technigalaHires.length },
            ]}
          />
          {optIn && optIn.total > 0 && (
            <div className="flex items-center gap-3 text-sm text-os-grey">
              <span className="tabular-nums">
                {optIn.set.size} of {optIn.total} included
              </span>
              <button
                type="button"
                className={actionBtn()}
                onClick={() =>
                  optIn.setter(optInAll ? new Set() : new Set(optInIds(view as Exclude<Role, "Project">)))
                }
              >
                {optInAll ? "Clear all" : "Select all"}
              </button>
            </div>
          )}
        </div>

        {(view === "all" || view === "Project") && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold text-os-muted">Domain</span>
                {termDomains.length === 0 ? (
                  <span className="text-xs text-os-muted">None this term</span>
                ) : (
                  termDomains.map((d) => (
                    <FilterPill
                      key={d.id}
                      label={d.displayName}
                      active={selectedDomainIds.includes(d.id)}
                      onClick={() => toggleFilterValue("domain", d.id)}
                    />
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold text-os-muted">Level</span>
                {ALL_LEVELS.map((l) => (
                  <FilterPill
                    key={l}
                    label={l}
                    active={selectedLevels.includes(l)}
                    onClick={() => toggleFilterValue("level", l)}
                  />
                ))}
              </div>
              {filterActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-sm text-os-accent transition-colors hover:text-os-accent-hover"
                >
                  Clear filter
                </button>
              )}
            </div>
            {filterActive && (
              <p className="text-xs text-os-grey">
                Project assignments narrowed to <strong className="text-foreground">{filterSummary}</strong>.
                Core, Instructor and Technigala selections are unaffected, so check them to include those people
                too (for example PMs plus Core).
              </p>
            )}
          </div>
        )}

        <div className={adminTable.wrap}>
          {visible.length === 0 ? (
            <EmptyState>{emptyLabel[view]}</EmptyState>
          ) : (
            <table className="w-full min-w-[960px] [&_td]:px-3 [&_th]:px-3">
              <thead>
                <tr>
                  <th className={cn(adminTable.th, "w-10")}>
                    <span className="sr-only">Include</span>
                  </th>
                  <th className={adminTable.th}>Name</th>
                  <th className={adminTable.th}>Role</th>
                  <th className={adminTable.th}>Domain, level or title</th>
                  <th className={adminTable.th}>Job ID</th>
                  <th className={cn(adminTable.th, "text-right")}>Wage</th>
                  <th className={adminTable.th}>Hire dates</th>
                  <th className={adminTable.th}>Chart string</th>
                  <th className={adminTable.th}>Status</th>
                  {showActions && (
                    <th className={cn(adminTable.th, "w-12")}>
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const included = isIncluded(r);
                  return (
                    <tr key={r.key} className={cn(adminTable.row, !included && "opacity-50")}>
                      <td className={adminTable.td}>
                        {r.role === "Project" ? (
                          <Tooltip content="Project assignments are always included">
                            <span className="inline-flex">
                              <Checkbox tone="os" checked disabled readOnly aria-label={`${r.name} is always included`} />
                            </span>
                          </Tooltip>
                        ) : (
                          <Checkbox
                            tone="os"
                            checked={included}
                            onChange={() => {
                              const sel = selection[r.role as Exclude<Role, "Project">];
                              sel.setter(toggleIn(sel.set, r.userId!));
                            }}
                            aria-label={`Include ${r.name} in payroll export`}
                          />
                        )}
                      </td>
                      <td className={adminTable.td}>
                        <p className="whitespace-nowrap font-semibold text-foreground">{r.name || "—"}</p>
                        <p className="font-mono text-xs text-os-muted">{r.netId || "—"}</p>
                      </td>
                      <td className={cn(adminTable.td, "text-os-grey")}>{ROLE_LABEL[r.role]}</td>
                      <td className={cn(adminTable.td, "max-w-[14rem] text-os-grey")}>{r.detail || "—"}</td>
                      <td className={cn(adminTable.td, "font-mono text-xs text-foreground")}>{r.jobId || "—"}</td>
                      <td className={cn(adminTable.td, "text-right tabular-nums text-foreground")}>
                        {r.wage ? `$${r.wage}` : "—"}
                      </td>
                      <td className={cn(adminTable.td, "whitespace-nowrap tabular-nums text-os-grey")}>
                        {r.hireStart ? (
                          <>
                            <span className="block">{r.hireStart}</span>
                            <span className="block text-xs text-os-muted">to {r.hireEnd}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={adminTable.td}>
                        {r.chartString ? (
                          <>
                            <p className="whitespace-nowrap font-mono text-xs text-foreground">{r.chartString}</p>
                            {r.chartStringType && <p className="text-xs text-os-muted">{r.chartStringType}</p>}
                          </>
                        ) : (
                          <span className="text-os-muted">—</span>
                        )}
                      </td>
                      <td className={cn(adminTable.td, "min-w-[10rem]")}>
                        {!included ? (
                          <Pill tone="idle">Skipped</Pill>
                        ) : r.warnings.length > 0 ? (
                          <div className="flex flex-col items-start gap-1">
                            {r.warnings.map((w) => (
                              <Tooltip key={w} content={w}>
                                <span className="inline-flex max-w-[11rem]">
                                  <Pill tone="warn" className="whitespace-normal! py-1 leading-snug">
                                    {w}
                                  </Pill>
                                </span>
                              </Tooltip>
                            ))}
                          </div>
                        ) : (
                          <Pill tone="ok">Ready</Pill>
                        )}
                      </td>
                      {showActions && (
                      <td className={cn(adminTable.td, "text-right")}>
                        {r.role === "Technigala" && (
                          <Tooltip content="Remove from Technigala">
                            <button
                              type="button"
                              onClick={() => void removeTechnigala(r.userId!, r.name)}
                              className={cn(iconBtn, "hover:text-destructive")}
                              aria-label={`Remove ${r.name} from Technigala`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </Tooltip>
                        )}
                      </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-os-accent/30 bg-os-accent/15 text-os-accent"
          : "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function TechnigalaPicker({
  options,
  onPick,
}: {
  options: { value: string; label: string }[];
  onPick: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  return (
    <Popover
      align="right"
      ariaLabel="Add a Technigala hire"
      trigger={
        <button type="button" className="os-add-btn py-2" aria-label="Add a Technigala hire">
          <Plus className="h-4 w-4" strokeWidth={3} aria-hidden /> Technigala hire
        </button>
      }
    >
      {(close) => (
        <div className="flex w-72 flex-col gap-1">
          <SearchInput
            size="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a lab member"
            aria-label="Find a lab member"
            autoFocus
          />
          <ul className="max-h-72 overflow-y-auto">
            {matches.length === 0 ? (
              <li className="px-2.5 py-2 text-sm text-os-muted">
                {options.length === 0 ? "Everyone eligible is already hired." : "No matches"}
              </li>
            ) : (
              matches.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(o.value);
                      setQuery("");
                      close();
                    }}
                    className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-os-container"
                  >
                    {o.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </Popover>
  );
}
