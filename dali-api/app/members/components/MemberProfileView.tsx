import { useEffect, useRef, useState, type ReactNode } from "react";
import { useOpenBeside } from "~/components/side-panel/use-side-panel";
import {
  Form,
  Link,
  useFetcher,
  useLocation,
  useRevalidator,
  useSearchParams,
  useSubmit,
} from "react-router";
import { Select, Tooltip, InfoTip } from "~/components/ui/floating";
import {
  AtSign,
  Briefcase,
  Cake,
  Clock,
  FileText,
  Fingerprint,
  Github,
  Globe,
  GraduationCap,
  Layers,
  Linkedin,
  Lock,
  Mail,
  MapPin,
  MapPinned,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Shield,
  Smartphone,
  Trash2,
  Upload,
  User as UserIcon,
  UsersRound,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import { ProjectIcon } from "~/components/ProjectIcon";
import { ProfilePhotoAvatar } from "~/components/ProfilePhotoAvatar";
import { Avatar } from "~/components/ui/Avatar";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import {
  DetailEditRow,
  DetailRow,
  OS_DETAIL_ICON,
  OsTabBar,
} from "~/components/os-page";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { PersonalNotesRail } from "./PersonalNotesRail";
import { ProfileRequestButtons } from "./ProfileRequestButtons";
import { AchievementsBlock } from "./AchievementsBlock";
import { ComplianceBlock } from "./ComplianceBlock";
import { buttonClasses } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { useConfirmSubmit, useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Modal, ModalHeader } from "~/components/Modal";
import { ImportWorkHistoryModal } from "./ImportWorkHistoryModal";
import { WorkExperienceFields, type WorkExperienceFieldValues } from "./WorkExperienceFields";
import { modalCardClass } from "~/components/os-chrome";
import {
  formatMonthRange,
  workModeLabel,
  type WorkExperienceItem,
} from "~/members/lib/work-experience";
import type { Level } from "~/admin/lib/eligibility";
import { APPLICATION_TZ, formatZoneLabel } from "~/lib/timezone";
import type {
  ProfileMember,
  ProfilePageData,
  ProfileProjectAssignment,
} from "~/members/lib/profile-page.server";
import { useAvatarStatus } from "~/components/presence/PresenceStatusProvider";
import { formatLastActive } from "~/lib/presence";
import { isNewMember, isBirthdayToday } from "~/members/lib/warmth";
import { NewBadge, BirthdayBadge } from "~/members/components/WarmthBadges";
import { attendanceCopy } from "~/education/lib/session-time";
import { WarningCaseSection } from "~/mentorship/components/WarningCaseSection";
import { WarningDot } from "~/mentorship/components/WarnedAvatar";

// A member reads as a project does: the same hero (the photo as this page's
// icon, the name at 32px, its labelled clusters to the right), the same tab
// strip, and the same sections — a title on the page ground with its content on
// one card under it. See app/components/os-page.tsx for the shared parts.

const TABS = ["profile", "activity", "mentorship"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  profile: "Profile",
  activity: "Activity",
  mentorship: "Mentorship",
};

function isTab(x: string | null): x is Tab {
  return (TABS as readonly string[]).includes(x ?? "");
}

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
    isStaff,
    isAlumni,
    projectHistory,
    pendingReviews,
    showReviewsRow,
    isSelf,
    resume,
    coffeeChatSent,
    resumeReviewSent,
    openTo,
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
    notes,
    sharedWithMe,
    favoriteIds,
    achievements,
    compliance,
    wallet,
    canRevokeWalletPass,
    groups,
    canSeeGroups,
  } = data;

  const hasEducation =
    !!data.education &&
    (data.education.attended.length > 0 ||
      data.education.taught.length > 0 ||
      data.education.ceCredits.length > 0);

  // Tabs live in the URL (?tab=) like the project page's, so a tab is a link
  // worth sending and switching one keeps your place on the page.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const wantTab = isTab(tabParam) ? tabParam : "profile";
  const tab: Tab =
    wantTab === "mentorship" && !mentorshipPanel ? "profile" : wantTab;
  const setTab = (next: Tab) => {
    if (next === tab) return;
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  // The project hub deep-links to a member's assignments (#project-assignments)
  // to change a level, and those now live under Activity. Done in an effect
  // rather than in the tab resolution above because the server never sees a
  // hash — reading it during render would mismatch on hydration.
  const location = useLocation();
  useEffect(() => {
    if (location.hash === "#project-assignments") setTab("activity");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash]);

  const openBeside = useOpenBeside();
  function openNote(note: { id: string; title: string }) {
    openBeside({ href: `/documents/${note.id}` });
  }

  // Live "last active" for this member's header (respects their hide-activity
  // setting server-side). A snapshot of `now` per render is fine — the poll
  // refreshes the status, not the clock.
  const presence = useAvatarStatus(member.id);
  const presenceLabel =
    presence?.state === "active"
      ? "Active now"
      : presence?.lastActiveAt
        ? formatLastActive(new Date(presence.lastActiveAt), new Date())
        : null;
  const showNewBadge =
    !isAlumni &&
    isNewMember(
      {
        onboardedAt: member.onboardedAt ? new Date(member.onboardedAt) : null,
        createdAt: new Date(member.createdAt),
      },
      new Date(),
    );
  const [editingAbout, setEditingAbout] = useState(false);
  const hasOpenWarning = data.warningCase?.warnings.some((w) => w.status === "open") ?? false;
  const showBirthday =
    !!member.birthday && isBirthdayToday(new Date(member.birthday), new Date());

  const page = (
    <div className="flex flex-col gap-6">
      <PresenceBar className="self-end" />

      <MemberHeader
        member={member}
        photoUrlResolved={photoUrlResolved}
        canEdit={canEdit}
        isSelf={isSelf}
        coffeeChatSent={coffeeChatSent}
        resumeReviewSent={resumeReviewSent}
        openTo={openTo}
        isStaff={isStaff}
        isAlumni={isAlumni}
        presenceState={presence?.state ?? null}
        presenceLabel={presenceLabel}
        showNewBadge={showNewBadge}
        showBirthday={showBirthday}
        onEditAbout={canEdit ? () => setEditingAbout(true) : undefined}
      />

      {editingAbout && <AboutEditor member={member} onClose={() => setEditingAbout(false)} />}

      <OsTabBar
        ariaLabel="Profile sections"
        tabs={TABS.filter((t) => t !== "mentorship" || mentorshipPanel).map(
          (t) => ({
            key: t,
            label: TAB_LABELS[t],
            badge: t === "activity" && hasOpenWarning ? <WarningDot /> : undefined,
          }),
        )}
        active={tab}
        onSelect={setTab}
      />

      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      {/* One well for every tab, with a floor under it so a short tab doesn't
          collapse the page under your scroll offset — same as the project
          page's tab body. */}
      <div className="flex flex-col gap-6 min-h-[25vh]">
        {tab === "profile" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DomainsCard
              roleLabels={roleLabels}
              eligibilities={member.domainEligibilities}
              allDomains={allDomains}
              canManage={canManageEligibility}
              allowedLevels={allowedLevels}
            />
            {canSeeGroups && <GroupsCard groups={groups} />}
            {!isSelf && canRevokeWalletPass && (
              <WalletCard
                wallet={wallet}
                isSelf={isSelf}
                canRevoke={canRevokeWalletPass}
              />
            )}
            <WorkExperienceCard
              memberId={member.id}
              experiences={member.workExperiences}
              canEdit={canEdit}
              isSelf={isSelf}
              resume={resume}
            />
          </div>
        )}

        {tab === "activity" && (
          <>
            {data.warningCase && (
              <WarningCaseSection warnings={data.warningCase.warnings} people={data.warningCase.people} />
            )}

            <AchievementsBlock achievements={achievements} />

            <ActivitySection
              isSelf={isSelf}
              projectHistory={projectHistory}
              pendingReviews={pendingReviews}
              showReviewsRow={showReviewsRow}
              canEditLevel={canManageEligibility}
            />

            {hasEducation && data.education && (
              <EducationSection education={data.education} />
            )}

            <ComplianceBlock compliance={compliance} isSelf={isSelf} />
          </>
        )}

        {tab === "mentorship" && mentorshipPanel && (
          <MentorshipPanel data={mentorshipPanel} memberId={member.id} />
        )}
      </div>
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

// ─── Hero ───────────────────────────────────────────────────────────────────

const HERO_PILL =
  "inline-flex items-center rounded-full px-3 py-[5px] text-[13px] font-semibold";

function MemberHeader({
  member,
  photoUrlResolved,
  canEdit,
  isSelf,
  coffeeChatSent,
  resumeReviewSent,
  openTo,
  isStaff,
  isAlumni,
  presenceState,
  presenceLabel,
  showNewBadge,
  showBirthday,
  onEditAbout,
}: {
  member: ProfileMember;
  photoUrlResolved: string | null;
  canEdit: boolean;
  isSelf: boolean;
  coffeeChatSent: boolean;
  resumeReviewSent: boolean;
  openTo: ProfilePageData["openTo"];
  isStaff: boolean;
  isAlumni: boolean;
  presenceState: string | null;
  presenceLabel: string | null;
  showNewBadge: boolean;
  showBirthday: boolean;
  onEditAbout?: () => void;
}) {
  const details = aboutDetails(member);
  return (
    <header className="flex items-center gap-7">
      <ProfilePhotoAvatar
        userId={member.id}
        name={`${member.firstName} ${member.lastName}`}
        initialPreviewUrl={photoUrlResolved}
        canEdit={canEdit}
        size="lg"
      />

      <div className="min-w-0 flex flex-col gap-3 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-[32px] font-medium text-foreground leading-none">
                {member.firstName} {member.lastName}
              </h1>
              {showNewBadge && <NewBadge />}
              {showBirthday && <BirthdayBadge />}
            </div>
            {details.length > 0 && (
              <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-os-grey">
                {details.map((d) => (
                  <div key={`${d.label}-${d.value}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                    <dt className="sr-only">{d.label}</dt>
                    {d.icon && <span aria-hidden>{d.icon}</span>}
                    <dd className="min-w-0 break-all text-foreground">
                      {"href" in d && d.href ? (
                        <a href={d.href} target="_blank" rel="noreferrer" className="text-os-accent hover:underline">
                          {d.value}
                        </a>
                      ) : (
                        d.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {onEditAbout && (
            <button
              type="button"
              onClick={onEditAbout}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-os-container px-3 py-1 text-[12px] font-semibold text-os-grey transition-colors hover:border-os-container-hi hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
        </div>

        {(isStaff || isAlumni || member.gradProgram || presenceLabel || openTo.coffeeChats || openTo.resumeReviews) && (
          <div className="flex flex-wrap items-center gap-2">
            <ProfileRequestButtons
              isSelf={isSelf}
              openTo={openTo}
              firstName={member.firstName}
              coffeeChatSent={coffeeChatSent}
              resumeReviewSent={resumeReviewSent}
            />
            {isStaff && (
              <span className={cn(HERO_PILL, "bg-os-accent/15 text-os-accent")}>
                Staff
              </span>
            )}
            {isAlumni && (
              <span className={cn(HERO_PILL, "bg-os-container text-os-grey")}>
                Alumni
              </span>
            )}
            {member.gradProgram && (
              <span className={cn(HERO_PILL, "bg-os-container text-foreground")}>
                {member.gradProgram}
              </span>
            )}
            {presenceLabel && (
              <p className="flex items-center gap-1.5 text-xs text-os-grey">
                <Tooltip
                  content={
                    presenceState === "active"
                      ? "Active now — seen within the last minute."
                      : "Recently active — last seen more than a minute ago."
                  }
                  variant="rich"
                >
                  <span
                    aria-hidden
                    className={`w-1.5 h-1.5 rounded-full ${
                      presenceState === "active"
                        ? "bg-os-green"
                        : "border border-os-amber bg-background"
                    }`}
                  />
                </Tooltip>
                {presenceLabel}
              </p>
            )}
          </div>
        )}

      </div>
    </header>
  );
}

// ─── Profile card helpers ────────────────────────────────────────────────────

/** Shared colored-icon header for each profile grid card. */
function CardHeader({
  icon,
  iconBg,
  iconColor,
  title,
  trailing,
}: {
  icon: ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-5 pt-4 pb-3">
      <span
        className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center shrink-0"
        style={{ background: iconBg, color: iconColor }}
      >
        {icon}
      </span>
      <h3 className="text-[15px] font-bold text-foreground flex-1">{title}</h3>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}

/** Inline edit / cancel+save controls for a profile card header. */
function CardEditControls({
  editing,
  onEdit,
  onCancel,
  onSave,
  busy,
}: {
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  busy?: boolean;
}) {
  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] font-semibold text-os-grey hover:text-foreground px-2.5 py-1 rounded-full hover:bg-os-container transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="text-[12px] font-semibold bg-os-accent text-os-bg px-3 py-1 rounded-full hover:bg-os-accent-hover transition-colors disabled:opacity-50"
        >
          Save
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      className="inline-flex items-center gap-1 text-[12px] font-semibold text-os-grey hover:text-foreground border border-os-container hover:border-os-container-hi px-2.5 py-1 rounded-full transition-colors"
    >
      <Pencil className="w-3 h-3" />
      Edit
    </button>
  );
}

// Hidden inputs for all personal text fields NOT owned by the current card.
// Required so the `profile` action doesn't clear fields it doesn't receive.
function PersonalHiddenFields({
  member,
  exclude,
}: {
  member: ProfileMember;
  exclude: ReadonlySet<string>;
}) {
  const fields: Array<[string, string]> = [
    ["firstName", member.firstName],
    ["lastName", member.lastName],
    ["pronouns", member.pronouns ?? ""],
    ["major", member.major ?? ""],
    ["classYear", member.classYear?.toString() ?? ""],
    ["hometown", member.hometown ?? ""],
    ["currentLocation", member.currentLocation ?? ""],
    ["birthday", birthdayInputValue(member.birthday)],
    ["dietaryRestrictions", member.dietaryRestrictions ?? ""],
    ["phoneNumber", member.phoneNumber ?? ""],
    ["personalEmail", member.personalEmail ?? ""],
    ["githubUsername", member.githubUsername ?? ""],
    ["linkedinUrl", member.linkedinUrl ?? ""],
    ["personalSite", member.personalSite ?? ""],
    ["timeZone", member.timeZone ?? ""],
    ["netId", member.netId ?? ""],
    ["handle", member.handle ?? ""],
  ];
  return (
    <>
      {fields
        .filter(([name]) => !exclude.has(name))
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
    </>
  );
}

// ─── About card ─────────────────────────────────────────────────────────────

const ABOUT_FIELDS = new Set([
  "pronouns",
  "handle",
  "netId",
  "major",
  "classYear",
  "hometown",
  "currentLocation",
  "birthday",
  "dietaryRestrictions",
]);

function aboutDetails(member: ProfileMember) {
  const ic = "h-3.5 w-3.5";
  return [
    { label: "Handle", icon: null, value: member.handle ? `@${member.handle}` : null },
    { label: "Pronouns", icon: <UserIcon className={ic} />, value: member.pronouns },
    { label: "NetID", icon: <Fingerprint className={ic} />, value: member.netId },
    { label: "Major", icon: <GraduationCap className={ic} />, value: member.major },
    { label: "Class year", icon: <GraduationCap className={ic} />, value: member.classYear ? `Class of ${member.classYear}` : null },
    { label: "Hometown", icon: <MapPin className={ic} />, value: member.hometown },
    { label: "Based in", icon: <MapPinned className={ic} />, value: member.currentLocation },
    { label: "Birthday", icon: <Cake className={ic} />, value: formatBirthday(member.birthday) },
    { label: "Dietary", icon: <Utensils className={ic} />, value: member.dietaryRestrictions },
    ...memberEmails(member).map((e) => ({ label: "Email", icon: <Mail className={ic} />, value: e })),
    { label: "Phone", icon: <Phone className={ic} />, value: member.phoneNumber },
    { label: "Personal site", icon: <Globe className={ic} />, value: member.personalSite ? member.personalSite.replace(/^https?:\/\//, "").replace(/\/$/, "") : null, href: member.personalSite },
    { label: "GitHub", icon: <Github className={ic} />, value: member.githubUsername, href: member.githubUsername ? `https://github.com/${member.githubUsername}` : null },
    { label: "LinkedIn", icon: <Linkedin className={ic} />, value: member.linkedinUrl ? member.linkedinUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : null, href: member.linkedinUrl },
    { label: "Time zone", icon: <Clock className={ic} />, value: member.timeZone ? formatZoneLabel(member.timeZone) : null },
  ].filter((r): r is typeof r & { value: string; href?: string | null } => Boolean(r.value));
}

function AboutEditor({ member, onClose }: { member: ProfileMember; onClose: () => void }) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const { formClass } = useOsChrome();
  const ic = OS_DETAIL_ICON;

  function save() {
    if (formRef.current) submit(formRef.current);
    onClose();
  }

  return (
    <Form method="post" ref={formRef}>
      <input type="hidden" name="intent" value="profile" />
      <PersonalHiddenFields member={member} exclude={EDITOR_FIELDS} />
      <article className="rounded-os-card bg-os-card overflow-hidden">
        <CardHeader
          icon={<UserIcon className="w-[17px] h-[17px]" />}
          iconBg="rgba(185,162,242,0.14)"
          iconColor="#b9a2f2"
          title="Edit profile"
          trailing={<CardEditControls editing onEdit={() => {}} onCancel={onClose} onSave={save} />}
        />
        <div className={cn("px-5 pb-5", formClass, "grid grid-cols-[max-content_1fr]")}>
              <DetailEditRow icon={<UserIcon className={ic} />} label="Pronouns">
                <input
                  name="pronouns"
                  type="text"
                  defaultValue={member.pronouns ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow
                icon={<AtSign className={ic} />}
                label="Handle"
                infoTip={<InfoTip content="How people @mention you" />}
              >
                <input
                  name="handle"
                  type="text"
                  defaultValue={member.handle ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow icon={<Fingerprint className={ic} />} label="NetID">
                <input
                  name="netId"
                  type="text"
                  defaultValue={member.netId ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow icon={<GraduationCap className={ic} />} label="Major">
                <input
                  name="major"
                  type="text"
                  defaultValue={member.major ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow
                icon={<GraduationCap className={ic} />}
                label="Class year"
              >
                <input
                  name="classYear"
                  type="number"
                  defaultValue={member.classYear?.toString() ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow icon={<MapPin className={ic} />} label="Hometown">
                <input
                  name="hometown"
                  type="text"
                  defaultValue={member.hometown ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow icon={<MapPinned className={ic} />} label="Based in">
                <input
                  name="currentLocation"
                  type="text"
                  placeholder="City, country"
                  defaultValue={member.currentLocation ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow icon={<Cake className={ic} />} label="Birthday">
                <DateField
                  mode="date"
                  name="birthday"
                  defaultValue={birthdayInputValue(member.birthday)}
                  ariaLabel="Birthday"
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow
                icon={<Utensils className={ic} />}
                label="Dietary restrictions"
              >
                <textarea
                  name="dietaryRestrictions"
                  rows={2}
                  defaultValue={member.dietaryRestrictions ?? ""}
                  className="w-full resize-y"
                />
              </DetailEditRow>
              <DetailEditRow
                icon={<Mail className={ic} />}
                label="Email"
                infoTip={<InfoTip content="DALI and Dartmouth emails are managed by your institution." />}
              >
                <EmailListEdit
                  daliEmail={member.daliEmail}
                  dartmouthEmail={member.dartmouthEmail}
                  personalEmail={member.personalEmail}
                />
              </DetailEditRow>
              <DetailEditRow icon={<Phone className={ic} />} label="Phone">
                <input
                  name="phoneNumber"
                  type="text"
                  inputMode="tel"
                  defaultValue={member.phoneNumber ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow
                icon={<Globe className={ic} />}
                label="Personal site"
              >
                <input
                  name="personalSite"
                  type="url"
                  defaultValue={member.personalSite ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow icon={<Clock className={ic} />} label="Time zone">
                <TimeZoneField
                  name="timeZone"
                  defaultValue={member.timeZone ?? ""}
                />
              </DetailEditRow>
              <DetailEditRow
                icon={<Github className={ic} />}
                label="GitHub username"
              >
                <input
                  name="githubUsername"
                  type="text"
                  defaultValue={member.githubUsername ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
              <DetailEditRow
                icon={<Linkedin className={ic} />}
                label="LinkedIn URL"
              >
                <input
                  name="linkedinUrl"
                  type="url"
                  defaultValue={member.linkedinUrl ?? ""}
                  className="w-full"
                />
              </DetailEditRow>
        </div>
      </article>
    </Form>
  );
}

// ─── Contact card ────────────────────────────────────────────────────────────

const CONTACT_FIELDS = new Set([
  "phoneNumber",
  "personalEmail",
  "githubUsername",
  "linkedinUrl",
  "personalSite",
  "timeZone",
]);

const EDITOR_FIELDS = new Set([...ABOUT_FIELDS, ...CONTACT_FIELDS]);

// ─── Domains card ────────────────────────────────────────────────────────────

function DomainsCard({
  roleLabels = [],
  eligibilities,
  allDomains,
  canManage,
  allowedLevels,
}: {
  roleLabels?: string[];
  eligibilities: ProfileMember["domainEligibilities"];
  allDomains: Array<{ id: string; displayName: string }>;
  canManage: boolean;
  allowedLevels: readonly Level[];
}) {
  const assignedDomainIds = new Set(eligibilities.map((e) => e.domain.id));
  const available = allDomains.filter((d) => !assignedDomainIds.has(d.id));

  return (
    <article className="rounded-os-card bg-os-card overflow-hidden h-full">
      <CardHeader
        icon={<Layers className="w-[17px] h-[17px]" />}
        iconBg="rgba(245,154,184,0.14)"
        iconColor="#f59ab8"
        title="Roles, domains & levels"
        trailing={
          !canManage ? (
            <span className="text-[11px] text-os-muted">Core or Admin only</span>
          ) : undefined
        }
      />
      <div className="px-5 pb-5 flex flex-col gap-2">
        {roleLabels.map((r) => (
          <div key={r} className={LIST_ROW}>
            <span className="text-sm font-medium text-foreground">{r}</span>
          </div>
        ))}
        {eligibilities.length === 0 && !canManage && (
          <p className="text-sm text-os-muted italic">
            No domain eligibilities yet.
          </p>
        )}
        {eligibilities.map((e) => (
          <EligibilityRow
            key={e.id}
            eligibility={e}
            canManage={canManage}
            allowedLevels={allowedLevels}
          />
        ))}
        {canManage && available.length > 0 && (
          <AddEligibility domains={available} allowedLevels={allowedLevels} />
        )}
        {canManage &&
          available.length === 0 &&
          eligibilities.length === allDomains.length && (
            <p className="text-xs text-os-muted">
              All active domains are assigned.
            </p>
          )}
      </div>
    </article>
  );
}

// ─── Work experience card ────────────────────────────────────────────────────

function WorkExperienceCard({
  memberId,
  experiences,
  canEdit,
  isSelf,
  resume,
}: {
  memberId: string;
  experiences: WorkExperienceItem[];
  canEdit: boolean;
  isSelf: boolean;
  resume: ProfilePageData["resume"];
}) {
  // null = closed, "new" = adding, an item = editing it.
  const [editing, setEditing] = useState<WorkExperienceItem | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const importEnabled = useFeatureFlag("work-history-import");
  const remove = useFetcher();
  const { confirm } = useDialog();

  async function onDelete(w: WorkExperienceItem) {
    const ok = await confirm({
      title: "Remove this job?",
      description: `${w.position} at ${w.company}`,
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (ok) remove.submit({ intent: "delete-experience", experienceId: w.id }, { method: "post" });
  }

  return (
    <article className="rounded-os-card bg-os-card overflow-hidden sm:col-span-2">
      <CardHeader
        icon={<Briefcase className="w-[17px] h-[17px]" />}
        iconBg="rgba(122,184,245,0.14)"
        iconColor="#7ab8f5"
        title="Work experience"
        trailing={
          canEdit && (
            <div className="flex items-center gap-1.5">
              {importEnabled && isSelf && (
                <button type="button" onClick={() => setImporting(true)} className={CARD_PILL_CLASS}>
                  <Upload className="w-3 h-3" />
                  Import
                </button>
              )}
              <button type="button" onClick={() => setEditing("new")} className={CARD_PILL_CLASS}>
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>
          )
        }
      />
      {importEnabled && resume && (
        <ResumeLine memberId={memberId} resume={resume} isSelf={isSelf} />
      )}
      <div className="px-5 pb-5">
        {experiences.length === 0 ? (
          <p className="text-sm text-os-muted italic">No work experience yet.</p>
        ) : (
          experiences.map((w) => (
            <div
              key={w.id}
              className="flex items-start gap-4 border-b border-os-container py-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{w.position}</p>
                <p className="text-sm text-foreground">{w.company}</p>
                <p className="mt-0.5 text-[13px] text-os-grey">
                  {[formatMonthRange(w.startMonth, w.endMonth), w.location, workModeLabel(w.workMode)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {w.description && (
                  <p className="mt-1.5 whitespace-pre-line text-sm text-foreground">{w.description}</p>
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center">
                  <IconButton label="Edit" icon={Pencil} onClick={() => setEditing(w)} />
                  <IconButton
                    label="Remove"
                    icon={Trash2}
                    tone="destructive"
                    onClick={() => void onDelete(w)}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {editing && (
        <WorkExperienceModal
          experience={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <ImportWorkHistoryModal
          memberId={memberId}
          existing={experiences}
          onClose={() => setImporting(false)}
        />
      )}
    </article>
  );
}

const CARD_PILL_CLASS =
  "inline-flex items-center gap-1 text-[12px] font-semibold text-os-grey hover:text-foreground border border-os-container hover:border-os-container-hi px-2.5 py-1 rounded-full transition-colors";

const RESUME_ACTION_CLASS = "font-semibold text-os-grey hover:text-foreground transition-colors";

function ResumeLine({
  memberId,
  resume,
  isSelf,
}: {
  memberId: string;
  resume: NonNullable<ProfilePageData["resume"]>;
  isSelf: boolean;
}) {
  const revalidator = useRevalidator();
  const { confirm } = useDialog();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/members/${memberId}/resume`;

  async function send(init: RequestInit): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(endpoint, init);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "Something went wrong. Try again.");
        return;
      }
      void revalidator.revalidate();
    } finally {
      setBusy(false);
    }
  }

  function replace(file: File | undefined) {
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    void send({ method: "POST", body });
  }

  async function remove() {
    const ok = await confirm({
      title: "Remove your resume?",
      description: resume.fileName,
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (ok) void send({ method: "DELETE" });
  }

  return (
    <div className="flex items-center gap-2 px-5 pb-3 text-[13px] text-os-grey">
      <FileText className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate text-foreground">{resume.fileName}</span>
      <span className="shrink-0">Uploaded {formatUploadedAt(resume.uploadedAt)}</span>
      <a href={endpoint} target="_blank" rel="noreferrer" className={RESUME_ACTION_CLASS}>
        View
      </a>
      {isSelf && (
        <>
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={RESUME_ACTION_CLASS}>
            Replace
          </button>
          <button type="button" disabled={busy} onClick={() => void remove()} className={RESUME_ACTION_CLASS}>
            Remove
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            aria-label="Replace resume"
            className="sr-only"
            onChange={(e) => {
              replace(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}

function formatUploadedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function WorkExperienceModal({
  experience,
  onClose,
}: {
  experience: WorkExperienceItem | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ error?: string } | null>();
  const { formClass } = useOsChrome();
  const [values, setValues] = useState<WorkExperienceFieldValues>({
    company: experience?.company ?? "",
    position: experience?.position ?? "",
    description: experience?.description ?? "",
    location: experience?.location ?? "",
    workMode: experience?.workMode ?? "",
    startMonth: experience?.startMonth ?? "",
    endMonth: experience?.endMonth ?? "",
    current: experience ? experience.endMonth === null : false,
  });
  const busy = fetcher.state !== "idle";

  // The action answers null on success and { error } otherwise.
  const submitted = useRef(false);
  useEffect(() => {
    if (fetcher.state !== "idle") {
      submitted.current = true;
    } else if (submitted.current) {
      submitted.current = false;
      if (!fetcher.data?.error) onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="work-experience-title"
      disableEscape={busy}
      containerClassName={modalCardClass("max-w-lg")}
    >
      <ModalHeader
        titleId="work-experience-title"
        title={experience ? "Edit job" : "Add job"}
        onClose={onClose}
      />
      <fetcher.Form method="post" className={cn("flex flex-col gap-4", formClass)}>
        <input type="hidden" name="intent" value="save-experience" />
        {experience && <input type="hidden" name="experienceId" value={experience.id} />}
        {fetcher.data?.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {fetcher.data.error}
          </p>
        )}

        <WorkExperienceFields
          value={values}
          onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}

// ─── Groups card ─────────────────────────────────────────────────────────────

function GroupsCard({
  groups,
}: {
  groups: ProfilePageData["groups"];
}) {
  return (
    <article className="rounded-os-card bg-os-card overflow-hidden h-full">
      <CardHeader
        icon={<UsersRound className="w-[17px] h-[17px]" />}
        iconBg="rgba(242,184,75,0.14)"
        iconColor="#f2b84b"
        title="Groups"
      />
      <div className="px-5 pb-5 flex flex-col gap-2">
        {groups.length === 0 ? (
          <p className="text-sm text-os-muted italic">
            Not in any custom groups.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <Link
                key={g.id}
                to="/members/groups"
                className="inline-flex items-center gap-1.5 rounded-full bg-os-container px-3 py-[5px] text-[13px] font-semibold text-foreground hover:bg-os-container-hi transition-colors"
              >
                {g.name}
                {g.kind === "lab" && (
                  <span className="rounded-full border border-os-accent/35 px-2.5 py-0.5 text-xs text-os-accent font-medium uppercase tracking-wide">
                    Auto
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Wallet card ─────────────────────────────────────────────────────────────

function WalletCard({
  wallet,
  isSelf,
  canRevoke,
}: {
  wallet: { apple: boolean; google: boolean } | null;
  isSelf: boolean;
  canRevoke: boolean;
}) {
  const revokeFetcher = useFetcher<{ error?: string } | null>();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const confirmSubmit = useConfirmSubmit();
  const revoking = revokeFetcher.state !== "idle";

  async function addToGoogle() {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      const res = await fetch("/api/wallet/google/save-url", {
        credentials: "include",
      });
      const body = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (res.ok && body?.url) {
        window.open(body.url, "_blank", "noopener");
      } else {
        setGoogleError(body?.error ?? "Couldn't build the Google Wallet link.");
      }
    } catch {
      setGoogleError("Network error — try again.");
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <article className="rounded-os-card bg-os-card overflow-hidden h-full">
      <CardHeader
        icon={<Wallet className="w-[17px] h-[17px]" />}
        iconBg="rgba(168,211,222,0.14)"
        iconColor="#a8d3de"
        title="Membership pass"
      />
      <div className="px-5 pb-5 flex flex-col gap-3">
        <p className="text-sm text-os-grey">
          {isSelf
            ? "Add your DALI pass to your phone's wallet, then show it at a meeting to check in — no sign-in needed."
            : "Reset this member's wallet pass to revoke a lost or shared one — they'll re-add it to get a working pass."}
        </p>

        {wallet && (wallet.apple || wallet.google) && (
          <div className="flex flex-wrap gap-2">
            {wallet.apple && (
              <a
                href="/api/wallet/apple/pass"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-os-item bg-black text-white text-sm font-medium hover:bg-black/85 transition-colors"
              >
                <Wallet className="w-4 h-4" aria-hidden />
                Add to Apple Wallet
              </a>
            )}
            {wallet.google && (
              <button
                type="button"
                onClick={() => void addToGoogle()}
                disabled={googleBusy}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-os-item bg-black text-white text-sm font-medium hover:bg-black/85 transition-colors disabled:opacity-50"
              >
                <Smartphone className="w-4 h-4" aria-hidden />
                {googleBusy ? "Opening…" : "Add to Google Wallet"}
              </button>
            )}
          </div>
        )}
        {wallet && !wallet.apple && !wallet.google && (
          <p className="text-xs text-os-muted">
            Wallet passes aren't configured on this server yet.
          </p>
        )}
        {googleError && (
          <p className="text-xs text-destructive">{googleError}</p>
        )}

        {canRevoke && (
          <div className="pt-3 border-t border-os-container">
            <revokeFetcher.Form
              method="post"
              onSubmit={confirmSubmit(
                isSelf
                  ? {
                      title: "Reset your wallet pass?",
                      description:
                        "Your current pass stops working until you re-add it. Anyone holding a copy of the old one can't check in with it.",
                      confirmLabel: "Reset pass",
                      tone: "destructive",
                    }
                  : {
                      title: "Revoke this member's wallet pass?",
                      description:
                        "Their current pass stops working immediately. They can add a new one from their own settings.",
                      confirmLabel: "Revoke pass",
                      tone: "destructive",
                    },
              )}
            >
              <input type="hidden" name="intent" value="revoke-wallet-pass" />
              <button
                type="submit"
                disabled={revoking}
                className="text-sm text-destructive hover:underline disabled:opacity-50"
              >
                {revoking
                  ? isSelf
                    ? "Resetting…"
                    : "Revoking…"
                  : isSelf
                    ? "Reset my wallet pass"
                    : "Revoke wallet pass"}
              </button>
            </revokeFetcher.Form>
            {revokeFetcher.data?.error && (
              <p className="text-xs text-destructive mt-2">
                {revokeFetcher.data.error}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Sections (Activity, Education, Eligibility rows) ───────────────────────

/** A read-only section: its title on the page ground, its body on one card. */
function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { sectionShell, sectionTitle } = useOsChrome();
  return (
    <section className={sectionShell}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={sectionTitle}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A sub-heading inside a section's card, above a list. */
function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-os-grey">
      {children}
    </h3>
  );
}

/** A row in one of those lists — a link or a fact, on the card's well. */
const LIST_ROW =
  "flex items-center justify-between gap-2 rounded-os-item bg-os-well px-3 py-2";

function ActivitySection({
  isSelf,
  projectHistory,
  pendingReviews,
  showReviewsRow,
  canEditLevel,
}: {
  isSelf: boolean;
  projectHistory: ProfilePageData["projectHistory"];
  pendingReviews: number;
  showReviewsRow: boolean;
  canEditLevel: boolean;
}) {
  const { sectionShell, sectionTitle } = useOsChrome();
  const location = useLocation();
  const cardRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(false);
  useEffect(() => {
    if (location.hash !== "#project-assignments") return;
    const el = cardRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    setHighlight(true);
    const t = setTimeout(() => setHighlight(false), 2000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [location.hash]);

  return (
    <section id="project-assignments" ref={cardRef} className={sectionShell}>
      <div className="flex items-center gap-1.5">
        <h2 className={sectionTitle}>Projects</h2>
        <InfoTip content="P1 = entry level, P2 = intermediate, P3 = senior. Levels are set by Core and reflect eligibility in each domain. Increasing a level requires the member's eligibility to be promoted first." />
      </div>

      <div
        className={cn(
          "flex flex-col gap-3 rounded-os-card transition-shadow",
          highlight &&
            "ring-2 ring-os-accent ring-offset-2 ring-offset-background",
        )}
      >
        {projectHistory.length === 0 ? (
          <p className="text-sm text-os-muted italic">
            No project assignments yet.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projectHistory.flatMap((g) =>
              g.assignments.map((a) => {
                const term = g.isCurrent ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-os-green/15 px-2.5 py-0.5 text-[11px] font-semibold text-os-green">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-os-green" />
                    Current term
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-os-container px-2.5 py-0.5 text-[11px] font-semibold text-os-grey">
                    {g.termCode}
                  </span>
                );
                const title = (
                  <span className="flex min-w-0 items-center gap-1.5 text-base font-semibold text-foreground">
                    <ProjectIcon iconEmoji={a.project.iconEmoji} />
                    <span className="truncate">{a.project.name}</span>
                  </span>
                );
                const cardClass =
                  "relative flex min-h-[88px] flex-col justify-between gap-3 rounded-os-card bg-os-card p-4";
                return canEditLevel && g.isCurrent ? (
                  <li key={a.id} className={cardClass}>
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/projects/${a.project.id}`} className="min-w-0 hover:underline">
                        {title}
                      </Link>
                      {term}
                    </div>
                    <span className="flex items-center gap-1.5 text-xs text-os-grey">
                      {a.domain.name}
                      <ProfileLevelEditor assignment={a} />
                    </span>
                  </li>
                ) : (
                  <li key={a.id}>
                    <Link
                      to={`/projects/${a.project.id}`}
                      className={cn(cardClass, "h-full transition-colors hover:bg-os-container")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        {title}
                        {term}
                      </div>
                      <span className="text-xs text-os-grey">
                        {a.domain.name} · {a.level}
                      </span>
                    </Link>
                  </li>
                );
              }),
            )}
          </ul>
        )}

        {showReviewsRow && (
          <div className="flex items-center gap-2 pt-3 border-t border-os-container">
            <MessageSquare className="w-4 h-4 text-os-grey" />
            <span className="text-sm text-foreground">
              {`${pendingReviews} review${pendingReviews === 1 ? "" : "s"} in progress`}
            </span>
            {isSelf && (
              <Link
                to="/hiring?view=reviews"
                className="ml-auto text-xs font-medium text-os-accent hover:underline"
              >
                Go to reviews →
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// Core-only inline level editor for one project assignment. Posts to the same
// resource route the project hub used to call; the guards (eligibility ceiling,
// mentee-blocked demotion) are enforced server-side and previewed here.
const LEVEL_OPTIONS: ("P1" | "P2" | "P3")[] = ["P1", "P2", "P3"];
const LEVEL_RANK: Record<"P1" | "P2" | "P3", number> = { P1: 1, P2: 2, P3: 3 };

function ProfileLevelEditor({
  assignment,
}: {
  assignment: ProfileProjectAssignment;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const ceilingRank = assignment.eligibilityLevel
    ? LEVEL_RANK[assignment.eligibilityLevel as "P1" | "P2" | "P3"]
    : 0;
  const currentRank = LEVEL_RANK[assignment.level as "P1" | "P2" | "P3"];
  const blockedByMentees = assignment.activeMenteeCount > 0;

  const value =
    (fetcher.formData?.get("level") as string | null) ?? assignment.level;
  const busy = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  function disabledReason(opt: "P1" | "P2" | "P3"): string | null {
    if (opt === assignment.level) return null;
    if (LEVEL_RANK[opt] > ceilingRank) {
      return assignment.eligibilityLevel
        ? `Eligible only up to ${assignment.eligibilityLevel} in ${assignment.domain.name}. Promote first.`
        : `No ${assignment.domain.name} eligibility. Promote first.`;
    }
    if (blockedByMentees && LEVEL_RANK[opt] < currentRank) {
      return `Mentoring ${assignment.activeMenteeCount} mentee${assignment.activeMenteeCount === 1 ? "" : "s"}. Reassign first.`;
    }
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Select
        ariaLabel={`Assignment level in ${assignment.domain.name}`}
        value={value}
        disabled={busy}
        onChange={(next) => {
          if (next === assignment.level) return;
          fetcher.submit(
            { level: next },
            {
              method: "post",
              action: `/api/projects/assignments/${assignment.id}/level`,
              encType: "application/json",
            },
          );
        }}
        options={LEVEL_OPTIONS.map((opt) => {
          const reason = disabledReason(opt);
          return {
            value: opt,
            label: `${opt}${reason ? " (locked)" : ""}`,
            description: reason ?? undefined,
            disabled: reason !== null,
          };
        })}
        buttonClassName="text-xs bg-transparent text-os-grey rounded border border-transparent hover:border-os-container-hi focus:border-os-container-hi focus:outline-none px-0.5 inline-flex items-center justify-between gap-1 transition-colors"
      />
      {error && (
        <span className="text-[10px] leading-tight text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

// ─── Education (self + Core viewers only — loader sends null otherwise) ─────

function EducationSection({
  education,
}: {
  education: NonNullable<ProfilePageData["education"]>;
}) {
  const { panel } = useOsChrome();
  if (
    education.attended.length === 0 &&
    education.taught.length === 0 &&
    education.ceCredits.length === 0
  ) {
    return null;
  }
  return (
    <Section title="Education">
      <div className={cn(panel, "grid grid-cols-1 gap-x-8 gap-y-5 p-5 md:grid-cols-2 lg:grid-cols-3")}>
        {education.taught.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <SubHeading>Taught</SubHeading>
            <ul className="flex flex-col gap-1.5">
              {education.taught.map((t) => (
                <li key={`${t.offeringId}-${t.termCode}`}>
                  <Link
                    to={`/education/${t.offeringId}`}
                    className={cn(LIST_ROW, "hover:bg-os-container transition-colors")}
                  >
                    <span className="text-sm font-medium text-foreground truncate">
                      {t.title}
                    </span>
                    <span className="text-xs text-os-grey whitespace-nowrap">
                      {t.type} · {t.termCode}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {education.ceCredits.length > 0 && <CeCredits credits={education.ceCredits} />}

        {education.attended.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <SubHeading>Attended</SubHeading>
            <ul className="flex flex-col gap-1.5">
              {education.attended.map((e) => (
                <li key={e.offeringId} className={LIST_ROW}>
                  <span className="text-sm font-medium text-foreground truncate">
                    {e.title}
                  </span>
                  <span className="text-xs text-os-grey whitespace-nowrap">
                    {e.status === "Approved" && e.attendance.total > 0
                      ? attendanceCopy(e.attendance, "ratio")
                      : e.status}
                    {e.certificateIssuedAt ? " · Certificate" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

function CeCredits({ credits }: { credits: Array<{ termCode: string; count: number }> }) {
  const [showPast, setShowPast] = useState(false);
  const [current, ...past] = credits;
  return (
    <div className="flex flex-col gap-2">
      <SubHeading>CE credits</SubHeading>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold leading-none text-foreground">{current.count}</span>
      </div>
      {past.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            aria-expanded={showPast}
            className="self-start text-xs font-medium text-os-grey hover:text-foreground"
          >
            {showPast ? "Hide past CE credits" : "Show past CE credits"}
          </button>
          {showPast && (
            <ul className="flex flex-col gap-1">
              {past.map((c) => (
                <li key={c.termCode} className="flex items-center justify-between gap-6 text-sm">
                  <span className="text-os-grey">{c.termCode}</span>
                  <span className="font-medium text-foreground">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ─── Eligibility rows (used by DomainsCard) ──────────────────────────────────

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
  const confirmSubmit = useConfirmSubmit();
  return (
    <div className={LIST_ROW}>
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
            <Select
              name="level"
              defaultValue={eligibility.level}
              onChange={(value) => {
                const fd = new FormData();
                fd.set("intent", "set-eligibility-level");
                fd.set("domainId", eligibility.domain.id);
                fd.set("level", value);
                setFetcher.submit(fd, { method: "post" });
              }}
              options={allowedLevels.map((l) => ({ value: l, label: l }))}
              ariaLabel={`Level for ${eligibility.domain.displayName}`}
              buttonClassName="text-xs font-medium px-2 py-1 border border-os-container rounded-os-item bg-os-card text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:border-os-container-hi"
            />
          </setFetcher.Form>
        ) : (
          <span className="text-xs font-medium text-foreground">
            {eligibility.level}
          </span>
        )}
        {canManage && (
          <removeFetcher.Form
            method="post"
            className="inline"
            onSubmit={confirmSubmit({
              title: `Remove ${eligibility.domain.displayName} eligibility?`,
              description:
                "This member will no longer be eligible to be staffed in this domain. You can add it back later.",
              confirmLabel: "Remove",
              tone: "destructive",
            })}
          >
            <input type="hidden" name="intent" value="remove-eligibility" />
            <input
              type="hidden"
              name="eligibilityId"
              value={eligibility.id}
            />
            <button
              type="submit"
              aria-label={`Remove ${eligibility.domain.displayName}`}
              className="text-os-grey hover:text-destructive p-1"
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
  const { quietBtn, fieldLabel, formClass } = useOsChrome();
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
        className={cn(quietBtn, "self-start !font-medium")}
      >
        <Plus className="w-3 h-3" />
        Add domain
      </button>
    );
  }

  return (
    <fetcher.Form method="post" className={cn("flex items-end gap-2", formClass)}>
      <input type="hidden" name="intent" value="add-eligibility" />
      <label className={cn(fieldLabel, "flex-1")}>
        <span>Domain</span>
        <Select
          name="domainId"
          value={domainId as string}
          onChange={(v) => setDomainId(v)}
          placeholder="Select a domain…"
          required
          options={domains.map((d) => ({ value: d.id, label: d.displayName }))}
        />
      </label>
      <label className={fieldLabel}>
        <span>Level</span>
        <Select
          name="level"
          value={level}
          onChange={(v) => setLevel(v as Level)}
          options={allowedLevels.map((l) => ({ value: l, label: l }))}
        />
      </label>
      <Tooltip
        content={!domainId ? "Select a domain first." : undefined}
        variant="rich"
      >
        <span>
          <button
            type="submit"
            disabled={submitting || !domainId}
            className={buttonClasses("primary", "sm")}
          >
            Add
          </button>
        </span>
      </Tooltip>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setDomainId("");
        }}
        className="px-3.5 py-1.5 text-[13px] font-semibold text-os-grey hover:text-foreground"
      >
        Cancel
      </button>
    </fetcher.Form>
  );
}

// ─── Email list edit ─────────────────────────────────────────────────────────

function EmailListEdit({
  daliEmail,
  dartmouthEmail,
  personalEmail,
}: {
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
}) {
  const [entries, setEntries] = useState<string[]>(
    personalEmail ? [personalEmail] : [],
  );

  function add() {
    setEntries((prev) => [...prev, ""]);
  }

  function remove(i: number) {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  function update(i: number, val: string) {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? val : e)));
  }

  const locked = [daliEmail, dartmouthEmail].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-1.5">
      {locked.map((email) => (
        <div
          key={email}
          className="flex items-center gap-2 rounded-os-item bg-os-well px-3 py-1.5 text-sm text-os-grey"
        >
          <Lock className="w-3 h-3 shrink-0" />
          <span className="truncate">{email}</span>
        </div>
      ))}
      {entries.map((email, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            name="personalEmail"
            type="email"
            value={email}
            onChange={(e) => update(i, e.target.value)}
            className="w-full"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label="Remove email"
            className="shrink-0 text-os-muted hover:text-destructive transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="self-start inline-flex items-center gap-1 text-[12px] font-medium text-os-muted hover:text-foreground transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add email
      </button>
    </div>
  );
}

// ─── Field plumbing ─────────────────────────────────────────────────────────

function memberEmails(member: ProfileMember): string[] {
  return [member.daliEmail, member.dartmouthEmail, member.personalEmail].filter(
    (e): e is string => Boolean(e),
  );
}

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
  defaultValue,
}: {
  name: string;
  defaultValue: string;
}) {
  const zones = timeZoneOptions();
  const options =
    defaultValue && !zones.includes(defaultValue) ? [defaultValue, ...zones] : zones;
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label="Time zone"
      className="w-full"
    >
      <option value="">Not set</option>
      {options.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

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

function birthdayInputValue(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Mentorship panel ────────────────────────────────────────────────────────

function MentorshipPanel({
  data,
  memberId,
}: {
  data: NonNullable<ProfilePageData["mentorshipPanel"]>;
  memberId: string;
}) {
  const { panel } = useOsChrome();
  return (
    <Section
      title="Mentorship"
      aside={
        data.recentNoteCount > 0 ? (
          <Link
            to={`/mentorship/browse?menteeId=${memberId}`}
            className="text-sm text-os-accent hover:underline"
          >
            View notes ({data.recentNoteCount})
          </Link>
        ) : undefined
      }
    >
      <div className={cn(panel, "p-5")}>
        {data.pairs.length === 0 ? (
          <p className="text-sm text-os-muted italic">
            No mentorship pairings on record.
          </p>
        ) : (
          <ul className="divide-y divide-os-container">
            {data.pairs.map((p) => (
              <li key={p.id} className="py-2.5 text-sm flex items-center gap-3">
                <Avatar
                  photoUrl={p.counterpart.photoUrl}
                  name={`${p.counterpart.firstName} ${p.counterpart.lastName}`}
                  size="sm"
                  className="shrink-0"
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-foreground truncate">
                    {p.role === "mentor"
                      ? `Mentoring ${p.counterpart.firstName} ${p.counterpart.lastName}`
                      : `Mentee of ${p.counterpart.firstName} ${p.counterpart.lastName}`}
                  </span>
                  <span className="text-xs text-os-grey truncate">
                    {p.projectName} · {p.domainCode} · {p.termCode}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
