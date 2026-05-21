import { useMemo, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/members";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { initialsFromName } from "~/lib/display";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";
import { TermFilter } from "~/components/TermFilter";
import { resolveTermFilter } from "~/lib/terms";
import {
  useTableFilters,
  FilterableValue,
  ActiveFilters,
  type TableFilters,
} from "~/components/table/click-filter";

export const meta: Route.MetaFunction = () => [{ title: "Members · DALI OS" }];

type MemberRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  pronouns: string | null;
  classYear: number | null;
  photoUrl: string | null;
  isAdmin: boolean;
  coreTitles: string[];
  // Each domain the member is eligible for, with their level — rendered as
  // pills in the Roles column. Same source as the staffing boards.
  domainRoles: { domainName: string; level: string }[];
};

// The label shown on a domain-role chip, also used as its filter value so a
// click filters on that exact domain+level pairing.
function domainRoleValue(d: { domainName: string; level: string }) {
  return `${d.domainName} · ${d.level}`;
}

// Every role chip a member renders, flattened to the strings the click-filter
// matches against (column "role").
function roleValues(m: MemberRow): string[] {
  const values: string[] = [];
  if (m.isAdmin) values.push("Admin");
  values.push(...m.coreTitles);
  values.push(...m.domainRoles.map(domainRoleValue));
  return values;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const { terms, selected, termId, isAll } = await resolveTermFilter(request);

  // "Active in a term" = the member held a Core role OR a project assignment
  // that term. "All terms" drops the constraint and shows every member.
  const activeInTerm =
    isAll || !termId
      ? {}
      : {
          OR: [
            { coreAssignments: { some: { termId } } },
            { projectAssignments: { some: { termId } } },
          ],
        };

  // Domain filter: members are tied to domains via DomainEligibility (same
  // source as the Intent to Work / Project Bids domain filter). An unknown
  // or empty ?domain= is ignored so a stale link just shows everyone.
  const domains = await prisma.domain.findMany({
    where: { active: true },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });
  const url = new URL(request.url);
  const domainParam = url.searchParams.get("domain") ?? "";
  const domainId = domains.some((d) => d.id === domainParam)
    ? domainParam
    : "";
  const inDomain = domainId
    ? { domainEligibilities: { some: { domainId } } }
    : {};

  // Lab members are Users with a DALIMember row attached. Roles derive from
  // AdminMembership + CoreAssignment per the Phase 2 identity model — see
  // app/admin-console/routes/api.members.ts for the canonical shape.
  const users = await prisma.user.findMany({
    where: { daliMember: { isNot: null }, ...activeInTerm, ...inDomain },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
      pronouns: true,
      classYear: true,
      photoUrl: true,
      adminMembership: { select: { id: true } },
      coreAssignments: { select: { leadTitle: true } },
      domainEligibilities: {
        select: {
          level: true,
          domain: { select: { displayName: true } },
        },
      },
    },
  });

  const rows: MemberRow[] = users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.daliEmail ?? u.dartmouthEmail,
    pronouns: u.pronouns,
    classYear: u.classYear,
    photoUrl: u.photoUrl,
    isAdmin: u.adminMembership !== null,
    // Dedupe lead titles across terms — a "Hiring Lead" who held the title
    // for three terms should still show one chip.
    coreTitles: Array.from(
      new Set(u.coreAssignments.map((a) => a.leadTitle).filter((t): t is string => !!t)),
    ),
    domainRoles: u.domainEligibilities.map((e) => ({
      domainName: e.domain.displayName,
      level: e.level,
    })),
  }));

  const canEdit = await isHiringLead(auth.user.sub);

  return {
    rows,
    terms,
    selectedTerm: selected,
    domains,
    selectedDomain: domainId,
    canEdit,
  };
}

// Profile fields offered on the create form. Mirrors the editable text fields
// on members/$id so a member can be filled in fully at creation time; all are
// optional except first/last name. classYear is handled separately (numeric).
const PROFILE_TEXT_FIELDS = [
  "pronouns",
  "major",
  "hometown",
  "linkedinUrl",
  "githubUrl",
  "personalSite",
] as const;

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isHiringLead(auth.user.sub))) {
    return { error: "You don't have permission to add members." };
  }

  const form = await request.formData();
  const firstName = (form.get("firstName") as string | null)?.trim() ?? "";
  const lastName = (form.get("lastName") as string | null)?.trim() ?? "";
  const email = (form.get("email") as string | null)?.trim() ?? "";
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }
  if (!email) {
    return { error: "An email is required." };
  }

  // Dartmouth-issued addresses route to their typed columns so the existing
  // auth paths (CAS/Google) can match this user later; anything else is a
  // personal email. All three are @unique — a collision means the person
  // already has a User row.
  const lower = email.toLowerCase();
  const emailField = lower.endsWith("@dali.dartmouth.edu")
    ? "daliEmail"
    : lower.endsWith("@dartmouth.edu")
      ? "dartmouthEmail"
      : "personalEmail";

  // firstName/lastName/email pass explicitly into create() below so Prisma
  // sees the required scalars; the optional profile fields collect here.
  const profile: Record<string, string> = {};
  for (const field of PROFILE_TEXT_FIELDS) {
    const raw = (form.get(field) as string | null)?.trim() ?? "";
    if (raw !== "") profile[field] = raw;
  }
  let classYear: number | undefined;
  const classYearRaw = (form.get("classYear") as string | null)?.trim() ?? "";
  if (classYearRaw !== "") {
    const n = Number(classYearRaw);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      return { error: "Class year must be a 4-digit year." };
    }
    classYear = n;
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { daliEmail: lower },
        { dartmouthEmail: lower },
        { personalEmail: lower },
      ],
    },
    select: { id: true, daliMember: { select: { id: true } } },
  });
  if (existing) {
    // The User already exists — promote them to a lab member rather than
    // erroring out, then send the editor to their profile.
    if (!existing.daliMember) {
      await prisma.dALIMember.create({ data: { userId: existing.id } });
    }
    return redirect(`/members/${existing.id}`);
  }

  // New person: User + the thin DALIMember marker that makes them show in
  // this directory (loader filters on daliMember != null). The chosen email
  // column is dynamic, hence the small typed partial.
  const emailData: {
    daliEmail?: string;
    dartmouthEmail?: string;
    personalEmail?: string;
  } = { [emailField]: lower };
  const created = await prisma.user.create({
    data: {
      firstName,
      lastName,
      ...emailData,
      ...profile,
      classYear,
      daliMember: { create: {} },
    },
    select: { id: true },
  });
  return redirect(`/members/${created.id}`);
}

export default function MembersList() {
  const { rows, terms, selectedTerm, domains, selectedDomain, canEdit } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useViewPreference("dali:view:members", "list");
  const filters = useTableFilters();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!filters.matches({ role: roleValues(r) })) return false;
      if (!q) return true;
      const name = `${r.firstName} ${r.lastName}`.toLowerCase();
      const email = (r.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [rows, query, filters]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Members
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everyone with a DALI membership row.
          </p>
        </div>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
          >
            + New member
          </button>
        )}
      </header>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      {creating && canEdit && (
        <Form
          method="post"
          onSubmit={() => setCreating(false)}
          className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
        >
          <h2 className="text-sm font-semibold text-foreground">New member</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CreateField name="firstName" label="First name" required autoFocus />
            <CreateField name="lastName" label="Last name" required />
            <CreateField
              name="email"
              label="Email"
              type="email"
              required
              placeholder="name@dali.dartmouth.edu"
            />
            <CreateField
              name="classYear"
              label="Class year"
              type="number"
              placeholder="2026"
            />
            <CreateField name="pronouns" label="Pronouns" />
            <CreateField name="major" label="Major" />
            <CreateField name="hometown" label="Hometown" />
            <CreateField name="linkedinUrl" label="LinkedIn URL" />
            <CreateField name="githubUrl" label="GitHub URL" />
            <CreateField name="personalSite" label="Personal site" />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
              Create
            </button>
          </div>
        </Form>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        <TermFilter terms={terms} selected={selectedTerm} />
        <DomainFilter domains={domains} selected={selectedDomain} />
        <ViewToggle value={view} onChange={setView} />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} {filtered.length === 1 ? "member" : "members"}
          {(query || filters.active.length > 0) && filtered.length !== rows.length
            ? ` of ${rows.length}`
            : ""}
        </span>
      </div>

      <ActiveFilters filters={filters} />

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {query
            ? "No members match this search."
            : "No members match these filters."}
        </div>
      ) : view === "list" ? (
        <MembersTable rows={filtered} filters={filters} />
      ) : (
        <MembersCards rows={filtered} filters={filters} />
      )}
    </div>
  );
}

function CreateField({
  name,
  label,
  type = "text",
  required = false,
  autoFocus = false,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
      />
    </label>
  );
}

// Domain dropdown for the members directory. Like TermFilter, it drives the
// loader via a search param (`?domain=`) and preserves the other params so it
// composes with the term filter. "" is the "All domains" choice.
function DomainFilter({
  domains,
  selected,
}: {
  domains: { id: string; displayName: string }[];
  selected: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  return (
    <select
      value={selected}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams);
        if (e.target.value) next.set("domain", e.target.value);
        else next.delete("domain");
        setSearchParams(next);
      }}
      aria-label="Filter by domain"
      className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-44"
    >
      <option value="">All domains</option>
      {domains.map((d) => (
        <option key={d.id} value={d.id}>
          {d.displayName}
        </option>
      ))}
    </select>
  );
}

function MembersTable({
  rows,
  filters,
}: {
  rows: MemberRow[];
  filters: TableFilters;
}) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Email</th>
            <th className="text-left font-medium px-4 py-2">Roles</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.id}
              onClick={() => navigate(`/members/${m.id}`)}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2 text-foreground">
                {m.firstName} {m.lastName}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{m.email ?? "—"}</td>
              <td className="px-4 py-2">
                <RolePills
                  isAdmin={m.isAdmin}
                  coreTitles={m.coreTitles}
                  domainRoles={m.domainRoles}
                  filters={filters}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MembersCards({
  rows,
  filters,
}: {
  rows: MemberRow[];
  filters: TableFilters;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
      {rows.map((m) => (
        <MemberCard key={m.id} member={m} filters={filters} />
      ))}
    </div>
  );
}

function MemberCard({
  member,
  filters,
}: {
  member: MemberRow;
  filters: TableFilters;
}) {
  const fullName = `${member.firstName} ${member.lastName}`.trim();
  return (
    <Link
      to={`/members/${member.id}`}
      className="border border-border rounded-md p-3 bg-background flex items-start gap-3 hover:bg-muted/10 transition-colors"
    >
      <Avatar photoUrl={member.photoUrl} name={fullName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-foreground truncate">{fullName}</span>
          {member.pronouns && (
            <span className="text-xs text-muted-foreground">{member.pronouns}</span>
          )}
        </div>
        {member.classYear && (
          <div className="text-xs text-muted-foreground">Class of {member.classYear}</div>
        )}
        {member.email && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">{member.email}</div>
        )}
        <div className="mt-2">
          <RolePills
            isAdmin={member.isAdmin}
            coreTitles={member.coreTitles}
            domainRoles={member.domainRoles}
            filters={filters}
          />
        </div>
      </div>
    </Link>
  );
}

function Avatar({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-accent-coral/15 text-accent-coral flex items-center justify-center font-bold text-sm flex-shrink-0">
      {initialsFromName(name)}
    </div>
  );
}

function RolePills({
  isAdmin,
  coreTitles,
  domainRoles,
  filters,
}: {
  isAdmin: boolean;
  coreTitles: string[];
  domainRoles: { domainName: string; level: string }[];
  filters: TableFilters;
}) {
  if (!isAdmin && coreTitles.length === 0 && domainRoles.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {isAdmin && (
        <FilterableValue
          filters={filters}
          column="role"
          value="Admin"
          className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded cursor-pointer hover:opacity-80 bg-accent-coral/15 text-accent-coral"
        />
      )}
      {coreTitles.map((title) => (
        <FilterableValue
          key={title}
          filters={filters}
          column="role"
          value={title}
          className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded cursor-pointer hover:opacity-80 bg-muted text-foreground"
        />
      ))}
      {domainRoles.map((d) => (
        <FilterableValue
          key={`${d.domainName}-${d.level}`}
          filters={filters}
          column="role"
          value={domainRoleValue(d)}
          className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded cursor-pointer hover:opacity-80 bg-blue-50 text-blue-700 border border-blue-100"
        />
      ))}
    </div>
  );
}
