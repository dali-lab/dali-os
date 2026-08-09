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
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, canViewForms } from "~/lib/roles";
import { graduateProgramLabel } from "~/lib/dartmouth-people";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { prisma } from "~/lib/db";
import { promoteToMember } from "~/members/lib/membership.server";
import { assignHandleIfMissing } from "~/lib/handle";
import { fullName, primaryEmail } from "~/lib/display";
import { Avatar } from "~/components/ui/Avatar";
import { RolePills } from "~/components/ui/RolePills";
import { isNewMember, isBirthdayToday } from "~/members/lib/warmth";
import { NewBadge, BirthdayBadge } from "~/members/components/WarmthBadges";
import { buttonClasses } from "~/components/ui/Button";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { TermFilter } from "~/components/TermFilter";
import { resolveTermFilter } from "~/lib/terms";
import { deriveCoreTitles } from "~/lib/core-titles";
import { LayoutGrid, UsersRound } from "lucide-react";
import { Select, type SelectOption } from "~/components/ui/floating";


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
};

type MemberStatus = "active" | "alumni";

function parseStatus(raw: string | null): MemberStatus {
  return raw === "alumni" ? "alumni" : "active";
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const { terms, selected, termId, isAll } = await resolveTermFilter(request);

  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get("status"));

  // "Active in a term" = the member held a Core role OR a project assignment
  // that term. "All terms" drops the constraint and shows every member. The
  // Alumni view ignores the term filter (term doesn't apply post-grad).
  const activeInTerm =
    status === "alumni" || isAll || !termId
      ? {}
      : {
          OR: [
            { coreAssignments: { some: { termId } } },
            { projectAssignments: { some: { termId } } },
            // Full-time staff have no term assignments but are always current —
            // keep them visible in the default (Active) directory view.
            { adminMembership: { isStaff: true } },
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
  const domainParam = url.searchParams.get("domain") ?? "";
  const domainId = domains.some((d) => d.id === domainParam)
    ? domainParam
    : "";
  const inDomain = domainId
    ? { domainEligibilities: { some: { domainId } } }
    : {};

  // Lab members are Users with a DALIMember row attached. Roles derive from
  // AdminMembership + CoreAssignment per the Phase 2 identity model — see
  // app/admin/routes/api.members.ts for the canonical shape.
  // The Alumni view layers the stored membership status onto the same base set
  // (still requires a DALIMember row; drops the term filter) and sorts by class
  // year. membershipStatus is authoritative — no derivation here.
  const alumniCondition =
    status === "alumni" ? { membershipStatus: "Alumni" as const } : {};
  const users = await prisma.user.findMany({
    where: { ...LAB_MEMBER_WHERE, ...activeInTerm, ...inDomain, ...alumniCondition },
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
      domainEligibilities: {
        select: {
          level: true,
          domain: { select: { displayName: true } },
        },
      },
    },
  });

  const rows: MemberRow[] = await Promise.all(users.map(async (u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: primaryEmail(u),
    pronouns: u.pronouns,
    classYear: u.classYear,
    gradProgram: graduateProgramLabel(u.dartmouthDepartmentClass),
    photoUrl: await resolvePhotoUrl(u.photoUrl),
    isStaff: u.adminMembership?.isStaff === true,
    createdAt: u.createdAt.toISOString(),
    onboardedAt: u.daliMember?.onboardedAt?.toISOString() ?? null,
    birthday: u.birthday ? u.birthday.toISOString() : null,
    // Core pills: one per distinct lead title (deduped across terms — a
    // "Hiring Lead" who held the title for three terms shows one chip). A Core
    // member with assignments but no title set still gets a plain "Core" pill
    // so their Core status is visible rather than dropped.
    coreTitles: deriveCoreTitles(u.coreAssignments),
    domainRoles: u.domainEligibilities.map((e) => ({
      domainName: e.domain.displayName,
      level: e.level,
    })),
  })));

  const [canEdit, canSeeGroups] = await Promise.all([
    isCore(auth.user.sub),
    canViewForms(auth.user.sub),
  ]);

  return {
    rows,
    terms,
    selectedTerm: selected,
    domains,
    selectedDomain: domainId,
    canEdit,
    canSeeGroups,
    status,
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
  "personalSite",
] as const;

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) {
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
    await promoteToMember({ userId: existing.id, actorId: auth.user.sub });
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
  await assignHandleIfMissing(created.id);
  return redirect(`/members/${created.id}`);
}

export default function MembersList() {
  const { rows, terms, selectedTerm, domains, selectedDomain, canEdit, canSeeGroups, status } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = `${r.firstName} ${r.lastName}`.toLowerCase();
      const email = (r.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            People
          </h1>
        </div>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={buttonClasses("primary", "sm")}
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
            <CreateField name="personalSite" label="Personal site" />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className={buttonClasses("ghost", "sm")}
            >
              Cancel
            </button>
            <button type="submit" className={buttonClasses("primary", "sm")}>
              Create
            </button>
          </div>
        </Form>
      )}

      <StatusTabs status={status} />

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={status === "alumni" ? "Search alumni by name or email" : "Search by name or email"}
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        {status === "active" && <TermFilter terms={terms} selected={selectedTerm} />}
        <DomainFilter domains={domains} selected={selectedDomain} />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length}{" "}
          {status === "alumni"
            ? filtered.length === 1
              ? "alum"
              : "alumni"
            : filtered.length === 1
              ? "member"
              : "members"}
          {query && filtered.length !== rows.length ? ` of ${rows.length}` : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {status === "alumni"
            ? query
              ? "No alumni match this search."
              : "No alumni yet."
            : query
              ? "No members match this search."
              : "No members match these filters."}
        </div>
      ) : (
        <MembersTable rows={filtered} status={status} />
      )}
    </div>
  );
}

// Active ↔ Alumni segmented tab. Drives the loader via `?status=`. Switching to
// Alumni drops the `?term=` filter (term doesn't apply post-grad) and scopes the
// list to members whose stored membershipStatus is Alumni.
function StatusTabs({ status }: { status: MemberStatus }) {
  const [searchParams, setSearchParams] = useSearchParams();
  function set(next: MemberStatus) {
    const params = new URLSearchParams(searchParams);
    if (next === "alumni") {
      params.set("status", "alumni");
      params.delete("term");
    } else {
      params.delete("status");
    }
    setSearchParams(params);
  }
  const tabs: { key: MemberStatus; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "alumni", label: "Alumni" },
  ];
  return (
    <div className="inline-flex items-center gap-1 border border-border rounded-md p-1 bg-muted/30 w-fit">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => set(t.key)}
          aria-pressed={status === t.key}
          className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
            status === t.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
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
  const options: SelectOption<string>[] = [
    { value: "", label: "All domains" },
    ...domains.map((d) => ({ value: d.id, label: d.displayName })),
  ];
  return (
    <Select
      value={selected}
      options={options}
      ariaLabel="Filter by domain"
      buttonClassName="inline-flex w-full items-center justify-between gap-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground transition-colors hover:bg-muted/40 sm:w-44"
      onChange={(value) => {
        const next = new URLSearchParams(searchParams);
        if (value) next.set("domain", value);
        else next.delete("domain");
        setSearchParams(next);
      }}
    />
  );
}

function MembersTable({ rows, status }: { rows: MemberRow[]; status: MemberStatus }) {
  const navigate = useNavigate();
  // Alumni view swaps the Roles column for Class — roles are largely historical
  // for alumni, and class year is the more useful axis.
  const showClass = status === "alumni";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Email</th>
            <th className="text-left font-medium px-4 py-2">{showClass ? "Class" : "Roles"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.id}
              onClick={() => {
                const url = `/members/${m.id}`;
                const label = fullName(m) || "Member";
                if (!requestOpenTabIfEmbedded(url, label)) navigate(url);
              }}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2 text-foreground">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    photoUrl={m.photoUrl}
                    name={fullName(m) || "Member"}
                    size="sm"
                    userId={m.id}
                    className="flex-shrink-0"
                  />
                  <span>
                    {m.firstName} {m.lastName}
                  </span>
                  {status === "active" &&
                    isNewMember(
                      {
                        onboardedAt: m.onboardedAt ? new Date(m.onboardedAt) : null,
                        createdAt: new Date(m.createdAt),
                      },
                      new Date(),
                    ) && <NewBadge />}
                  {m.birthday && isBirthdayToday(new Date(m.birthday), new Date()) && (
                    <BirthdayBadge />
                  )}
                  {m.isStaff && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-accent-teal/15 text-accent-teal flex-shrink-0">
                      Staff
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{m.email ?? "—"}</td>
              <td className="px-4 py-2">
                {showClass ? (
                  <span className="text-muted-foreground">
                    {m.classYear
                      ? `Class of ${m.classYear}`
                      : (m.gradProgram ?? "—")}
                  </span>
                ) : m.coreTitles.length === 0 && m.domainRoles.length === 0 ? (
                  <span className="text-muted-foreground text-xs">—</span>
                ) : (
                  <RolePills
                    coreTitles={m.coreTitles}
                    domainRoles={m.domainRoles}
                    size="md"
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

