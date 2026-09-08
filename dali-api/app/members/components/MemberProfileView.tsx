import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Form,
  Link,
  useFetcher,
  useLocation,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "react-router";
import { Select, Tooltip, InfoTip } from "~/components/ui/floating";
import {
  AtSign,
  Cake,
  Clock,
  Fingerprint,
  Github,
  Globe,
  GraduationCap,
  Linkedin,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Smartphone,
  User as UserIcon,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import { EditableSection } from "~/components/EditableSection";
import { ProjectIcon } from "~/components/ProjectIcon";
import { ProfilePhotoAvatar } from "~/components/ProfilePhotoAvatar";
import { Avatar } from "~/components/ui/Avatar";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { DomainChips } from "~/components/DomainChips";
import {
  DetailEditRow,
  DetailRow,
  HeroClusterLabel,
  OS_DETAIL_CARD,
  OS_DETAIL_ICON,
  OsTabBar,
} from "~/components/os-page";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { PersonalNotesRail } from "./PersonalNotesRail";
import { AchievementsBlock } from "./AchievementsBlock";
import { ComplianceBlock } from "./ComplianceBlock";
import { buttonClasses } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { useConfirmSubmit } from "~/components/ui/dialog";
import type { Level } from "~/admin/lib/eligibility";
import { APPLICATION_TZ, formatZoneLabel } from "~/lib/timezone";
import type {
  ProfileMember,
  ProfilePageData,
} from "~/members/lib/profile-page.server";
import { useAvatarStatus } from "~/components/presence/PresenceStatusProvider";
import { formatLastActive } from "~/lib/presence";
import { isNewMember, isBirthdayToday } from "~/members/lib/warmth";
import { NewBadge, BirthdayBadge } from "~/members/components/WarmthBadges";

// A member reads as a project does: the same hero (the photo as this page's
// icon, the name at 32px, its labelled clusters to the right), the same tab
// strip, and the same sections — a title on the page ground with its content on
// one card under it. See app/components/os-page.tsx for the shared parts.

const TABS = ["profile", "activity", "drive", "mentorship"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  profile: "Profile",
  activity: "Activity",
  drive: "Drive",
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
    notes,
    sharedWithMe,
    favoriteIds,
    achievements,
    compliance,
    wallet,
    canRevokeWalletPass,
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

  // Notes open in the normal document editor. Inside the TabWorkspace iframe
  // that means asking the shell for a side-by-side pane, same as the project
  // page does for its documents; standalone it's a plain navigation.
  function openNote(note: { id: string; title: string }) {
    const url = `/documents/${note.id}`;
    if (typeof window !== "undefined" && window.self !== window.top) {
      window.parent.postMessage(
        { type: "dali:openTabToSide", url, label: note.title },
        window.location.origin,
      );
    } else if (typeof window !== "undefined") {
      window.location.assign(url);
    }
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
  const showBirthday =
    !!member.birthday && isBirthdayToday(new Date(member.birthday), new Date());

  const page = (
    <div className="flex flex-col gap-6">
      <PresenceBar className="self-end" />

      <MemberHeader
        member={member}
        photoUrlResolved={photoUrlResolved}
        canEdit={canEdit}
        isStaff={isStaff}
        isAlumni={isAlumni}
        termCode={termCode}
        presenceState={presence?.state ?? null}
        presenceLabel={presenceLabel}
        showNewBadge={showNewBadge}
        showBirthday={showBirthday}
      />

      <OsTabBar
        ariaLabel="Profile sections"
        tabs={TABS.filter((t) => t !== "mentorship" || mentorshipPanel).map(
          (t) => ({ key: t, label: TAB_LABELS[t] }),
        )}
        active={tab}
        onSelect={setTab}
        trailing={
          isSelf ? (
            <a
              href="/logout"
              className="ml-auto -mb-px inline-flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-os-grey transition-colors hover:text-foreground"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </a>
          ) : null
        }
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
          <>
            <PersonalSection member={member} canEdit={canEdit} />

            <DomainsSection
              roleLabels={roleLabels}
              eligibilities={member.domainEligibilities}
              allDomains={allDomains}
              canManage={canManageEligibility}
              allowedLevels={allowedLevels}
            />

            <ComplianceBlock compliance={compliance} isSelf={isSelf} />

            {(wallet || (canRevokeWalletPass && !isSelf)) && (
              <WalletSection
                wallet={wallet}
                isSelf={isSelf}
                canRevoke={canRevokeWalletPass}
              />
            )}
          </>
        )}

        {tab === "activity" && (
          <>
            <ActivitySection
              isSelf={isSelf}
              termCode={termCode}
              projectAssignments={projectAssignments}
              pendingReviews={pendingReviews}
              showReviewsRow={showReviewsRow}
              canEditLevel={canManageEligibility}
            />

            <AchievementsBlock achievements={achievements} />

            {hasEducation && data.education && (
              <EducationSection education={data.education} />
            )}
          </>
        )}

        {tab === "drive" && (
          <PersonalNotesRail
            ownerId={member.id}
            ownerFirstName={member.firstName}
            isSelf={isSelf}
            notes={notes}
            sharedWithMe={sharedWithMe}
            favoriteIds={favoriteIds}
            onOpenNote={openNote}
          />
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
  isStaff,
  isAlumni,
  termCode,
  presenceState,
  presenceLabel,
  showNewBadge,
  showBirthday,
}: {
  member: ProfileMember;
  photoUrlResolved: string | null;
  canEdit: boolean;
  isStaff: boolean;
  isAlumni: boolean;
  termCode: string | null;
  presenceState: string | null;
  presenceLabel: string | null;
  showNewBadge: boolean;
  showBirthday: boolean;
}) {
  return (
    // No cover band: a member has a portrait, not a banner image, so the photo
    // stands where a project's icon does — inline with the title — rather than
    // in a strip of its own with nothing else to hold.
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-5">
      <div className="flex min-w-0 items-center gap-5">
        <ProfilePhotoAvatar
          userId={member.id}
          name={`${member.firstName} ${member.lastName}`}
          initialPreviewUrl={photoUrlResolved}
          canEdit={canEdit}
        />

        <div className="min-w-0 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-[32px] font-medium text-foreground">
              {member.firstName} {member.lastName}
            </h1>
            {member.handle && (
              <span className={cn(HERO_PILL, "bg-os-container text-os-grey")}>
                @{member.handle}
              </span>
            )}
            {member.pronouns && (
              <span className="text-[13px] text-os-muted">{member.pronouns}</span>
            )}
          </div>

          {(isStaff || isAlumni || member.gradProgram || showNewBadge || showBirthday) && (
            <div className="flex flex-wrap items-center gap-2">
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
              {showNewBadge && <NewBadge />}
              {showBirthday && <BirthdayBadge />}
            </div>
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
                      ? "bg-accent-green"
                      : "border border-accent-yellow bg-background"
                  }`}
                />
              </Tooltip>
              {presenceLabel}
            </p>
          )}
        </div>
      </div>

      {/* The design's hero-meta clusters, as the project page draws them. */}
      <div className="flex flex-wrap items-center gap-6">
        <HeroClusterLabel label="Term">
          {termCode ? (
            <span className={cn(HERO_PILL, "bg-os-container text-foreground")}>
              {termCode}
            </span>
          ) : (
            <span className="text-[13px] text-os-muted">No term</span>
          )}
        </HeroClusterLabel>

        <HeroClusterLabel label="Roles">
          {member.domainEligibilities.length === 0 ? (
            <span className="text-[13px] text-os-muted">No roles yet</span>
          ) : (
            <DomainChips
              items={member.domainEligibilities.map((e) => ({
                id: e.domain.id,
                name: e.domain.displayName,
              }))}
            />
          )}
        </HeroClusterLabel>
      </div>
    </header>
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

/** A read-only section: its title on the page ground, its body on one card. */
function Section({
  title,
  aside,
  children,
}: {
  title: string;
  /** A control or note beside the title (a link, a permission caveat). */
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

function PersonalSection({
  member,
  canEdit,
}: {
  member: ProfileMember;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const { formClass } = useOsChrome();

  return (
    <EditableSection
      title="Personal"
      canEdit={canEdit}
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing }) => (
        <Form
          method="post"
          ref={formRef}
          className={cn("w-full", editing && formClass)}
        >
          <input type="hidden" name="intent" value="profile" />
          {editing ? (
            <PersonalEdit member={member} />
          ) : (
            <PersonalRead member={member} />
          )}
        </Form>
      )}
    </EditableSection>
  );
}

// The read view: the same hairlined facts card the project page states its
// details in. Every field shows, empty ones as a dash, so the shape of the
// section doesn't change with how much a member has filled in.
function PersonalRead({ member }: { member: ProfileMember }) {
  const ic = OS_DETAIL_ICON;
  const dash = <span className="text-os-muted">—</span>;
  const emails = memberEmails(member);

  return (
    <div className={OS_DETAIL_CARD}>
      <DetailRow icon={<AtSign className={ic} />} label="Handle">
        {member.handle ? `@${member.handle}` : dash}
      </DetailRow>

      <DetailRow icon={<GraduationCap className={ic} />} label="Major">
        {member.major ?? dash}
      </DetailRow>

      <DetailRow icon={<GraduationCap className={ic} />} label="Class year">
        {member.classYear?.toString() ?? dash}
      </DetailRow>

      <DetailRow icon={<MapPin className={ic} />} label="Hometown">
        {member.hometown ?? dash}
      </DetailRow>

      <DetailRow icon={<Cake className={ic} />} label="Birthday">
        {formatBirthday(member.birthday) ?? dash}
      </DetailRow>

      <DetailRow icon={<Clock className={ic} />} label="Time zone">
        {member.timeZone ? formatZoneLabel(member.timeZone) : dash}
      </DetailRow>

      <DetailRow icon={<Phone className={ic} />} label="Phone">
        {member.phoneNumber ?? dash}
      </DetailRow>

      <DetailRow icon={<Fingerprint className={ic} />} label="NetID">
        {member.netId ?? dash}
      </DetailRow>

      <DetailRow icon={<Mail className={ic} />} label="Emails">
        {emails.length === 0 ? (
          dash
        ) : (
          <span className="flex flex-col items-end gap-0.5">
            {emails.map((e) => (
              <span key={e} className="break-all">
                {e}
              </span>
            ))}
          </span>
        )}
      </DetailRow>

      <DetailRow icon={<Utensils className={ic} />} label="Dietary restrictions">
        {member.dietaryRestrictions ?? dash}
      </DetailRow>

      <DetailRow icon={<Github className={ic} />} label="GitHub">
        {member.githubUsername ? (
          <a
            href={`https://github.com/${member.githubUsername}`}
            target="_blank"
            rel="noreferrer"
            className="text-os-accent hover:underline break-all"
          >
            {member.githubUsername}
          </a>
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Linkedin className={ic} />} label="LinkedIn">
        {member.linkedinUrl ? (
          <a
            href={member.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className="text-os-accent hover:underline break-all"
          >
            {member.linkedinUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Globe className={ic} />} label="Personal site">
        {member.personalSite ? (
          <a
            href={member.personalSite}
            target="_blank"
            rel="noreferrer"
            className="text-os-accent hover:underline break-all"
          >
            {member.personalSite.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        ) : (
          dash
        )}
      </DetailRow>
    </div>
  );
}

// The same card and rows with a field where each value was. Every field the
// `profile` intent writes is rendered — that write replaces the whole set, so
// a field left out of the form would be cleared rather than kept.
function PersonalEdit({ member }: { member: ProfileMember }) {
  const ic = OS_DETAIL_ICON;
  const field = "w-full";

  return (
    <div className={OS_DETAIL_CARD}>
      <DetailEditRow icon={<UserIcon className={ic} />} label="First name">
        <input
          name="firstName"
          type="text"
          defaultValue={member.firstName}
          required
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<UserIcon className={ic} />} label="Last name">
        <input
          name="lastName"
          type="text"
          defaultValue={member.lastName}
          required
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<UserIcon className={ic} />} label="Pronouns">
        <input
          name="pronouns"
          type="text"
          defaultValue={member.pronouns ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow
        icon={<AtSign className={ic} />}
        label="Handle"
        hint="How people @mention you"
      >
        <input
          name="handle"
          type="text"
          defaultValue={member.handle ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<GraduationCap className={ic} />} label="Major">
        <input
          name="major"
          type="text"
          defaultValue={member.major ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<GraduationCap className={ic} />} label="Class year">
        <input
          name="classYear"
          type="number"
          defaultValue={member.classYear?.toString() ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<MapPin className={ic} />} label="Hometown">
        <input
          name="hometown"
          type="text"
          defaultValue={member.hometown ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Cake className={ic} />} label="Birthday">
        <DateField
          mode="date"
          name="birthday"
          defaultValue={birthdayInputValue(member.birthday)}
          ariaLabel="Birthday"
        />
      </DetailEditRow>

      <DetailEditRow icon={<Clock className={ic} />} label="Time zone">
        <TimeZoneField name="timeZone" defaultValue={member.timeZone ?? ""} />
      </DetailEditRow>

      <DetailEditRow icon={<Phone className={ic} />} label="Phone">
        <input
          name="phoneNumber"
          type="text"
          inputMode="tel"
          defaultValue={member.phoneNumber ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Fingerprint className={ic} />} label="NetID">
        <input
          name="netId"
          type="text"
          defaultValue={member.netId ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Mail className={ic} />} label="Personal email">
        <input
          name="personalEmail"
          type="email"
          defaultValue={member.personalEmail ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Github className={ic} />} label="GitHub username">
        <input
          name="githubUsername"
          type="text"
          defaultValue={member.githubUsername ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Linkedin className={ic} />} label="LinkedIn URL">
        <input
          name="linkedinUrl"
          type="url"
          defaultValue={member.linkedinUrl ?? ""}
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Globe className={ic} />} label="Personal site">
        <input
          name="personalSite"
          type="url"
          defaultValue={member.personalSite ?? ""}
          className={field}
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
          className={cn(field, "resize-y")}
        />
      </DetailEditRow>
    </div>
  );
}

function WalletSection({
  wallet,
  isSelf,
  canRevoke,
}: {
  wallet: { apple: boolean; google: boolean } | null;
  isSelf: boolean;
  canRevoke: boolean;
}) {
  const { panel } = useOsChrome();
  const revokeFetcher = useFetcher<{ error?: string } | null>();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const revoking = revokeFetcher.state !== "idle";

  async function addToGoogle() {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      const res = await fetch("/api/wallet/google/save-url", { credentials: "include" });
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
    <Section title="Membership pass">
      <div className={cn(panel, "p-5 flex flex-col gap-3")}>
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
        {googleError && <p className="text-xs text-destructive">{googleError}</p>}

        {canRevoke && (
          <div className="pt-3 border-t border-os-container">
            {confirmRevoke ? (
              <revokeFetcher.Form
                method="post"
                onSubmit={() => setConfirmRevoke(false)}
                className="flex items-center gap-2 flex-wrap"
              >
                <input type="hidden" name="intent" value="revoke-wallet-pass" />
                <span className="text-sm text-foreground">
                  {isSelf
                    ? "Reset your pass? Your current one stops working until you re-add it."
                    : "Revoke this member's pass? Their current one stops working."}
                </span>
                <button
                  type="submit"
                  disabled={revoking}
                  className="px-3 py-1.5 rounded-full bg-destructive text-white text-[13px] font-semibold hover:brightness-95 disabled:opacity-50"
                >
                  {revoking ? "Resetting…" : isSelf ? "Reset pass" : "Revoke pass"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(false)}
                  className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold text-os-grey hover:bg-os-container hover:text-foreground"
                >
                  Cancel
                </button>
              </revokeFetcher.Form>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRevoke(true)}
                className="text-sm text-destructive hover:underline"
              >
                {isSelf ? "Reset my wallet pass" : "Revoke wallet pass"}
              </button>
            )}
            {revokeFetcher.data?.error && (
              <p className="text-xs text-destructive mt-2">
                {revokeFetcher.data.error}
              </p>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function ActivitySection({
  isSelf,
  termCode,
  projectAssignments,
  pendingReviews,
  showReviewsRow,
  canEditLevel,
}: {
  isSelf: boolean;
  termCode: string | null;
  projectAssignments: ProfilePageData["projectAssignments"];
  pendingReviews: number;
  showReviewsRow: boolean;
  /** Core viewers get the inline P1/P2/P3 editor on each project row — this is
   *  where assignment levels are changed now that the project hub links here. */
  canEditLevel: boolean;
}) {
  const { panel, sectionShell, sectionTitle } = useOsChrome();
  // The project hub deep-links to this card (#project-assignments) to change a
  // level. Scroll it into view and flash it so the target is obvious.
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
      <h2 className={sectionTitle}>
        {isSelf ? "My activity" : "Activity"}
        {termCode && (
          <span className="ml-1.5 text-xs font-normal text-os-grey">
            · {termCode}
          </span>
        )}
      </h2>

      <div
        className={cn(
          panel,
          "p-5 flex flex-col gap-3 transition-shadow",
          highlight &&
            "ring-2 ring-os-accent ring-offset-2 ring-offset-background",
        )}
      >
        <SubHeading>
          Projects
          <InfoTip content="P1 = entry level, P2 = intermediate, P3 = senior. Levels are set by Core and reflect eligibility in each domain. Increasing a level requires the member's eligibility to be promoted first." />
        </SubHeading>
        {projectAssignments.length === 0 ? (
          <p className="text-sm text-os-muted italic">
            No project assignments this term.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {projectAssignments.map((a) =>
              canEditLevel ? (
                // The level control is interactive, so the project link can't
                // wrap the whole row — split them.
                <li key={a.id} className={LIST_ROW}>
                  <Link
                    to={`/projects/${a.project.id}`}
                    className="flex items-center gap-1.5 min-w-0 text-sm font-medium text-foreground hover:underline"
                  >
                    <ProjectIcon iconEmoji={a.project.iconEmoji} />
                    <span className="truncate">{a.project.name}</span>
                  </Link>
                  <span className="flex items-center gap-1.5 text-xs text-os-grey whitespace-nowrap">
                    {a.domain.name}
                    <ProfileLevelEditor assignment={a} />
                  </span>
                </li>
              ) : (
                <li key={a.id}>
                  <Link
                    to={`/projects/${a.project.id}`}
                    className={cn(LIST_ROW, "hover:bg-os-container transition-colors")}
                  >
                    <span className="flex items-center gap-1.5 min-w-0 text-sm font-medium text-foreground">
                      <ProjectIcon iconEmoji={a.project.iconEmoji} />
                      <span className="truncate">{a.project.name}</span>
                    </span>
                    <span className="text-xs text-os-grey whitespace-nowrap">
                      {a.domain.name} · {a.level}
                    </span>
                  </Link>
                </li>
              ),
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
                to="/hiring/reviewer"
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
  assignment: ProfilePageData["projectAssignments"][number];
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
      <div className={cn(panel, "p-5 flex flex-col gap-4")}>
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

        {education.ceCredits.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <SubHeading>CE credits</SubHeading>
            {education.ceCredits.map((c) => (
              <span
                key={c.termCode}
                className="inline-flex items-center rounded-full bg-os-container px-3 py-[5px] text-[13px] font-semibold text-foreground"
              >
                {c.termCode}: {c.count}
              </span>
            ))}
          </div>
        )}

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
    </Section>
  );
}

// ─── Roles, domains & levels ────────────────────────────────────────────────

function DomainsSection({
  roleLabels = [],
  eligibilities,
  allDomains,
  canManage,
  allowedLevels,
}: {
  /** Core titles and Domain Lead posts held this term. */
  roleLabels?: string[];
  eligibilities: ProfileMember["domainEligibilities"];
  allDomains: Array<{ id: string; displayName: string }>;
  canManage: boolean;
  allowedLevels: readonly Level[];
}) {
  const { panel } = useOsChrome();
  const assignedDomainIds = new Set(eligibilities.map((e) => e.domain.id));
  const available = allDomains.filter((d) => !assignedDomainIds.has(d.id));

  return (
    <Section
      title="Roles, domains & levels"
      aside={
        !canManage ? (
          <span className="text-xs text-os-muted">Only Core or Admin can edit.</span>
        ) : undefined
      }
    >
      <div className={cn(panel, "p-5 flex flex-col gap-3")}>
        {roleLabels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {roleLabels.map((r) => (
              <span
                key={r}
                className="inline-flex items-center rounded-full bg-os-accent/15 px-3.5 py-[5px] text-[13px] font-semibold text-os-accent"
              >
                {r}
              </span>
            ))}
          </div>
        )}
        {eligibilities.length === 0 && !canManage && (
          <p className="text-sm text-os-muted italic">
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
            <p className="text-xs text-os-muted">
              All active domains are assigned.
            </p>
          )}
      </div>
    </Section>
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
        className={cn(quietBtn, "self-start")}
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

// ─── Field plumbing ─────────────────────────────────────────────────────────

// Every linked address, regardless of which one is primary.
function memberEmails(member: ProfileMember): string[] {
  return [member.daliEmail, member.dartmouthEmail, member.personalEmail].filter(
    (e): e is string => Boolean(e),
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
  defaultValue,
}: {
  name: string;
  defaultValue: string;
}) {
  const zones = timeZoneOptions();
  // A stored value outside the canonical list (legacy/rare) still shows selected.
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
