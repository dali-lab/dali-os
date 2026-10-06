import { useId, useMemo, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/core.partners.directory";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { classifyPartnerEmail, normalizeEmail } from "../lib/magic-link.server";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";
import { Download, Plus } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { Select } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { coreHandle } from "~/core/coreNav";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { OrgAvatar } from "../components/org/OrgAvatar";
import { OrgStatusPill, OrgTypePill } from "../components/org/OrgStatusPill";
import { ContactAvatar } from "../components/contact/ContactAvatar";
import { relativeTime } from "~/lib/relative-time";
import {
  listPartnerContactRows,
  listPartnerOrgRows,
  type PartnerContactDirectoryRow,
  type PartnerOrgDirectoryRow,
} from "../lib/partner-directory";
import {
  PARTNER_ORG_TYPES,
  PARTNER_ORG_TYPE_LABELS,
  PARTNER_RELATIONSHIP_STATUSES,
  PARTNER_RELATIONSHIP_STATUS_LABELS,
} from "../lib/partner-org";

// areaSubnav: this page mounts PartnerCrmNav (Board/Directory/Reports/
// Settings) itself at the top, so the shell must not add its own sub-nav
// row above it.
export const handle = { ...coreHandle("partners"), areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partners · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
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
            An organization named “{duplicate.name}” already exists —{" "}
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [includeIndividuals, setIncludeIndividuals] = useState(true);
  const [view, setView] = useViewPreference("partners:directory", "list");

  const activeView: DirectoryView = searchParams.get("view") === "contacts" ? "contacts" : "orgs";
  const setActiveView = (next: DirectoryView) =>
    setSearchParams(
      (prev) => {
        prev.set("view", next);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );

  const filteredOrgs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orgs.filter((o) => {
      if (q && !o.name.toLowerCase().includes(q)) return false;
      if (typeFilter !== "all" && o.type !== typeFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!includeIndividuals && o.isIndividual) return false;
      return true;
    });
  }, [orgs, query, typeFilter, statusFilter, includeIndividuals]);

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        c.orgs.some((o) => o.name.toLowerCase().includes(q)),
    );
  }, [contacts, query]);

  return (
    <div className="flex flex-col gap-4">
      <PartnerCrmNav />
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-foreground text-4xl font-medium">Partners</h1>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/partner-directory.csv?view=${activeView}`}
            className="os-btn-ghost inline-flex items-center gap-1.5"
          >
            <Download className="h-4 w-4" aria-hidden /> Export
          </a>
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
      </header>

      <NewOrgModal open={creatingOrg} onClose={() => setCreatingOrg(false)} orgs={orgs} />
      <NewContactModal open={creatingContact} onClose={() => setCreatingContact(false)} />

      <div className="flex items-center gap-4 flex-wrap">
        <SegmentedTabButtons
          label="Directory"
          items={[
            { label: "Organizations", active: activeView === "orgs", onClick: () => setActiveView("orgs") },
            { label: "Contacts", active: activeView === "contacts", onClick: () => setActiveView("contacts") },
          ]}
        />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={activeView === "orgs" ? "Search by organization name" : "Search contacts"}
          containerClassName="flex-1 min-w-[200px] max-w-[420px]"
        />
        <ViewToggle value={view} onChange={setView} />
      </div>

      {activeView === "orgs" && (
        <div className="flex items-center gap-3 flex-wrap">
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: "all", label: "All types" },
              ...PARTNER_ORG_TYPES.map((t) => ({ value: t, label: PARTNER_ORG_TYPE_LABELS[t] })),
            ]}
            buttonClassName="px-3 py-1.5 text-sm border border-border rounded-full bg-card text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All statuses" },
              ...PARTNER_RELATIONSHIP_STATUSES.map((s) => ({
                value: s,
                label: PARTNER_RELATIONSHIP_STATUS_LABELS[s],
              })),
            ]}
            buttonClassName="px-3 py-1.5 text-sm border border-border rounded-full bg-card text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <Checkbox
            checked={includeIndividuals}
            onChange={(e) => setIncludeIndividuals(e.target.checked)}
            label="Include individuals"
            className="text-sm text-foreground"
          />
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredOrgs.length} {filteredOrgs.length === 1 ? "organization" : "organizations"}
            {filteredOrgs.length !== orgs.length ? ` of ${orgs.length}` : ""}
          </span>
        </div>
      )}
      {activeView === "contacts" && (
        <div className="flex items-center">
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredContacts.length} {filteredContacts.length === 1 ? "contact" : "contacts"}
            {filteredContacts.length !== contacts.length ? ` of ${contacts.length}` : ""}
          </span>
        </div>
      )}

      {activeView === "orgs" ? (
        filteredOrgs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {query ? "No organizations match this search." : "No partner organizations yet."}
          </div>
        ) : view === "list" ? (
          <OrgsTable rows={filteredOrgs} navigate={navigate} />
        ) : (
          <OrgsCards rows={filteredOrgs} />
        )
      ) : filteredContacts.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {query ? "No contacts match this search." : "No partner contacts yet."}
        </div>
      ) : view === "list" ? (
        <ContactsTable rows={filteredContacts} navigate={navigate} />
      ) : (
        <ContactsCards rows={filteredContacts} />
      )}
    </div>
  );
}

function OrgsTable({
  rows,
  navigate,
}: {
  rows: PartnerOrgDirectoryRow[];
  navigate: (url: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Organization</th>
            <th className="text-left font-medium px-4 py-2">Status</th>
            <th className="text-left font-medium px-4 py-2">Members</th>
            <th className="text-left font-medium px-4 py-2">Active projects</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr
              key={o.id}
              onClick={() => {
                const url = `/core/partners/orgs/${o.id}`;
                if (!requestOpenTabIfEmbedded(url, o.name)) navigate(url);
              }}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <OrgAvatar org={o} />
                  <div className="min-w-0">
                    <span className="font-medium text-foreground truncate block">{o.name}</span>
                    {o.isIndividual && (
                      <span className="text-xs text-muted-foreground">Individual</span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-1.5">
                  <OrgStatusPill status={o.status} />
                  <OrgTypePill type={o.type} />
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{o.memberCount}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {o.activeProjectCount}
                {o.totalProjectCount > o.activeProjectCount && (
                  <span className="text-xs"> / {o.totalProjectCount} total</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrgsCards({ rows }: { rows: PartnerOrgDirectoryRow[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((org) => (
        <Link
          key={org.id}
          to={`/core/partners/orgs/${org.id}`}
          className="border border-border rounded-md p-3 bg-background flex items-start gap-3 hover:bg-muted/10 transition-colors"
        >
          <OrgAvatar org={org} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-foreground truncate">{org.name}</span>
              {org.isIndividual && (
                <span className="text-xs text-muted-foreground">Individual</span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <OrgStatusPill status={org.status} />
              <OrgTypePill type={org.type} />
            </div>
            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {!org.isIndividual && (
                <div>
                  {org.memberCount} {org.memberCount === 1 ? "member" : "members"}
                </div>
              )}
              <div>
                {org.activeProjectCount} active
                {org.totalProjectCount > org.activeProjectCount
                  ? ` / ${org.totalProjectCount} total`
                  : ""}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function ContactsTable({
  rows,
  navigate,
}: {
  rows: PartnerContactDirectoryRow[];
  navigate: (url: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Contact</th>
            <th className="text-left font-medium px-4 py-2">Organization</th>
            <th className="text-left font-medium px-4 py-2">Applications</th>
            <th className="text-left font-medium px-4 py-2">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.id}
              onClick={() => {
                const url = `/core/partners/contacts/${c.id}`;
                if (!requestOpenTabIfEmbedded(url, c.name)) navigate(url);
              }}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <ContactAvatar contact={c} />
                  <div className="min-w-0">
                    <span className="font-medium text-foreground truncate block">{c.name}</span>
                    {c.title && (
                      <span className="text-xs text-muted-foreground">{c.title}</span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {c.orgs.map((o) => o.name).join(", ") || "—"}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{c.applicationCount}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {c.lastActivityAt ? relativeTime(c.lastActivityAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactsCards({ rows }: { rows: PartnerContactDirectoryRow[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((c) => (
        <Link
          key={c.id}
          to={`/core/partners/contacts/${c.id}`}
          className="border border-border rounded-md p-3 bg-background flex items-start gap-3 hover:bg-muted/10 transition-colors"
        >
          <ContactAvatar contact={c} />
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-foreground truncate block">{c.name}</span>
            {c.title && <span className="text-xs text-muted-foreground">{c.title}</span>}
            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              <div>{c.orgs.map((o) => o.name).join(", ") || "No organization"}</div>
              <div>
                {c.applicationCount} {c.applicationCount === 1 ? "application" : "applications"}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
