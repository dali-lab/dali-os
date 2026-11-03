import { useMemo, useState } from "react";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/members";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { graduateProgramLabel } from "~/lib/dartmouth-people";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { prisma } from "~/lib/db";
import {
  createOrPromoteMember,
  MemberInputError,
  PROFILE_TEXT_FIELDS,
} from "~/members/lib/membership.server";
import { fullName, primaryEmail } from "~/lib/display";
import { Avatar } from "~/components/ui/Avatar";
import { MoreHorizontal } from "lucide-react";
import { Menu, MenuItem } from "~/components/ui/floating";
import { isNewMember, isBirthdayToday } from "~/members/lib/warmth";
import { NewDot, BirthdayBadge } from "~/members/components/WarmthBadges";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { deriveCoreTitles } from "~/lib/core-titles";
import {
  BookOpen,
  Briefcase,
  Building2,
  FolderKanban,
  GraduationCap,
  Home,
  Layers,
  MapPin,
  Plus,
} from "lucide-react";
import { SearchInput } from "~/components/ui/SearchInput";
import { Segmented } from "~/components/ui/Segmented";
import {
  ColumnFilters,
  useColumnFilters,
  type FilterColumn,
} from "~/projects/components/ColumnFilters";
import type { ColumnFilter } from "~/projects/lib/submission-filters";
import { cn } from "~/lib/cn";
export const meta: Route.MetaFunction = () => [{ title: "Directory · People · DALI OS" }];

type MemberRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  pronouns: string | null;
  classYear: number | null;
  // Grad/professional school label ("Thayer" etc.) shown in place of a class
  // year for enrolled grad students; null for undergrads and employees.
  gradProgram: string | null;
  photoUrl: string | null;
  // Full-time staff (AdminMembership.isStaff) — shown as a Staff badge.
  isStaff: boolean;
  coreTitles: string[];
  // Each domain the member is eligible for, with their level — rendered as
  // pills in the Roles column. Same source as the staffing boards.
  domainRoles: { domainName: string; level: string }[];
  // Warmth surfaces: "New" pill (recently joined) + 🎂 on the day.
  createdAt: string;
  onboardedAt: string | null;
  birthday: string | null;
  // What the filter builder matches against, keyed by FILTER_COLUMNS.
  cells: Record<string, string | string[]>;
};

// The filter bar's columns. A list-valued cell (domains, projects, roles,
// companies) matches a picked value on any one of its entries.
const FILTER_COLUMNS: FilterColumn[] = [
  { key: "domain", label: "Domain", icon: Layers },
  { key: "project", label: "Project", icon: FolderKanban },
  { key: "classYear", label: "Class year", icon: GraduationCap },
  { key: "role", label: "Role", icon: Briefcase },
  { key: "major", label: "Major", icon: BookOpen },
  { key: "basedIn", label: "Based in", icon: MapPin },
  { key: "company", label: "Company", icon: Building2 },
  { key: "hometown", label: "Hometown", icon: Home },
];

type MemberStatus = "active" | "alumni";

function parseStatus(raw: string | null): MemberStatus {
  return raw === "alumni" ? "alumni" : "active";
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;

  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get("status"));

  // Domain, project and class are filter-bar columns now, matched in the
  // browser. The old ?domain= / ?project= / ?class= links (the Groups page
  // still sends the first two) open with that filter already applied; an
  // unknown id is ignored so a stale link just shows everyone.
  const [domainParam, projectParam] = ["domain", "project"].map(
    (k) => url.searchParams.get(k) ?? "",
  );

  // None of these three depend on each other's result — the linked
  // domain/project lookups only need the parsed url params and canEdit only
  // needs the viewer id — so they run as one wave instead of a chain of
  // sequential round-trips.
  const [linkedDomain, linkedProject, canEdit] = await Promise.all([
    domainParam
      ? prisma.domain.findUnique({ where: { id: domainParam }, select: { displayName: true } })
      : null,
    projectParam
      ? prisma.project.findUnique({ where: { id: projectParam }, select: { name: true } })
      : null,
    isCore(auth.user.sub, request),
  ]);

  const classParam = Number(url.searchParams.get("class"));
  const initialFilters: ColumnFilter[] = [
    ...(linkedDomain ? [{ columnKey: "domain", values: [linkedDomain.displayName] }] : []),
    ...(linkedProject ? [{ columnKey: "project", values: [linkedProject.name] }] : []),
    ...(Number.isInteger(classParam) && classParam > 0
      ? [{ columnKey: "classYear", values: [String(classParam)] }]
      : []),
  ];

  // Lab members are Users with a DALIMember row attached. Roles derive from
  // AdminMembership + CoreAssignment per the Phase 2 identity model — see
  // app/admin/routes/api.members.ts for the canonical shape.
  // Each view pins the stored membership status onto the same base set (both
  // still require a DALIMember row); Alumni sorts by class year.
  // membershipStatus is authoritative — no derivation here.
  const statusCondition =
    status === "alumni"
      ? { membershipStatus: "Alumni" as const }
      : { membershipStatus: "Active" as const };

  const users = await prisma.user.findMany({
    where: {
      ...LAB_MEMBER_WHERE,
      ...statusCondition,
    },
    orderBy:
      status === "alumni"
        ? [{ classYear: "desc" as const }, ...MEMBER_LIST_ORDER_BY]
        : MEMBER_LIST_ORDER_BY,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
      pronouns: true,
      classYear: true,
      dartmouthDepartmentClass: true,
      photoUrl: true,
      createdAt: true,
      birthday: true,
      daliMember: { select: { onboardedAt: true } },
      adminMembership: { select: { isStaff: true } },
      coreAssignments: { select: { leadTitle: true } },
      major: true,
      hometown: true,
      currentLocation: true,
      // Every term's assignments: the Project filter matches anyone who was
      // ever on the project, for active members and alumni alike.
      projectAssignments: {
        select: { project: { select: { name: true } } },
      },
      workExperiences: { where: { endDate: null }, select: { company: true } },
      domainEligibilities: {
        select: {
          level: true,
          domain: { select: { displayName: true } },
        },
      },
    },
  });

  const rows: MemberRow[] = await Promise.all(users.map(async (u) => {
    const coreTitles = deriveCoreTitles(u.coreAssignments);
    const isStaff = u.adminMembership?.isStaff === true;
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: primaryEmail(u),
      pronouns: u.pronouns,
      classYear: u.classYear,
      gradProgram: graduateProgramLabel(u.dartmouthDepartmentClass),
      photoUrl: await resolvePhotoUrl(u.photoUrl),
      isStaff,
      createdAt: u.createdAt.toISOString(),
      onboardedAt: u.daliMember?.onboardedAt?.toISOString() ?? null,
      birthday: u.birthday ? u.birthday.toISOString() : null,
      // Core pills: one per distinct lead title (deduped across terms — a
      // "Hiring Lead" who held the title for three terms shows one chip). A Core
      // member with assignments but no title set still gets a plain "Core" pill
      // so their Core status is visible rather than dropped.
      coreTitles,
      domainRoles: u.domainEligibilities.map((e) => ({
        domainName: e.domain.displayName,
        level: e.level,
      })),
      cells: {
        domain: u.domainEligibilities.map((e) => e.domain.displayName),
        project: [...new Set(u.projectAssignments.map((a) => a.project.name))],
        classYear: u.classYear?.toString() ?? "",
        role: [...coreTitles, ...(isStaff ? ["Staff"] : [])],
        major: u.major ?? "",
        basedIn: u.currentLocation ?? "",
        company: [...new Set(u.workExperiences.map((w) => w.company))],
        hometown: u.hometown ?? "",
      },
    };
  }));

  return {
    rows,
    initialFilters,
    canEdit,
    status,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to add members." };
  }

  const form = await request.formData();
  const text = (key: string) => (form.get(key) as string | null) ?? "";
  try {
    const { id } = await createOrPromoteMember(
      {
        firstName: text("firstName"),
        lastName: text("lastName"),
        email: text("email"),
        dartmouthEmail: text("dartmouthEmail"),
        classYear: text("classYear"),
        ...Object.fromEntries(PROFILE_TEXT_FIELDS.map((f) => [f, text(f)])),
      },
      auth.user.sub,
    );
    return redirect(`/members/${id}`);
  } catch (err) {
    if (err instanceof MemberInputError) return { error: err.message };
    throw err;
  }
}

export default function MembersList() {
  const {
    rows,
    initialFilters,
    canEdit,
    status,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const columnFilters = useColumnFilters(FILTER_COLUMNS, initialFilters);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!columnFilters.predicate(r)) return false;
      if (!q) return true;
      const name = `${r.firstName} ${r.lastName}`.toLowerCase();
      const email = (r.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, columnFilters.active]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1
            className={cn(
              "font-heading text-foreground",
              "text-4xl font-medium",
            )}
          >
            People
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="os-add-btn !font-medium"
            >
              <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
              New member
            </button>
          )}
        </div>
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
              name="dartmouthEmail"
              label="Dartmouth email (optional)"
              type="email"
              placeholder="name@dartmouth.edu"
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
            <CreateField name="personalSite" label="Personal site" />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="os-btn-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="os-btn-primary"
            >
              Create
            </button>
          </div>
        </Form>
      )}

      {/* Active/Alumni is a scope switch, not a filter, but it belongs with the
          rest of the controls rather than on a row of its own — a lone segmented
          control above the toolbar read as a second, competing tab bar, which is
          exactly what the design does away with. Leading the row keeps it first
          in reading order and first in the tab order. */}
      <div className={cn("flex items-center gap-3 flex-wrap", "gap-4 pt-2")}>
        <StatusTabs status={status} />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={status === "alumni" ? "Search alumni by name or email" : "Search by name or email"}
          containerClassName="flex-1 min-w-[200px] max-w-[420px]"
        />
        <div className="min-w-[220px] flex-1">
          <ColumnFilters
            columns={FILTER_COLUMNS}
            rows={rows}
            filters={columnFilters.filters}
            onChange={columnFilters.setFilters}
            shownCount={filtered.length}
            noun={status === "alumni" ? ["alum", "alumni"] : ["member", "members"]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {status === "alumni"
            ? rows.length === 0
              ? "No alumni yet."
              : "No alumni match."
            : "No members match."}
        </div>
      ) : (
        <MembersTable rows={filtered} status={status} />
      )}
    </div>
  );
}

// Active ↔ Alumni segmented tab. Drives the loader via `?status=`: Alumni
// scopes the list to members whose stored membershipStatus is Alumni.
function StatusTabs({ status }: { status: MemberStatus }) {
  const [searchParams, setSearchParams] = useSearchParams();
  function set(next: MemberStatus) {
    const params = new URLSearchParams(searchParams);
    if (next === "alumni") {
      params.set("status", "alumni");
    } else {
      params.delete("status");
    }
    setSearchParams(params);
  }
  return (
    <Segmented<MemberStatus>
      value={status}
      onChange={set}
      ariaLabel="Member status"
      size="md"
      pill
      options={[
        { value: "active", label: "Active" },
        { value: "alumni", label: "Alumni" },
      ]}
    />
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
        className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/30"
      />
    </label>
  );
}

// A small, neutral role tag: quiet enough to sit several to a row, with a hairline
// outline so neighbouring roles stay distinct.
function RoleTag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-md border border-border/60 px-1.5 py-px text-[11px] leading-4 text-muted-foreground"
    >
      {children}
    </span>
  );
}

function MembersTable({ rows, status }: { rows: MemberRow[]; status: MemberStatus }) {
  const navigate = useNavigate();
  // Alumni view swaps the Roles column for Class — roles are largely historical
  // for alumni, and class year is the more useful axis.
  const showClass = status === "alumni";
  const open = (m: MemberRow) => {
    const url = `/members/${m.id}`;
    const label = fullName(m) || "Member";
    if (!requestOpenTabIfEmbedded(url, label)) navigate(url);
  };
  return (
    <div className="max-w-5xl overflow-x-auto">
      <table className="w-full min-w-[520px] table-fixed text-sm">
        <colgroup>
          <col className="w-[46%]" />
          <col />
          <col className="w-12" />
        </colgroup>
        <thead>
          <tr className="border-b border-border/40 text-[11px] font-medium text-muted-foreground/80">
            <th className="px-3 py-2 text-left font-medium">Member</th>
            <th className="px-3 py-2 text-left font-medium">{showClass ? "Class" : "Roles"}</th>
            <th className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const name = fullName(m) || "Member";
            const isNew =
              status === "active" &&
              isNewMember(
                {
                  onboardedAt: m.onboardedAt ? new Date(m.onboardedAt) : null,
                  createdAt: new Date(m.createdAt),
                },
                new Date(),
              );
            return (
              <tr
                key={m.id}
                onClick={() => open(m)}
                className="cursor-pointer border-t border-border/30 first:border-t-0 transition-colors hover:bg-muted/30"
              >
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-3">
                    <Avatar photoUrl={m.photoUrl} name={name} size="sm" userId={m.id} className="flex-shrink-0" />
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          {m.firstName} {m.lastName}
                        </span>
                        {isNew && <NewDot />}
                        {m.birthday && isBirthdayToday(new Date(m.birthday), new Date()) && <BirthdayBadge />}
                        {m.isStaff && <RoleTag>Staff</RoleTag>}
                      </span>
                      {m.email && <span className="truncate text-xs text-muted-foreground">{m.email}</span>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  {showClass ? (
                    <span className="text-xs text-muted-foreground">
                      {m.classYear ? `Class of ${m.classYear}` : (m.gradProgram ?? "—")}
                    </span>
                  ) : m.coreTitles.length === 0 && m.domainRoles.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {m.coreTitles.map((t) => (
                        <RoleTag key={`core-${t}`} title={`Core role: ${t}`}>
                          {t}
                        </RoleTag>
                      ))}
                      {m.domainRoles.map((r, i) => (
                        <RoleTag
                          key={`domain-${r.domainName}-${i}`}
                          title={r.level ? `Domain Lead for ${r.domainName} (Level ${r.level})` : `Domain Lead for ${r.domainName}`}
                        >
                          {r.domainName}
                        </RoleTag>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <Menu
                    align="right"
                    ariaLabel={`Actions for ${name}`}
                    trigger={
                      <button
                        type="button"
                        aria-label={`Actions for ${name}`}
                        className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                    }
                  >
                    <MenuItem onSelect={() => open(m)}>View profile</MenuItem>
                    {m.email && (
                      <MenuItem onSelect={() => void navigator.clipboard?.writeText(m.email!)}>Copy email</MenuItem>
                    )}
                  </Menu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
