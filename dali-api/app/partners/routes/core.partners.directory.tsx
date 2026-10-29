import { useId, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/core.partners.directory";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { classifyPartnerEmail, normalizeEmail } from "../lib/magic-link.server";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Download, Plus, SlidersHorizontal } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { Popover } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { IconButton } from "~/components/ui/IconButton";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { useOsChrome } from "~/components/os-chrome";
import { usePersistedState } from "~/hooks/usePersistedState";
import { cn } from "~/lib/cn";
import {
  FilterCountBadge,
  FilterGroup,
  FilterPill,
  FilterResetButton,
  FilterSectionLabel,
  FilterToggleRow,
  customizeButtonClass,
  filterPanelClass,
} from "~/components/ui/filter-panel";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { ContactAvatar } from "../components/contact/ContactAvatar";
import { relativeTime } from "~/lib/relative-time";
import {
  DEFAULT_DIRECTORY_SORT,
  DEFAULT_ORG_FILTERS,
  activeOrgFilterCount,
  directoryExportHref,
  filterContactRows,
  filterOrgRows,
  isDirectorySort,
  listPartnerContactRows,
  listPartnerOrgRows,
  nextDirectorySort,
  orgInitials,
  sortDirectoryRows,
  type DirectorySort,
  type DirectorySortKey,
  type OrgDirectoryFilters,
  type PartnerContactDirectoryRow,
  type PartnerOrgDirectoryRow,
} from "../lib/partner-directory";
import {
  PARTNER_ORG_TYPES,
  PARTNER_ORG_TYPE_LABELS,
  PARTNER_RELATIONSHIP_STATUSES,
  PARTNER_RELATIONSHIP_STATUS_LABELS,
  type PartnerRelationshipStatus,
} from "../lib/partner-org";

const STATUS_DOT: Record<PartnerRelationshipStatus, string> = {
  Active: "bg-os-green",
  Prospect: "bg-os-accent",
  Dormant: "bg-os-amber",
  Past: "bg-os-muted",
};

// areaSubnav: this page mounts PartnerCrmNav itself, so the shell must not add
// its own sub-nav row above it.
export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partners · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const [orgs, contacts] = await Promise.all([listPartnerOrgRows(), listPartnerContactRows()]);
  return { orgs, contacts };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to do that." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "org-create";

  if (intent === "contact-create") {
    const name = (form.get("name") as string | null)?.trim() ?? "";
    if (!name) return { error: "A name is required." };
    const email = normalizeEmail((form.get("email") as string | null) ?? "");
    if (!email.includes("@")) return { error: "A valid email is required." };
    const title = (form.get("title") as string | null)?.trim() || null;
    const affiliation = (form.get("affiliation") as string | null)?.trim() || null;

    // An email that already belongs to a contact links to that record
    // instead of erroring or creating a duplicate.
    const existing = await prisma.partnerContact.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) return redirect(`/core/partners/contacts/${existing.id}`);

    const contact = await prisma.partnerContact.create({
      data: { name, email, title, affiliation },
      select: { id: true },
    });
    await logAuditEvent({
      action: "partner.member.update",
      userId: auth.user.sub,
      targetId: contact.id,
      metadata: { created: true, via: "directory" },
      request,
    });
    return redirect(`/core/partners/contacts/${contact.id}`);
  }

  const name = (form.get("name") as string | null)?.trim() ?? "";
  const isIndividual = form.get("isIndividual") === "on";

  if (!name) return { error: "A name is required." };

  // An individual partner is a person, not an org. Capture their email and set
  // up the contact + membership + primary contact up front (mirrors the
  // promotion path in core.partners.applications.$id) so the detail page
  // renders a person instead of an empty organization.
  if (isIndividual) {
    const email = normalizeEmail((form.get("email") as string | null) ?? "");
    if (!email.includes("@")) {
      return { error: "An email is required for an individual partner." };
    }
    const identity = await classifyPartnerEmail(email);
    if (identity.kind === "member-conflict") {
      return {
        error:
          "That address belongs to a DALI member or Dartmouth account. Partners use a separate work email.",
      };
    }
    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.partnerOrg.create({
        data: { name, isIndividual: true },
        select: { id: true },
      });
      // Reuse an existing contact with this email (they may have applied
      // before); a fresh org means the membership can't collide.
      const contact = await tx.partnerContact.upsert({
        where: { email },
        create: { email, name },
        update: { name },
        select: { id: true },
      });
      const membership = await tx.partnerMembership.create({
        data: { contactId: contact.id, orgId: created.id },
        select: { id: true },
      });
      await tx.partnerOrg.update({
        where: { id: created.id },
        data: { primaryContactId: membership.id },
      });
      return created;
    });
    await logAuditEvent({
      action: "partner.org.create",
      userId: auth.user.sub,
      targetId: org.id,
      metadata: { via: "core", individual: true },
      request,
    });
    return redirect(`/core/partners/orgs/${org.id}`);
  }

  const website = (form.get("website") as string | null)?.trim() || null;
  const org = await prisma.partnerOrg.create({
    data: { name, website, isIndividual: false },
    select: { id: true },
  });
  await logAuditEvent({
    action: "partner.org.create",
    userId: auth.user.sub,
    targetId: org.id,
    metadata: { via: "core" },
    request,
  });
  return redirect(`/core/partners/orgs/${org.id}`);
}

type DirectoryView = "orgs" | "contacts";

function NewOrgModal({
  open,
  onClose,
  orgs,
}: {
  open: boolean;
  onClose: () => void;
  orgs: PartnerOrgDirectoryRow[];
}) {
  const actionData = useActionData<typeof action>();
  const titleId = useId();
  const [name, setName] = useState("");
  const [individual, setIndividual] = useState(false);
  const duplicate = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return null;
    return orgs.find((o) => o.name.toLowerCase() === q) ?? null;
  }, [name, orgs]);

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <ModalHeader
        titleId={titleId}
        title={individual ? "New individual partner" : "New organization"}
        onClose={onClose}
      />
      <Form
        method="post"
        onSubmit={() => {
          setName("");
          setIndividual(false);
          onClose();
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="intent" value="org-create" />
        {actionData && "error" in actionData && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            {actionData.error}
          </p>
        )}
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            Name<span className="text-destructive"> *</span>
          </span>
          <input
            name="name"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={individual ? "Full name" : "Organization name"}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>
        {duplicate && (
          <p className="text-xs text-muted-foreground">
            An organization named “{duplicate.name}” already exists.{" "}
            <Link
              to={`/core/partners/orgs/${duplicate.id}`}
              className="text-dark-blue hover:underline"
            >
              view it
            </Link>
            .
          </p>
        )}
        {individual ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              Email<span className="text-destructive"> *</span>
            </span>
            <input
              name="email"
              type="email"
              required
              placeholder="name@example.com"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Website</span>
            <input
              name="website"
              type="url"
              placeholder="https://"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
        )}
        <Checkbox
          name="isIndividual"
          checked={individual}
          onChange={(e) => setIndividual(e.target.checked)}
          label="Individual"
          description="A single person, not an organization"
          className="text-sm text-foreground"
        />
        <ModalFooter onCancel={onClose}>
          <button type="submit" className="os-btn-primary">
            Create
          </button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}

function NewContactModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actionData = useActionData<typeof action>();
  const titleId = useId();

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <ModalHeader titleId={titleId} title="New contact" onClose={onClose} />
      <Form method="post" onSubmit={onClose} className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="contact-create" />
        {actionData && "error" in actionData && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            {actionData.error}
          </p>
        )}
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            Name<span className="text-destructive"> *</span>
          </span>
          <input
            name="name"
            autoFocus
            required
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            Email<span className="text-destructive"> *</span>
          </span>
          <input
            name="email"
            type="email"
            required
            placeholder="name@example.com"
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          An existing contact with this email opens instead of creating a duplicate.
        </p>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Title</span>
          <input
            name="title"
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Affiliation</span>
          <input
            name="affiliation"
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>
        <ModalFooter onCancel={onClose}>
          <button type="submit" className="os-btn-primary">
            Create
          </button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}

export default function PartnersDirectory() {
  const { orgs, contacts } = useLoaderData<typeof loader>();
  const os = useOsChrome();
  const [searchParams, setSearchParams] = useSearchParams();
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Omit<OrgDirectoryFilters, "query">>({
    type: DEFAULT_ORG_FILTERS.type,
    status: DEFAULT_ORG_FILTERS.status,
    includeIndividuals: DEFAULT_ORG_FILTERS.includeIndividuals,
  });
  const [sort, setSort] = usePersistedState<DirectorySort>(
    "dali:partners:directory:sort",
    DEFAULT_DIRECTORY_SORT,
    isDirectorySort,
  );

  const activeView: DirectoryView = searchParams.get("view") === "contacts" ? "contacts" : "orgs";
  const setActiveView = (next: DirectoryView) =>
    setSearchParams(
      (prev) => {
        prev.set("view", next);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );

  const filteredOrgs = useMemo(
    () => sortDirectoryRows(filterOrgRows(orgs, { ...filters, query }), sort),
    [orgs, filters, query, sort],
  );
  const filteredContacts = useMemo(
    () => sortDirectoryRows(filterContactRows(contacts, query), sort),
    [contacts, query, sort],
  );

  const filterCount = activeOrgFilterCount({ ...filters, query });
  const resetFilters = () =>
    setFilters({
      type: DEFAULT_ORG_FILTERS.type,
      status: DEFAULT_ORG_FILTERS.status,
      includeIndividuals: DEFAULT_ORG_FILTERS.includeIndividuals,
    });
  const onSort = (key: DirectorySortKey) => setSort((current) => nextDirectorySort(current, key));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Partners</h1>

      <NewOrgModal open={creatingOrg} onClose={() => setCreatingOrg(false)} orgs={orgs} />
      <NewContactModal open={creatingContact} onClose={() => setCreatingContact(false)} />

      <div className="flex flex-wrap items-center gap-2">
        <PartnerCrmNav />
        <div className="flex-1" />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={activeView === "orgs" ? "Search organizations…" : "Search contacts…"}
          aria-label={activeView === "orgs" ? "Search organizations" : "Search contacts"}
          containerClassName="w-full max-w-[420px] sm:w-72"
        />
        {activeView === "orgs" && (
          <Popover
            align="right"
            ariaLabel="Customize directory"
            panelClassName={filterPanelClass(true)}
            trigger={
              <button type="button" className={customizeButtonClass(true, filterCount > 0)}>
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                Customize
                <FilterCountBadge os={true} count={filterCount} />
              </button>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <FilterSectionLabel os={true}>Filters</FilterSectionLabel>
                {filterCount > 0 && <FilterResetButton os={true} onClick={resetFilters} />}
              </div>
              <FilterGroup label="Type" os={true}>
                <FilterPill
                  os={true}
                  selected={filters.type === "all"}
                  onClick={() => setFilters((f) => ({ ...f, type: "all" }))}
                >
                  All
                </FilterPill>
                {PARTNER_ORG_TYPES.map((t) => (
                  <FilterPill
                    key={t}
                    os={true}
                    selected={filters.type === t}
                    onClick={() => setFilters((f) => ({ ...f, type: t }))}
                  >
                    {PARTNER_ORG_TYPE_LABELS[t]}
                  </FilterPill>
                ))}
              </FilterGroup>
              <FilterGroup label="Status" os={true}>
                <FilterPill
                  os={true}
                  selected={filters.status === "all"}
                  onClick={() => setFilters((f) => ({ ...f, status: "all" }))}
                >
                  All
                </FilterPill>
                {PARTNER_RELATIONSHIP_STATUSES.map((st) => (
                  <FilterPill
                    key={st}
                    os={true}
                    selected={filters.status === st}
                    onClick={() => setFilters((f) => ({ ...f, status: st }))}
                  >
                    {PARTNER_RELATIONSHIP_STATUS_LABELS[st]}
                  </FilterPill>
                ))}
              </FilterGroup>
              <FilterToggleRow
                label="Include individuals"
                os={true}
                checked={filters.includeIndividuals}
                onChange={(checked) => setFilters((f) => ({ ...f, includeIndividuals: checked }))}
              />
            </div>
          </Popover>
        )}
        <IconButton
          label="Export CSV"
          icon={Download}
          className="os-icon-btn"
          onClick={() => window.location.assign(directoryExportHref(activeView, query, filters))}
        />
        {activeView === "orgs" ? (
          <button type="button" onClick={() => setCreatingOrg(true)} className="os-add-btn">
            <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
            New organization
          </button>
        ) : (
          <button type="button" onClick={() => setCreatingContact(true)} className="os-add-btn">
            <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
            New contact
          </button>
        )}
      </div>

      <div className={cn(os.panel, "overflow-hidden")}>
        <div className="flex items-center px-4 py-3">
          <SegmentedTabButtons
            label="Directory"
            size="sm"
            items={[
              {
                label: "Organizations",
                count: orgs.length,
                active: activeView === "orgs",
                onClick: () => setActiveView("orgs"),
              },
              {
                label: "Contacts",
                count: contacts.length,
                active: activeView === "contacts",
                onClick: () => setActiveView("contacts"),
              },
            ]}
          />
        </div>
        {activeView === "orgs" ? (
          filteredOrgs.length === 0 ? (
            <EmptyPanel>
              {query || filterCount > 0
                ? "No organizations match this search."
                : "No partner organizations yet."}
            </EmptyPanel>
          ) : (
            <OrgsTable rows={filteredOrgs} sort={sort} onSort={onSort} />
          )
        ) : filteredContacts.length === 0 ? (
          <EmptyPanel>{query ? "No contacts match this search." : "No partner contacts yet."}</EmptyPanel>
        ) : (
          <ContactsTable rows={filteredContacts} sort={sort} onSort={onSort} />
        )}
      </div>
    </div>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="border-t border-os-container/70 px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

const TH = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-os-muted first:pl-6 last:pr-6";
const TD = "px-4 py-3 text-sm first:pl-6 last:pr-6";
const ROW = "group relative border-t border-os-container/70 transition-colors hover:bg-os-card-hover";

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: DirectorySortKey;
  sort: DirectorySort;
  onSort: (key: DirectorySortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={TH}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "group/sort inline-flex items-center gap-1 font-semibold transition-colors",
          active ? "text-foreground" : "hover:text-foreground",
        )}
      >
        {label}
        <Icon
          className={cn(
            "h-3 w-3",
            active ? "text-os-accent" : "opacity-0 group-hover/sort:opacity-60 focus-visible:opacity-60",
          )}
          aria-hidden
        />
      </button>
    </th>
  );
}

function RowLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (requestOpenTabIfEmbedded(to, label)) e.preventDefault();
  };
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex min-w-0 items-center gap-3 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-os-accent"
    >
      {children}
    </Link>
  );
}

function StatusPill({ status }: { status: PartnerRelationshipStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-os-well px-2.5 py-0.5 text-xs text-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} aria-hidden />
      {PARTNER_RELATIONSHIP_STATUS_LABELS[status]}
    </span>
  );
}

function Chevron() {
  return (
    <td className={cn(TD, "w-10 text-right text-muted-foreground")}>
      <ChevronRight className="ml-auto h-4 w-4 opacity-60 group-hover:opacity-100" aria-hidden />
    </td>
  );
}

function OrgsTable({
  rows,
  sort,
  onSort,
}: {
  rows: PartnerOrgDirectoryRow[];
  sort: DirectorySort;
  onSort: (key: DirectorySortKey) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr>
            <SortableTh label="Organization" sortKey="name" sort={sort} onSort={onSort} />
            <th className={TH}>Type</th>
            <th className={TH}>Status</th>
            <th className={TH}>Members</th>
            <th className={TH}>Active projects</th>
            <SortableTh label="Last activity" sortKey="activity" sort={sort} onSort={onSort} />
            <th className={cn(TH, "w-10")} aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className={ROW}>
              <td className={TD}>
                <RowLink to={`/core/partners/orgs/${o.id}`} label={o.name}>
                  <span
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-os-well text-[11px] font-semibold text-os-grey"
                    aria-hidden
                  >
                    {orgInitials(o.name)}
                  </span>
                  <span className="truncate font-medium text-foreground">{o.name}</span>
                </RowLink>
              </td>
              <td className={cn(TD, "text-muted-foreground")}>
                {o.isIndividual ? "Individual" : o.type ? PARTNER_ORG_TYPE_LABELS[o.type] : "—"}
              </td>
              <td className={TD}>
                <StatusPill status={o.status} />
              </td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{o.memberCount}</td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{o.activeProjectCount}</td>
              <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>
                {o.lastActivityAt ? relativeTime(o.lastActivityAt) : "—"}
              </td>
              <Chevron />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactsTable({
  rows,
  sort,
  onSort,
}: {
  rows: PartnerContactDirectoryRow[];
  sort: DirectorySort;
  onSort: (key: DirectorySortKey) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr>
            <SortableTh label="Contact" sortKey="name" sort={sort} onSort={onSort} />
            <th className={TH}>Organization</th>
            <th className={TH}>Applications</th>
            <SortableTh label="Last activity" sortKey="activity" sort={sort} onSort={onSort} />
            <th className={cn(TH, "w-10")} aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={ROW}>
              <td className={TD}>
                <RowLink to={`/core/partners/contacts/${c.id}`} label={c.name}>
                  <ContactAvatar contact={c} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{c.name}</span>
                    {c.title && <span className="block truncate text-xs text-muted-foreground">{c.title}</span>}
                  </span>
                </RowLink>
              </td>
              <td className={cn(TD, "text-muted-foreground")}>{c.orgs.map((o) => o.name).join(", ") || "—"}</td>
              <td className={cn(TD, "tabular-nums text-muted-foreground")}>{c.applicationCount}</td>
              <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>
                {c.lastActivityAt ? relativeTime(c.lastActivityAt) : "—"}
              </td>
              <Chevron />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
