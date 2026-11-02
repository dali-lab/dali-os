import { useId, useMemo, useState, type ReactNode } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import type { Route } from "./+types/core.partners.directory";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { classifyPartnerEmail, normalizeEmail } from "../lib/magic-link.server";
import { Building2, CircleDot, Download, Plus, Shapes, Tag, User } from "lucide-react";
import { SearchInput } from "~/components/ui/SearchInput";
import { IconButton } from "~/components/ui/IconButton";
import { Menu, MenuItem } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { usePersistedState } from "~/hooks/usePersistedState";
import { cn } from "~/lib/cn";
import {
  ColumnFilters,
  useColumnFilters,
  type FilterColumn,
} from "~/projects/components/ColumnFilters";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { DirectoryTable } from "../components/PartnerDirectoryTables";
import {
  DEFAULT_DIRECTORY_SORT,
  DIRECTORY_KIND_OPTIONS,
  directoryExportHref,
  directoryRowCells,
  filterDirectoryRows,
  isDirectorySort,
  nextDirectorySort,
  sortDirectoryRows,
  type DirectorySort,
  type DirectorySortKey,
  type PartnerDirectoryRow,
} from "../lib/partner-directory";
import { listPartnerDirectoryRows } from "../lib/partner-directory.server";
import {
  PARTNER_ORG_TYPES,
  PARTNER_ORG_TYPE_LABELS,
  PARTNER_RELATIONSHIP_STATUSES,
  PARTNER_RELATIONSHIP_STATUS_LABELS,
} from "../lib/partner-org";

// areaSubnav: this page mounts PartnerCrmNav itself, so the shell must not add
// its own sub-nav row above it.
export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partners · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  return { rows: await listPartnerDirectoryRows() };
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

function NewOrgModal({
  open,
  individual,
  onClose,
  orgs,
}: {
  open: boolean;
  /** true = "New individual partner", false = "New organization". */
  individual: boolean;
  onClose: () => void;
  orgs: { id: string; name: string }[];
}) {
  const actionData = useActionData<typeof action>();
  const titleId = useId();
  const [name, setName] = useState("");
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
          onClose();
        }}
        className="os-form flex flex-col gap-3"
      >
        <input type="hidden" name="intent" value="org-create" />
        {individual && <input type="hidden" name="isIndividual" value="on" />}
        {actionData && "error" in actionData && (
          <p className="rounded-os-item bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionData.error}
          </p>
        )}
        <label className="flex flex-col gap-1.5">
          <span>
            Name<span className="text-destructive"> *</span>
          </span>
          <input
            name="name"
            type="text"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={individual ? "Full name" : "Organization name"}
          />
        </label>
        {duplicate && (
          <p className="text-xs text-os-grey">
            An organization named “{duplicate.name}” already exists.{" "}
            <Link
              to={`/core/partners/orgs/${duplicate.id}`}
              className="text-os-accent hover:underline"
            >
              view it
            </Link>
            .
          </p>
        )}
        {individual ? (
          <label className="flex flex-col gap-1.5">
            <span>
              Email<span className="text-destructive"> *</span>
            </span>
            <input name="email" type="email" required placeholder="name@example.com" />
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span>Website</span>
            <input name="website" type="url" placeholder="https://" />
          </label>
        )}
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
      <Form method="post" onSubmit={onClose} className="os-form flex flex-col gap-3">
        <input type="hidden" name="intent" value="contact-create" />
        {actionData && "error" in actionData && (
          <p className="rounded-os-item bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionData.error}
          </p>
        )}
        <label className="flex flex-col gap-1.5">
          <span>
            Name<span className="text-destructive"> *</span>
          </span>
          <input name="name" type="text" autoFocus required />
        </label>
        <label className="flex flex-col gap-1.5">
          <span>
            Email<span className="text-destructive"> *</span>
          </span>
          <input name="email" type="email" required placeholder="name@example.com" />
        </label>
        <p className="text-xs text-os-grey">
          An existing contact with this email opens instead of creating a duplicate.
        </p>
        <label className="flex flex-col gap-1.5">
          <span>Title</span>
          <input name="title" type="text" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span>Affiliation</span>
          <input name="affiliation" type="text" />
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

const FILTER_COLUMNS: FilterColumn[] = [
  { key: "kind", label: "Kind", icon: Shapes, order: DIRECTORY_KIND_OPTIONS },
  {
    key: "type",
    label: "Type",
    icon: Tag,
    order: PARTNER_ORG_TYPES,
    optionLabel: (v) => PARTNER_ORG_TYPE_LABELS[v as (typeof PARTNER_ORG_TYPES)[number]] ?? v,
  },
  {
    key: "status",
    label: "Status",
    icon: CircleDot,
    order: PARTNER_RELATIONSHIP_STATUSES,
    optionLabel: (v) =>
      PARTNER_RELATIONSHIP_STATUS_LABELS[v as (typeof PARTNER_RELATIONSHIP_STATUSES)[number]] ?? v,
  },
  { key: "org", label: "Organization", icon: Building2 },
];

type CreateKind = "org" | "individual" | "contact";

export default function PartnersDirectory() {
  const { rows } = useLoaderData<typeof loader>();
  const os = useOsChrome();
  const [creating, setCreating] = useState<CreateKind | null>(null);
  const [query, setQuery] = useState("");
  const columnFilters = useColumnFilters(FILTER_COLUMNS);
  const filterRows = useMemo(() => rows.map((r) => ({ cells: directoryRowCells(r) })), [rows]);
  const [sort, setSort] = usePersistedState<DirectorySort>(
    "dali:partners:directory:sort",
    DEFAULT_DIRECTORY_SORT,
    isDirectorySort,
  );

  const filtered = useMemo(
    () => sortDirectoryRows(filterDirectoryRows(rows, query, columnFilters.active), sort),
    [rows, query, columnFilters.active, sort],
  );

  const orgs = useMemo(
    () => rows.filter((r) => r.kind !== "person").map((r) => ({ id: r.id, name: r.name })),
    [rows],
  );

  const hasNarrowing = query.trim() !== "" || columnFilters.active.length > 0;
  const onSort = (key: DirectorySortKey) => setSort((current) => nextDirectorySort(current, key));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Partners</h1>

      <NewOrgModal
        open={creating === "org" || creating === "individual"}
        individual={creating === "individual"}
        onClose={() => setCreating(null)}
        orgs={orgs}
      />
      <NewContactModal open={creating === "contact"} onClose={() => setCreating(null)} />

      <div className="flex flex-wrap items-center gap-2">
        <PartnerCrmNav className="shrink-0" />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search partners and people…"
          aria-label="Search the directory"
          containerClassName="flex-1 min-w-[180px] max-w-[320px]"
        />
        <div className="min-w-[220px] flex-1">
          <ColumnFilters
            columns={FILTER_COLUMNS}
            rows={filterRows}
            filters={columnFilters.filters}
            onChange={columnFilters.setFilters}
            shownCount={filtered.length}
            noun={["record", "records"]}
          />
        </div>
        <IconButton
          label="Export CSV"
          icon={Download}
          className="os-icon-btn"
          onClick={() => window.location.assign(directoryExportHref(query, columnFilters.active))}
        />
        <Menu
          align="right"
          ariaLabel="Add to the directory"
          trigger={
            <button type="button" className="os-btn-primary shrink-0 whitespace-nowrap">
              <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
              New
            </button>
          }
        >
          <MenuItem icon={<Building2 className="h-4 w-4" />} onSelect={() => setCreating("org")}>
            Organization
          </MenuItem>
          <MenuItem
            icon={<User className="h-4 w-4" />}
            onSelect={() => setCreating("individual")}
          >
            Individual partner
          </MenuItem>
          <MenuItem icon={<User className="h-4 w-4" />} onSelect={() => setCreating("contact")}>
            Contact
          </MenuItem>
        </Menu>
      </div>

      <div className={cn(os.panel, "overflow-hidden pt-2")}>
        {filtered.length === 0 ? (
          <EmptyPanel>
            {hasNarrowing ? "No records match this search." : "No partners yet."}
          </EmptyPanel>
        ) : (
          <DirectoryTable
            rows={filtered}
            sort={sort}
            onSort={onSort}
            resetKey={JSON.stringify([query, columnFilters.active, sort])}
          />
        )}
      </div>
    </div>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}
