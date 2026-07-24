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
  GraduationCap,
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
import { buttonClasses } from "~/components/ui/Button";
import type { Level } from "~/admin-console/lib/eligibility";
import { APPLICATION_TZ, formatZoneLabel } from "~/lib/timezone";
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
    mentorshipPanel,
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


  const hasEducation =
    !!data.education &&
    (data.education.attended.length > 0 ||
      data.education.taught.length > 0 ||
      data.education.ceCredits.length > 0);

  // Flat, card-stacked layout (no left nav, no collapsible chrome) — matches
  // the partner org detail page: an unboxed identity header up top, then each
  // section as its own bordered card. Name/pronouns edit inside Personal's
  // own form (see PersonalSection's showIdentitySummary) rather than a
  // separate Account card, so there's a single Edit control on this page —
  // unlike /settings, which has no Personal section and so still renders
  // AccountSettingsBlock (name/pronouns + major/class year) on its own.
  const page = (
    <div className="max-w-4xl w-full flex flex-col gap-6">
      <PresenceBar className="self-end" />

      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      <div className="flex items-center gap-4">
        <ProfilePhotoAvatar
          userId={member.id}
          name={`${member.firstName} ${member.lastName}`}
          initialPreviewUrl={photoUrlResolved}
          canEdit={canEdit}
        />
        <div className="min-w-0">
          <p className="font-heading text-lg font-semibold text-foreground">
            {member.firstName} {member.lastName}
          </p>
          {member.handle && (
            <p className="text-sm text-accent-coral">@{member.handle}</p>
          )}
          {isSelf && (
            <a
              href="/logout"
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Log out
            </a>
          )}
        </div>
      </div>

      <PersonalSection
        member={member}
        canEdit={canEdit}
        roleLabels={roleLabels}
        showIdentitySummary
      />

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

      {hasEducation && data.education && (
        <EducationSection education={data.education} />
      )}

      {mentorshipPanel && (
        <MentorshipPanel data={mentorshipPanel} memberId={member.id} />
      )}
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

export function AccountSettingsSection({
  member,
  roleLabels,
  canEdit,
  formAction,
  embedded,
  showIdentitySummary = true,
}: {
  member: ProfileMember;
  roleLabels: string[];
  canEdit: boolean;
  formAction?: string;
  /** When true, omit section chrome (used inside Settings page blocks). */
  embedded?: boolean;
  /**
   * Major/class year (editable) + Roles/Emails (read-only) live here by
   * default — the /settings page has nowhere else to put them. The member
   * detail / profile view turns this off and shows them in Personal instead
   * (see PersonalSection's own showIdentitySummary), leaving Account just
   * name + pronouns.
   */
  showIdentitySummary?: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const emails = memberEmails(member);

  return (
    <EditableSection
      title={embedded ? "" : "Account"}
      icon={embedded ? undefined : <Shield className="w-4 h-4 text-accent-coral" />}
      canEdit={canEdit}
      className={
        embedded
          ? "flex flex-col gap-3"
          : "bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
      }
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing }) => (
        <Form method="post" ref={formRef} action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="profile" />
          {/* Persist personal-section fields when saving identity edits. */}
          <HiddenProfileFields
            member={member}
            skip={showIdentitySummary ? ACCOUNT_FIELDS : ACCOUNT_FIELDS_BASE}
          />
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
              {showIdentitySummary && (
                <>
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
                </>
              )}
            </div>
          ) : showIdentitySummary ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
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
          ) : null}
        </Form>
      )}
    </EditableSection>
  );
}

function PersonalSection({
  member,
  canEdit,
  embedded,
  roleLabels,
  showIdentitySummary = false,
}: {
  member: ProfileMember;
  canEdit: boolean;
  embedded?: boolean;
  /** Only needed when showIdentitySummary is true. */
  roleLabels?: string[];
  /**
   * Renders Major/class year (editable) + Roles/Emails (read-only) at the
   * top of this section — moved here from Account on the member detail /
   * profile view. See AccountSettingsSection's own showIdentitySummary.
   */
  showIdentitySummary?: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const emails = showIdentitySummary ? memberEmails(member) : [];

  return (
    <EditableSection
      title={embedded ? "" : "Personal"}
      icon={
        embedded ? undefined : <UserIcon className="w-4 h-4 text-accent-coral" />
      }
      canEdit={canEdit}
      className={
        embedded
          ? "flex flex-col gap-3"
          : "bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
      }
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing }) => (
        <Form method="post" ref={formRef} className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="profile" />
          <HiddenProfileFields
            member={member}
            skip={showIdentitySummary ? PERSONAL_FIELDS_WITH_IDENTITY : PERSONAL_FIELDS}
          />
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {showIdentitySummary && (
                <>
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
                  {/* Handle sits with the identity fields here so its edit
                      position matches where it reads in view mode (just under
                      the name), not buried among contact fields. */}
                  <FieldInput
                    name="handle"
                    label="Handle (for @mentions)"
                    defaultValue={member.handle ?? ""}
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
                </>
              )}
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
                name="netId"
                label="NetID"
                defaultValue={member.netId ?? ""}
              />
              <FieldInput
                name="personalEmail"
                label="Personal email"
                type="email"
                defaultValue={member.personalEmail ?? ""}
              />
              <TimeZoneField
                name="timeZone"
                label="Time zone"
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
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              {showIdentitySummary && (
                <>
                  <Detail label="Pronouns" value={member.pronouns} />
                  <Detail
                    label="Handle"
                    value={member.handle ? `@${member.handle}` : null}
                  />
                  <Detail label="Major" value={member.major} />
                  <Detail
                    label="Class year"
                    value={member.classYear?.toString() ?? null}
                  />
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground mb-1">Roles</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {!roleLabels || roleLabels.length === 0 ? (
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
                </>
              )}
              <Detail label="Hometown" value={member.hometown} />
              <Detail
                label="Birthday"
                value={formatBirthday(member.birthday)}
              />
              <Detail label="Phone" value={member.phoneNumber} />
              <Detail label="NetID" value={member.netId} />
              <Detail label="Personal email" value={member.personalEmail} />
              <Detail
                label="Time zone"
                value={member.timeZone ? formatZoneLabel(member.timeZone) : null}
              />
              <div>
                <dt className="text-xs text-muted-foreground mb-1">GitHub</dt>
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
                <dt className="text-xs text-muted-foreground mb-1">LinkedIn</dt>
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
                <dt className="text-xs text-muted-foreground mb-1">
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
                <dt className="text-xs text-muted-foreground mb-1">
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
  embedded,
}: {
  isSelf: boolean;
  termCode: string | null;
  projectAssignments: ProfilePageData["projectAssignments"];
  pendingReviews: number;
  showReviewsRow: boolean;
  embedded?: boolean;
}) {
  return (
    <div
      className={
        embedded
          ? "flex flex-col gap-3"
          : "bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
      }
    >
      {!embedded && (
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <FolderKanban className="w-4 h-4 text-accent-coral" />
          {isSelf ? "My activity" : "Activity"}
          {termCode && (
            <span className="text-xs font-normal text-muted-foreground">
              · {termCode}
            </span>
          )}
        </h2>
      )}

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
    </div>
  );
}

// ─── Education (self + Core viewers only — loader sends null otherwise) ─────

function EducationSection({
  education,
  embedded,
}: {
  education: NonNullable<ProfilePageData["education"]>;
  embedded?: boolean;
}) {
  if (
    education.attended.length === 0 &&
    education.taught.length === 0 &&
    education.ceCredits.length === 0
  ) {
    return null;
  }
  return (
    <div
      className={
        embedded
          ? "flex flex-col gap-3"
          : "bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
      }
    >
      {!embedded && (
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <GraduationCap className="w-4 h-4 text-accent-coral" />
          Education
        </h2>
      )}

      {education.taught.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Taught
          </h3>
          <ul className="flex flex-col gap-1.5">
            {education.taught.map((t) => (
              <li key={`${t.offeringId}-${t.termCode}`}>
                <Link
                  to={`/education/${t.offeringId}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors"
                >
                  <span className="text-sm font-medium text-foreground truncate">
                    {t.title}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {t.type} · {t.termCode}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {education.ceCredits.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            CE credits
          </h3>
          {education.ceCredits.map((c) => (
            <span
              key={c.termCode}
              className="inline-flex items-center rounded-full bg-accent-teal/10 text-accent-teal px-2 py-0.5 text-[11px] font-semibold"
            >
              {c.termCode}: {c.count}
            </span>
          ))}
        </div>
      )}

      {education.attended.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Attended
          </h3>
          <ul className="flex flex-col gap-1.5">
            {education.attended.map((e) => (
              <li
                key={e.offeringId}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border"
              >
                <span className="text-sm font-medium text-foreground truncate">
                  {e.title}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {e.status === "Approved" && e.attendance.total > 0
                    ? `${e.attendance.present}/${e.attendance.total} sessions`
                    : e.status}
                  {e.certificateIssuedAt ? " · Certificate" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Domains & levels (identical to the previous member view) ───────────────

function DomainsSection({
  eligibilities,
  allDomains,
  canManage,
  allowedLevels,
  embedded,
}: {
  eligibilities: ProfileMember["domainEligibilities"];
  allDomains: Array<{ id: string; displayName: string }>;
  canManage: boolean;
  allowedLevels: readonly Level[];
  embedded?: boolean;
}) {
  const assignedDomainIds = new Set(eligibilities.map((e) => e.domain.id));
  const available = allDomains.filter((d) => !assignedDomainIds.has(d.id));

  return (
    <div
      className={
        embedded
          ? "flex flex-col gap-3"
          : "bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
      }
    >
      {!embedded && (
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
      )}
      {embedded && !canManage && (
        <p className="text-[11px] text-muted-foreground/70">
          Only Core or Admin can edit.
        </p>
      )}
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
    </div>
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
        className={buttonClasses("primary", "sm")}
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

// Account's own editable fields, always: name + pronouns. Major/class year
// join this set only when Account also renders the major/classYear inputs
// (showIdentitySummary) — on /settings, where there's no Personal section to
// host them instead. See ACCOUNT_FIELDS below.
const ACCOUNT_FIELDS_BASE = new Set<keyof ProfileMember>([
  "firstName",
  "lastName",
  "pronouns",
]);

const ACCOUNT_FIELDS = new Set<keyof ProfileMember>([
  ...ACCOUNT_FIELDS_BASE,
  "major",
  "classYear",
]);

const PERSONAL_FIELDS = new Set<keyof ProfileMember>([
  "hometown",
  "birthday",
  "phoneNumber",
  "netId",
  "personalEmail",
  "timeZone",
  "githubUsername",
  "linkedinUrl",
  "personalSite",
  "dietaryRestrictions",
]);

// Personal's fields when it also hosts name/pronouns + major/class year (the
// member/profile view, which has no separate Account card — see
// MemberProfileView's page layout comment).
const PERSONAL_FIELDS_WITH_IDENTITY = new Set<keyof ProfileMember>([
  ...PERSONAL_FIELDS,
  ...ACCOUNT_FIELDS_BASE,
  "handle",
  "major",
  "classYear",
]);

// Shared by Account and Personal's read-only "Emails" summary — every linked
// address, regardless of which one is primary.
function memberEmails(member: ProfileMember): string[] {
  return [member.daliEmail, member.dartmouthEmail, member.personalEmail].filter(
    (e): e is string => Boolean(e),
  );
}

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
  if (!skip.has("netId"))
    entries.push(["netId", member.netId ?? ""]);
  if (!skip.has("personalEmail"))
    entries.push(["personalEmail", member.personalEmail ?? ""]);
  if (!skip.has("timeZone")) entries.push(["timeZone", member.timeZone ?? ""]);
  if (!skip.has("handle")) entries.push(["handle", member.handle ?? ""]);
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

// Full IANA zone list from the runtime's ICU data — identical in Node (SSR) and
// the browser, so the rendered <option> set is stable across hydration. Falls
// back to the app zone if the runtime predates Intl.supportedValuesOf.
function timeZoneOptions(): string[] {
  const supportedValuesOf = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  try {
    const zones = supportedValuesOf?.("timeZone");
    if (zones && zones.length) return zones;
  } catch {
    // fall through to the single-zone fallback
  }
  return [APPLICATION_TZ];
}

function TimeZoneField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  const zones = timeZoneOptions();
  // A stored value outside the canonical list (legacy/rare) still shows selected.
  const options =
    defaultValue && !zones.includes(defaultValue) ? [defaultValue, ...zones] : zones;
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
      >
        <option value="">Not set</option>
        {options.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground mb-1">{label}</dt>
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

// Mentorship pairings + notes link for a viewed-other user. The loader gates
// `mentorshipPanel` so this only renders when the viewer is a lab mentor or
// Core looking at someone else's profile, never on their own.
function MentorshipPanel({
  data,
  memberId,
}: {
  data: NonNullable<ProfilePageData["mentorshipPanel"]>;
  memberId: string;
}) {
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-semibold text-foreground">
          Mentorship
        </h2>
        {data.recentNoteCount > 0 && (
          <Link
            to={`/mentorship/browse?menteeId=${memberId}`}
            className="text-sm text-accent-coral hover:underline"
          >
            View notes ({data.recentNoteCount})
          </Link>
        )}
      </div>
      {data.pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No mentorship pairings on record.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.pairs.map((p) => (
            <li key={p.id} className="py-2 text-sm flex flex-col">
              <span className="font-medium text-foreground">
                {p.role === "mentor"
                  ? `Mentoring ${p.counterpart.firstName} ${p.counterpart.lastName}`
                  : `Mentee of ${p.counterpart.firstName} ${p.counterpart.lastName}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {p.projectName} · {p.domainCode} · {p.termCode}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
