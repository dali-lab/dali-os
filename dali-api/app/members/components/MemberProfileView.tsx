import { useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  useFetcher,
  useNavigation,
  useSubmit,
} from "react-router";
import {
  FolderKanban,
  Github,
  Globe,
  Linkedin,
  LogOut,
  Mail,
  MessageSquare,
  Plus,
  Shield,
  User as UserIcon,
  X,
} from "lucide-react";
import { EditableSection } from "~/components/EditableSection";
import { ProfilePhotoAvatar } from "~/components/ProfilePhotoAvatar";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import type { Level } from "~/admin-console/lib/eligibility";
import type {
  ProfileMember,
  ProfilePageData,
} from "~/members/lib/profile-page.server";

export function MemberProfileView({
  data,
  actionError,
}: {
  data: ProfilePageData;
  actionError?: string | null;
}) {
  const {
    member,
    roleLabels,
    termCode,
    projectAssignments,
    pendingReviews,
    showReviewsRow,
    isSelf,
    canEdit,
    canManageEligibility,
    allDomains,
    photoUrlResolved,
    collabToken,
    currentUserId,
    presenceUserName,
    presencePhotoUrl,
    presenceSubtitle,
    allowedLevels,
  } = data;

  // /members/:id renders inside a TabWorkspace iframe; a successful save only
  // revalidates the iframe's loaders, not the parent shell. Tell the parent
  // so it can refresh the sidebar avatar. On /profile this is a no-op since
  // window.parent === window.
  const navigation = useNavigation();
  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (navigation.state === "submitting") {
      wasSubmitting.current = true;
      return;
    }
    if (navigation.state === "idle" && wasSubmitting.current) {
      wasSubmitting.current = false;
      if (
        !actionError &&
        typeof window !== "undefined" &&
        window.parent !== window
      ) {
        window.parent.postMessage(
          { type: "dali:profileUpdated" },
          window.location.origin,
        );
      }
    }
  }, [navigation.state, actionError]);

  const primaryEmail =
    member.daliEmail ?? member.dartmouthEmail ?? member.personalEmail ?? "";
  const yearTail = member.classYear
    ? `'${String(member.classYear).slice(-2)}`
    : "";
  const subtitleParts = [
    member.pronouns,
    primaryEmail || null,
    yearTail || null,
  ].filter((p): p is string => Boolean(p));

  const page = (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Self-hides when nobody else is here, so no empty row is left over
          in the common solo case. `self-end` pushes it to the right of the
          column when it does render. */}
      <PresenceBar className="self-end" />

      <header className="flex flex-col items-center gap-4 text-center">
        <ProfilePhotoAvatar
          userId={member.id}
          name={`${member.firstName} ${member.lastName}`}
          initialPreviewUrl={photoUrlResolved}
          canEdit={canEdit}
        />
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {member.firstName} {member.lastName}
          </h1>
          {subtitleParts.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {subtitleParts.join(" · ")}
            </p>
          )}
        </div>
        {isSelf && (
          <div className="flex items-center gap-2">
            <a
              href="/logout"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Log out
            </a>
          </div>
        )}
      </header>

      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      <AccountSection member={member} roleLabels={roleLabels} canEdit={canEdit} />
      <PersonalSection member={member} canEdit={canEdit} />

      <DomainsSection
        eligibilities={member.domainEligibilities}
        allDomains={allDomains}
        canManage={canManageEligibility}
        allowedLevels={allowedLevels}
      />

      <ActivitySection
        isSelf={isSelf}
        termCode={termCode}
        projectAssignments={projectAssignments}
        pendingReviews={pendingReviews}
        showReviewsRow={showReviewsRow}
      />
    </div>
  );

  return collabToken ? (
    <PresenceProvider
      pageId={`member:${member.id}`}
      token={collabToken}
      userName={presenceUserName}
      userId={currentUserId}
      photoUrl={presencePhotoUrl}
      subtitle={presenceSubtitle}
    >
      {page}
    </PresenceProvider>
  ) : (
    page
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

function AccountSection({
  member,
  roleLabels,
  canEdit,
}: {
  member: ProfileMember;
  roleLabels: string[];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const emails = [
    member.daliEmail,
    member.dartmouthEmail,
    member.personalEmail,
  ].filter((e): e is string => Boolean(e));

  return (
    <EditableSection
      title="Account"
      icon={<Shield className="w-4 h-4 text-accent-coral" />}
      canEdit={canEdit}
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing }) => (
        <Form method="post" ref={formRef} className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="profile" />
          {/* Persist personal-section fields when saving identity edits. */}
          <HiddenProfileFields member={member} skip={ACCOUNT_FIELDS} />
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FieldInput
                name="firstName"
                label="First name"
                defaultValue={member.firstName}
                required
              />
              <FieldInput
                name="lastName"
                label="Last name"
                defaultValue={member.lastName}
                required
              />
              <FieldInput
                name="pronouns"
                label="Pronouns"
                defaultValue={member.pronouns ?? ""}
              />
              <FieldInput
                name="major"
                label="Major"
                defaultValue={member.major ?? ""}
              />
              <FieldInput
                name="classYear"
                label="Class year"
                type="number"
                defaultValue={member.classYear?.toString() ?? ""}
              />
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Detail label="Major" value={member.major} />
              <Detail
                label="Class year"
                value={member.classYear?.toString() ?? null}
              />
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground mb-1">Roles</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {roleLabels.length === 0 ? (
                    <span className="text-sm text-foreground">—</span>
                  ) : (
                    roleLabels.map((r) => (
                      <span
                        key={r}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-accent-coral/15 text-accent-coral"
                      >
                        {r}
                      </span>
                    ))
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground mb-1">Emails</dt>
                <dd className="flex flex-col gap-0.5">
                  {emails.length === 0 ? (
                    <span className="text-sm text-foreground">—</span>
                  ) : (
                    emails.map((e) => (
                      <span
                        key={e}
                        className="inline-flex items-center gap-1.5 text-sm text-foreground"
                      >
                        <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                        {e}
                      </span>
                    ))
                  )}
                </dd>
              </div>
            </dl>
          )}
        </Form>
      )}
    </EditableSection>
  );
}

function PersonalSection({
  member,
  canEdit,
}: {
  member: ProfileMember;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Personal"
      icon={<UserIcon className="w-4 h-4 text-accent-coral" />}
      canEdit={canEdit}
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing }) => (
        <Form method="post" ref={formRef} className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="profile" />
          <HiddenProfileFields member={member} skip={PERSONAL_FIELDS} />
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FieldInput
                name="hometown"
                label="Hometown"
                defaultValue={member.hometown ?? ""}
              />
              <FieldInput
                name="birthday"
                label="Birthday"
                type="date"
                defaultValue={birthdayInputValue(member.birthday)}
              />
              <FieldInput
                name="phoneNumber"
                label="Phone"
                type="tel"
                defaultValue={member.phoneNumber ?? ""}
              />
              <FieldInput
                name="collegeId"
                label="College ID"
                defaultValue={member.collegeId ?? ""}
              />
              <FieldInput
                name="personalEmail"
                label="Personal email"
                type="email"
                defaultValue={member.personalEmail ?? ""}
              />
              <FieldInput
                name="timeZone"
                label="Time zone (IANA, e.g. America/New_York)"
                defaultValue={member.timeZone ?? ""}
              />
              <FieldInput
                name="githubUsername"
                label="GitHub username"
                defaultValue={member.githubUsername ?? ""}
              />
              <FieldInput
                name="linkedinUrl"
                label="LinkedIn URL"
                defaultValue={member.linkedinUrl ?? ""}
              />
              <FieldInput
                name="personalSite"
                label="Personal site"
                defaultValue={member.personalSite ?? ""}
              />
              <div className="sm:col-span-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">
                    Dietary restrictions
                  </span>
                  <textarea
                    name="dietaryRestrictions"
                    rows={2}
                    defaultValue={member.dietaryRestrictions ?? ""}
                    className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                  />
                </label>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Detail label="Hometown" value={member.hometown} />
              <Detail
                label="Birthday"
                value={formatBirthday(member.birthday)}
              />
              <Detail label="Phone" value={member.phoneNumber} />
              <Detail label="College ID" value={member.collegeId} />
              <Detail label="Time zone" value={member.timeZone} />
              <div>
                <dt className="text-xs text-muted-foreground mb-0.5">GitHub</dt>
                <dd className="text-sm text-foreground">
                  {member.githubUsername ? (
                    <a
                      href={`https://github.com/${member.githubUsername}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-accent-coral hover:underline"
                    >
                      <Github className="w-3.5 h-3.5" />
                      {member.githubUsername}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground mb-0.5">
                  LinkedIn
                </dt>
                <dd className="text-sm text-foreground">
                  {member.linkedinUrl ? (
                    <a
                      href={member.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-accent-coral hover:underline"
                    >
                      <Linkedin className="w-3.5 h-3.5" />
                      Profile
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground mb-0.5">
                  Personal site
                </dt>
                <dd className="text-sm text-foreground">
                  {member.personalSite ? (
                    <a
                      href={member.personalSite}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-accent-coral hover:underline break-all"
                    >
                      <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                      {member.personalSite}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">
                  Dietary restrictions
                </dt>
                <dd className="text-sm text-foreground whitespace-pre-wrap">
                  {member.dietaryRestrictions || "—"}
                </dd>
              </div>
            </dl>
          )}
        </Form>
      )}
    </EditableSection>
  );
}

function ActivitySection({
  isSelf,
  termCode,
  projectAssignments,
  pendingReviews,
  showReviewsRow,
}: {
  isSelf: boolean;
  termCode: string | null;
  projectAssignments: ProfilePageData["projectAssignments"];
  pendingReviews: number;
  showReviewsRow: boolean;
}) {
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
        <FolderKanban className="w-4 h-4 text-accent-coral" />
        {isSelf ? "My activity" : "Activity"}
        {termCode && (
          <span className="text-xs font-normal text-muted-foreground">
            · {termCode}
          </span>
        )}
      </h2>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Projects
        </h3>
        {projectAssignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No project assignments this term.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {projectAssignments.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/projects/${a.project.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors"
                >
                  <span className="text-sm font-medium text-foreground truncate">
                    {a.project.name}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {a.domain.name} · {a.level}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showReviewsRow && (
        <div className="flex items-center gap-2 pt-1 border-t border-border mt-1">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-foreground">
            {`${pendingReviews} review${pendingReviews === 1 ? "" : "s"} in progress`}
          </span>
          {isSelf && (
            <Link
              to="/hiring/reviewer"
              className="ml-auto text-xs font-medium text-accent-coral hover:underline"
            >
              Go to reviews →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Domains & levels (identical to the previous member view) ───────────────

function DomainsSection({
  eligibilities,
  allDomains,
  canManage,
  allowedLevels,
}: {
  eligibilities: ProfileMember["domainEligibilities"];
  allDomains: Array<{ id: string; displayName: string }>;
  canManage: boolean;
  allowedLevels: readonly Level[];
}) {
  const assignedDomainIds = new Set(eligibilities.map((e) => e.domain.id));
  const available = allDomains.filter((d) => !assignedDomainIds.has(d.id));

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <Shield className="w-4 h-4 text-accent-coral" />
          Domains &amp; levels
        </h2>
        {!canManage && (
          <span className="text-[11px] text-muted-foreground/70">
            Only Core or Admin can edit.
          </span>
        )}
      </div>
      {eligibilities.length === 0 && !canManage && (
        <p className="text-sm text-muted-foreground/70 italic">
          No domain eligibilities yet.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {eligibilities.map((e) => (
          <EligibilityRow
            key={e.id}
            eligibility={e}
            canManage={canManage}
            allowedLevels={allowedLevels}
          />
        ))}
      </div>
      {canManage && available.length > 0 && (
        <AddEligibility domains={available} allowedLevels={allowedLevels} />
      )}
      {canManage &&
        available.length === 0 &&
        eligibilities.length === allDomains.length && (
          <p className="text-xs text-muted-foreground/60">
            All active domains are assigned.
          </p>
        )}
    </section>
  );
}

function EligibilityRow({
  eligibility,
  canManage,
  allowedLevels,
}: {
  eligibility: ProfileMember["domainEligibilities"][number];
  canManage: boolean;
  allowedLevels: readonly Level[];
}) {
  const setFetcher = useFetcher();
  const removeFetcher = useFetcher();
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border bg-background/40">
      <span className="text-sm font-medium text-foreground">
        {eligibility.domain.displayName}
      </span>
      <div className="flex items-center gap-2">
        {canManage ? (
          <setFetcher.Form method="post" className="flex items-center gap-1">
            <input type="hidden" name="intent" value="set-eligibility-level" />
            <input
              type="hidden"
              name="domainId"
              value={eligibility.domain.id}
            />
            <select
              name="level"
              defaultValue={eligibility.level}
              onChange={(e) => setFetcher.submit(e.currentTarget.form)}
              className="text-xs font-medium px-2 py-1 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              aria-label={`Level for ${eligibility.domain.displayName}`}
            >
              {allowedLevels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </setFetcher.Form>
        ) : (
          <span className="text-xs font-medium text-foreground">
            {eligibility.level}
          </span>
        )}
        {canManage && (
          <removeFetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value="remove-eligibility" />
            <input
              type="hidden"
              name="eligibilityId"
              value={eligibility.id}
            />
            <button
              type="submit"
              aria-label={`Remove ${eligibility.domain.displayName}`}
              className="text-muted-foreground hover:text-red-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </removeFetcher.Form>
        )}
      </div>
    </div>
  );
}

function AddEligibility({
  domains,
  allowedLevels,
}: {
  domains: Array<{ id: string; displayName: string }>;
  allowedLevels: readonly Level[];
}) {
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const [domainId, setDomainId] = useState("");
  const [level, setLevel] = useState<Level>("P1");
  const submitting = fetcher.state !== "idle";
  const wasSubmitting = useRef(false);

  useEffect(() => {
    if (submitting) {
      wasSubmitting.current = true;
    } else if (wasSubmitting.current) {
      wasSubmitting.current = false;
      setOpen(false);
      setDomainId("");
      setLevel("P1");
    }
  }, [submitting]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:bg-muted"
      >
        <Plus className="w-3 h-3" />
        Add domain
      </button>
    );
  }

  return (
    <fetcher.Form method="post" className="flex items-end gap-2">
      <input type="hidden" name="intent" value="add-eligibility" />
      <label className="flex flex-col gap-1 text-xs flex-1">
        <span className="text-muted-foreground">Domain</span>
        <select
          name="domainId"
          value={domainId}
          onChange={(e) => setDomainId(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          required
        >
          <option value="">Select a domain…</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Level</span>
        <select
          name="level"
          value={level}
          onChange={(e) => setLevel(e.target.value as Level)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        >
          {allowedLevels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={submitting || !domainId}
        className="px-3 py-1.5 text-sm rounded-md bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setDomainId("");
        }}
        className="px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </fetcher.Form>
  );
}

// ─── Field plumbing ─────────────────────────────────────────────────────────

const ACCOUNT_FIELDS = new Set<keyof ProfileMember>([
  "firstName",
  "lastName",
  "pronouns",
  "major",
  "classYear",
]);

const PERSONAL_FIELDS = new Set<keyof ProfileMember>([
  "hometown",
  "birthday",
  "phoneNumber",
  "collegeId",
  "personalEmail",
  "timeZone",
  "githubUsername",
  "linkedinUrl",
  "personalSite",
  "dietaryRestrictions",
]);

// Every profile-update form posts the full set of editable fields so the
// action can treat blank inputs as "set to null" consistently. Whichever
// section isn't currently being edited contributes its values as hidden
// inputs so they round-trip unchanged.
function HiddenProfileFields({
  member,
  skip,
}: {
  member: ProfileMember;
  skip: Set<keyof ProfileMember>;
}) {
  const entries: Array<[string, string]> = [];
  if (!skip.has("firstName")) entries.push(["firstName", member.firstName]);
  if (!skip.has("lastName")) entries.push(["lastName", member.lastName]);
  if (!skip.has("pronouns")) entries.push(["pronouns", member.pronouns ?? ""]);
  if (!skip.has("major")) entries.push(["major", member.major ?? ""]);
  if (!skip.has("classYear"))
    entries.push(["classYear", member.classYear?.toString() ?? ""]);
  if (!skip.has("hometown")) entries.push(["hometown", member.hometown ?? ""]);
  if (!skip.has("birthday"))
    entries.push(["birthday", birthdayInputValue(member.birthday)]);
  if (!skip.has("phoneNumber"))
    entries.push(["phoneNumber", member.phoneNumber ?? ""]);
  if (!skip.has("collegeId"))
    entries.push(["collegeId", member.collegeId ?? ""]);
  if (!skip.has("personalEmail"))
    entries.push(["personalEmail", member.personalEmail ?? ""]);
  if (!skip.has("timeZone")) entries.push(["timeZone", member.timeZone ?? ""]);
  if (!skip.has("githubUsername"))
    entries.push(["githubUsername", member.githubUsername ?? ""]);
  if (!skip.has("linkedinUrl"))
    entries.push(["linkedinUrl", member.linkedinUrl ?? ""]);
  if (!skip.has("personalSite"))
    entries.push(["personalSite", member.personalSite ?? ""]);
  if (!skip.has("dietaryRestrictions"))
    entries.push([
      "dietaryRestrictions",
      member.dietaryRestrictions ?? "",
    ]);
  return (
    <>
      {entries.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

function FieldInput({
  name,
  label,
  defaultValue,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
      />
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

// Birthday is stored at UTC midnight; format from UTC components so a viewer
// in a negative-offset timezone doesn't see the previous day.
function formatBirthday(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// <input type="date"> wants YYYY-MM-DD, anchored in UTC to match how the
// value was stored.
function birthdayInputValue(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
