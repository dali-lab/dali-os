// Shared loader + action helpers for the unified profile page used by both
// /profile (self) and /members/:id. Keeping these in one place ensures the
// two routes stay byte-for-byte equivalent except for which user id they
// resolve.

import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { resolvePhotoUrl } from "~/lib/photo";
import { graduateProgramLabel } from "~/lib/dartmouth-people";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import {
  listProfileNotes,
  listSharedWithMe,
  type NoteSummary,
} from "~/members/lib/personal-notes.server";
import {
  achievementsForMember,
  type Achievement,
} from "~/members/lib/achievements.server";
import { listMySignedDocuments } from "~/signing/lib/state.server";
import {
  currentTerm,
  getUserRoles,
  instructorRoleLabel,
  isAdmin,
  isCore,
  isLabMentor,
} from "~/lib/roles";
import {
  ALLOWED_LEVELS,
  parseLevel,
  type Level,
} from "~/admin/lib/eligibility";
import {
  applyEligibilityWithNotify,
  removeEligibility,
} from "~/admin/lib/eligibility.server";
import { NEW_MEMBER_PROFILE_FORM_NAME } from "~/members/lib/profile-form-interpreter";
import { normalizeHandle } from "~/lib/handle";
import { isValidTimezone } from "~/lib/timezone";
import { syncAvailabilityTimezone } from "~/lib/timezone-preference.server";
import { getEducationProfile } from "~/education/lib/engagement.server";
import {
  mentorshipPairWhere,
  mentorNoteWhere,
} from "~/mentorship/lib/visibility";

export type ProfileMember = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
  pronouns: string | null;
  classYear: number | null;
  /** Grad/professional school label ("Thayer" | "Guarini" | "Geisel" | "Tuck")
   *  for enrolled grad students; null for undergrads and employees. */
  gradProgram: string | null;
  major: string | null;
  hometown: string | null;
  linkedinUrl: string | null;
  githubUsername: string | null;
  personalSite: string | null;
  timeZone: string | null;
  netId: string | null;
  handle: string | null;
  phoneNumber: string | null;
  birthday: string | null;
  /** Account creation + lab-onboarding timestamps — drive the "New" badge. */
  createdAt: string;
  onboardedAt: string | null;
  dietaryRestrictions: string | null;
  domainEligibilities: Array<{
    id: string;
    level: Level;
    domain: { id: string; displayName: string };
  }>;
};

export type ProfilePageData = {
  member: ProfileMember;
  roleLabels: string[];
  /** Full-time staff (AdminMembership.isStaff). Shown as a Staff badge. */
  isStaff: boolean;
  /** Graduated former member (stored membershipStatus). Shown as an Alumni
   *  badge — independent of isStaff, so an alum-turned-staff shows both. */
  isAlumni: boolean;
  termCode: string | null;
  projectAssignments: Array<{
    id: string;
    level: string;
    project: { id: string; name: string; iconEmoji: string | null };
    domain: { name: string };
  }>;
  pendingReviews: number;
  /** True only when the subject has unsubmitted reviews — gates the activity
   *  row so we don't show "No reviews in progress" to viewers of someone who
   *  isn't on the reviewer roster this cycle. */
  showReviewsRow: boolean;
  isSelf: boolean;
  canEdit: boolean;
  canManageEligibility: boolean;
  /** Personal notes shown in the profile's right-hand rail. On someone else's
   *  profile this is only what they've made public plus anything shared with
   *  the viewer; `sharedWithMe` is populated only on your own profile. */
  notes: NoteSummary[];
  sharedWithMe: NoteSummary[];
  /** Milestone medals shown above the notes rail. Always the full catalog —
   *  the view hides unearned ones on other people's profiles. */
  achievements: Achievement[];
  /** CE standing and signed agreements. Null for viewers who shouldn't see
   *  either — this is compliance and paperwork, not public profile data. */
  compliance: {
    /** Null when the member isn't staffed this term: the credit is a
     *  requirement of being hired, so there's nothing to be compliant with. */
    ce: { termCode: string; credits: number; compliant: boolean } | null;
    agreements: { signatureId: string; documentName: string; context: string; signedAt: string }[];
  } | null;
  allDomains: Array<{ id: string; displayName: string }>;
  photoUrlResolved: string | null;
  collabToken: string | null;
  currentUserId: string;
  presenceUserName: string;
  presencePhotoUrl: string | null;
  presenceSubtitle: string | null;
  /** Re-exported so the view can render the Domains & levels picker without
   *  needing its own admin import. */
  allowedLevels: readonly Level[];
  /** Mentorship pairings + note count for this member. Populated only when
   *  the VIEWER is a lab mentor or Core AND they are not looking at their
   *  own profile — mentees never see anything about notes written about
   *  them. Null in every other case. */
  mentorshipPanel: {
    pairs: Array<{
      id: string;
      role: "mentor" | "mentee";
      counterpart: { id: string; firstName: string; lastName: string; photoUrl: string | null };
      projectName: string;
      domainCode: string;
      termCode: string;
    }>;
    recentNoteCount: number;
  } | null;
  /** Education engagement — attended offerings (note lanes excluded) and
   *  offerings taught. Loaded for self and Core viewers only; null hides the
   *  card entirely for peer viewers. */
  education: {
    attended: Array<{
      offeringId: string;
      title: string;
      type: "Miniseries" | "Workshop";
      startsAt: Date;
      endsAt: Date;
      status: string;
      attendance: { present: number; excused: number; total: number };
      certificateIssuedAt: Date | null;
    }>;
    taught: Array<{
      offeringId: string;
      title: string;
      type: "Miniseries" | "Workshop";
      termCode: string;
    }>;
    ceCredits: Array<{ termCode: string; count: number }>;

  } | null;
};

const TEXT_FIELDS = [
  "firstName",
  "lastName",
  "pronouns",
  "major",
  "hometown",
  "linkedinUrl",
  "githubUsername",
  "personalSite",
  "timeZone",
  "dietaryRestrictions",
  "phoneNumber",
  "netId",
  "handle",
  "personalEmail",
] as const;

export async function loadProfilePage({
  request,
  targetId,
}: {
  request: Request;
  targetId: string;
}): Promise<ProfilePageData> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) throw portalRedirect;

  const isSelf = auth.user.sub === targetId;

  // Onboarding gate: a member viewing their OWN profile while still pending
  // the New Member Profile form gets bounced to the form. Other members
  // viewing this profile do not trigger the gate.
  if (isSelf) {
    const membership = await prisma.dALIMember.findUnique({
      where: { userId: targetId },
      select: { onboardedAt: true },
    });
    if (membership && membership.onboardedAt === null) {
      const profileForm = await prisma.form.findFirst({
        where: { name: NEW_MEMBER_PROFILE_FORM_NAME, published: true },
        select: { publicToken: true },
      });
      if (profileForm?.publicToken) {
        const submitted = await prisma.formSubmission.count({
          where: {
            userId: targetId,
            form: { name: NEW_MEMBER_PROFILE_FORM_NAME },
          },
        });
        if (submitted === 0) {
          throw redirect(`/forms/fill/${profileForm.publicToken}`);
        }
      }
    }
  }

  const member = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
      pronouns: true,
      classYear: true,
      dartmouthDepartmentClass: true,
      major: true,
      hometown: true,
      linkedinUrl: true,
      githubUsername: true,
      personalSite: true,
      timeZone: true,
      photoUrl: true,
      netId: true,
      handle: true,
      phoneNumber: true,
      birthday: true,
      createdAt: true,
      daliMember: { select: { onboardedAt: true } },
      dietaryRestrictions: true,
      domainEligibilities: {
        select: {
          id: true,
          level: true,
          domain: { select: { id: true, displayName: true } },
        },
        orderBy: { domain: { displayName: "asc" } },
      },
    },
  });
  if (!member) throw new Response("Not found", { status: 404 });

  const [roles, term, allDomains, photoUrlResolved, presenceUser] =
    await Promise.all([
      getUserRoles(targetId),
      currentTerm(),
      prisma.domain.findMany({
        where: { active: true },
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      }),
      resolvePhotoUrl(member.photoUrl),
      getPresenceUser(auth.user.sub),
    ]);

  const [projectAssignments, pendingReviews] = await Promise.all([
    term
      ? prisma.projectAssignment.findMany({
          where: { userId: targetId, termId: term.id },
          select: {
            id: true,
            level: true,
            project: { select: { id: true, name: true, iconEmoji: true } },
            domain: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.applicationReview.count({
      where: { cycleReviewer: { userId: targetId }, submittedAt: null },
    }),
  ]);

  const canManageEligibility = await isCore(auth.user.sub);
  const adminViewer = await isAdmin(auth.user.sub);
  const canEdit = adminViewer || isSelf;

  // Education engagement is for the member themself and Core — not peer
  // browsing. Teaching history is public credit, but keeping one gate for the
  // whole card is simpler until someone needs the split.
  const education =
    isSelf || canManageEligibility
      ? await getEducationProfile(targetId)
      : null;

  // Mentorship panel: visible only when the viewer is a lab mentor (or Core)
  // AND they are NOT looking at their own profile. Mentees never see
  // anything about notes written about them. Non-Core mentors only see
  // pairs/notes in domains they mentor in (plus notes they authored).
  const viewerCanSeeMentorshipPanel = !isSelf
    ? canManageEligibility || (await isLabMentor(auth.user.sub))
    : false;
  let mentorshipPanel: ProfilePageData["mentorshipPanel"] = null;
  if (viewerCanSeeMentorshipPanel) {
    const [pairScope, noteScope] = await Promise.all([
      mentorshipPairWhere(auth.user.sub),
      mentorNoteWhere(auth.user.sub),
    ]);
    const [asMentor, asMentee, noteCount] = await Promise.all([
      prisma.mentorshipPair.findMany({
        where: { AND: [pairScope, { mentorUserId: targetId }] },
        select: {
          id: true,
          mentee: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
          project: { select: { name: true } },
          domain: { select: { code: true } },
          term: { select: { code: true } },
        },
      }),
      prisma.mentorshipPair.findMany({
        where: { AND: [pairScope, { menteeUserId: targetId }] },
        select: {
          id: true,
          mentor: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
          project: { select: { name: true } },
          domain: { select: { code: true } },
          term: { select: { code: true } },
        },
      }),
      prisma.mentorNote.count({
        where: {
          AND: [
            noteScope,
            { OR: [{ mentorId: targetId }, { menteeId: targetId }] },
          ],
        },
      }),
    ]);
    const rawPairs = [
      ...asMentor.map((p) => ({
        id: p.id,
        role: "mentor" as const,
        counterpart: p.mentee,
        projectName: p.project.name,
        domainCode: p.domain.code,
        termCode: p.term.code,
      })),
      ...asMentee.map((p) => ({
        id: p.id,
        role: "mentee" as const,
        counterpart: p.mentor,
        projectName: p.project.name,
        domainCode: p.domain.code,
        termCode: p.term.code,
      })),
    ];
    // Resolve each distinct counterpart avatar once (a member can appear in
    // more than one pair).
    const counterpartPhotos = new Map(
      await Promise.all(
        [...new Map(rawPairs.map((p) => [p.counterpart.id, p.counterpart.photoUrl]))].map(
          async ([id, raw]) => [id, await resolvePhotoUrl(raw)] as const,
        ),
      ),
    );
    mentorshipPanel = {
      pairs: rawPairs.map((p) => ({
        ...p,
        counterpart: {
          id: p.counterpart.id,
          firstName: p.counterpart.firstName,
          lastName: p.counterpart.lastName,
          photoUrl: counterpartPhotos.get(p.counterpart.id) ?? null,
        },
      })),
      recentNoteCount: noteCount,
    };
  }

  // Hired roles: the positions this member actually holds this term. Admin is
  // an access grant rather than a post, and "Lab Member" is what everyone on
  // this page already is — neither is something you're hired into, so neither
  // belongs here. Core titles and Domain Lead posts do, and they're listed by
  // their real names rather than a generic label.
  const [coreTitles, domainLeadRows, instructorRows] = term
    ? await Promise.all([
        prisma.coreAssignment.findMany({
          where: { userId: targetId, termId: term.id },
          select: { leadTitle: true },
        }),
        prisma.domainLeadAssignment.findMany({
          where: { userId: targetId, termId: term.id },
          select: { domain: { select: { displayName: true } } },
        }),
        prisma.instructorAssignment.findMany({
          where: { userId: targetId, termId: term.id },
          select: { offering: { select: { title: true, type: true } } },
        }),
      ])
    : [[], [], []];

  const roleLabels = [
    ...coreTitles.map((c) => (c.leadTitle ? `Core — ${c.leadTitle}` : "Core")),
    ...domainLeadRows.map((d) => `${d.domain.displayName} Lead`),
    // Named by what they teach: "Instructor" alone doesn't identify a post, and
    // a member can hold several in one term.
    ...instructorRows.map((i) => instructorRoleLabel(i.offering.type, i.offering.title)),
  ];

  const collabToken = parseSessionCookie(request);

  // Personal notes for the rail. "Shared with me" is an inbox of your own, so
  // it's only fetched when you're looking at your own profile.
  const [notes, sharedWithMe, achievements] = await Promise.all([
    listProfileNotes(targetId, auth.user.sub),
    isSelf ? listSharedWithMe(auth.user.sub) : Promise.resolve([]),
    achievementsForMember(targetId),
  ]);

  // Own profile, or Core/Admin who need the compliance view. A peer has no
  // business reading which agreements someone signed.
  const canSeeCompliance = isSelf || canManageEligibility;
  const compliance = canSeeCompliance
    ? await (async () => {
        const [staffedThisTerm, signed] = await Promise.all([
          term
            ? prisma.projectAssignment.findFirst({
                where: { userId: targetId, termId: term.id },
                select: { id: true },
              })
            : Promise.resolve(null),
          listMySignedDocuments(targetId),
        ]);
        // Full-time staff are exempt from the student checklist, so they get no
        // CE line even when staffed.
        const exempt = roles.isStaff;
        const ce =
          term && staffedThisTerm && !exempt
            ? await (async () => {
                const credits = await prisma.cECredit.count({
                  where: { userId: targetId, termId: term.id },
                });
                return { termCode: term.code, credits, compliant: credits >= 1 };
              })()
            : null;
        return {
          ce,
          agreements: signed.map((d) => ({
            signatureId: d.signatureId,
            documentName: d.documentName,
            context: d.context,
            signedAt: d.signedAt.toISOString(),
          })),
        };
      })()
    : null;

  // Convert the raw People-API code to a label server-side; only the label
  // (gradProgram) crosses the wire, not the underlying department_class.
  const {
    dartmouthDepartmentClass,
    createdAt: memberCreatedAt,
    daliMember: memberDaliMember,
    ...memberFields
  } = member;

  return {
    member: {
      ...memberFields,
      gradProgram: graduateProgramLabel(dartmouthDepartmentClass),
      birthday: member.birthday ? member.birthday.toISOString() : null,
      createdAt: memberCreatedAt.toISOString(),
      onboardedAt: memberDaliMember?.onboardedAt
        ? memberDaliMember.onboardedAt.toISOString()
        : null,
      domainEligibilities: member.domainEligibilities.map((e) => ({
        id: e.id,
        level: e.level as Level,
        domain: e.domain,
      })),
    },
    roleLabels,
    isStaff: roles.isStaff,
    isAlumni: roles.isAlumni,
    termCode: term?.code ?? null,
    projectAssignments,
    pendingReviews,
    showReviewsRow: pendingReviews > 0,
    isSelf,
    canEdit,
    canManageEligibility,
    notes,
    sharedWithMe,
    achievements,
    compliance,
    allDomains,
    photoUrlResolved,
    collabToken,
    currentUserId: auth.user.sub,
    presenceUserName: presenceUser?.name ?? auth.user.email,
    presencePhotoUrl: presenceUser?.photoUrl ?? null,
    presenceSubtitle: presenceUser?.subtitle ?? null,
    allowedLevels: ALLOWED_LEVELS,
    education,

    mentorshipPanel,
  };
}

export type ProfileActionResult =
  | { error: string }
  | null;

export async function runProfileAction({
  request,
  targetId,
}: {
  request: Request;
  targetId: string;
}): Promise<ProfileActionResult | Response> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) throw portalRedirect;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "profile");

  if (intent === "add-eligibility" || intent === "set-eligibility-level") {
    if (!(await isCore(auth.user.sub))) {
      return { error: "You don't have permission to assign domains." };
    }
    const domainId = String(form.get("domainId") ?? "");
    const level = parseLevel(form.get("level"));
    if (!domainId || !level) {
      return { error: "Pick a domain and a level." };
    }
    await applyEligibilityWithNotify({
      userId: targetId,
      domainId,
      level,
      actorId: auth.user.sub,
    });
    return null;
  }

  if (intent === "remove-eligibility") {
    if (!(await isCore(auth.user.sub))) {
      return { error: "You don't have permission to remove domains." };
    }
    const eligibilityId = String(form.get("eligibilityId") ?? "");
    if (!eligibilityId) return { error: "Missing eligibility id." };
    await removeEligibility({ id: eligibilityId });
    return null;
  }

  if (intent === "update-photo") {
    if (!(await isAdmin(auth.user.sub)) && auth.user.sub !== targetId) {
      return { error: "You don't have permission to edit this member." };
    }
    const photoUrlRaw = (form.get("photoUrl") as string | null)?.trim() ?? "";
    await prisma.user.update({
      where: { id: targetId },
      data: { photoUrl: photoUrlRaw === "" ? null : photoUrlRaw },
    });
    return redirect(redirectPathFor(request, targetId));
  }

  // Default: profile field update. Editable by admins or the member themself.
  const admin = await isAdmin(auth.user.sub);
  if (!admin && auth.user.sub !== targetId) {
    return { error: "You don't have permission to edit this member." };
  }

  const firstName = (form.get("firstName") as string | null)?.trim() ?? "";
  const lastName = (form.get("lastName") as string | null)?.trim() ?? "";
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }

  const data: Record<string, string | number | Date | null> = {};
  for (const field of TEXT_FIELDS) {
    const raw = (form.get(field) as string | null)?.trim() ?? "";
    if (field === "firstName" || field === "lastName") {
      data[field] = raw;
    } else if (field === "netId") {
      // NetID is case-normalized to lowercase — the CAS handler writes it the
      // same way, and the column has a unique index. Storing mixed case would
      // produce false "duplicates" against CAS-written rows.
      data[field] = raw === "" ? null : raw.toLowerCase();
    } else if (field === "handle") {
      // Handle is lowercased and stripped to [a-z0-9_] (same normalization the
      // seeder uses), unique-indexed. Empty clears it.
      const normalized = normalizeHandle(raw);
      data[field] = normalized === "" ? null : normalized;
    } else {
      data[field] = raw === "" ? null : raw;
    }
  }

  const personalEmail = data.personalEmail;
  if (typeof personalEmail === "string" && !personalEmail.includes("@")) {
    return { error: "Personal email looks malformed." };
  }

  if (typeof data.timeZone === "string" && !isValidTimezone(data.timeZone)) {
    return { error: "That timezone isn't a recognized IANA zone." };
  }

  const classYearRaw = (form.get("classYear") as string | null)?.trim() ?? "";
  if (classYearRaw === "") {
    data.classYear = null;
  } else {
    const n = Number(classYearRaw);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      return { error: "Class year must be a 4-digit year." };
    }
    data.classYear = n;
  }

  const birthdayRaw = (form.get("birthday") as string | null)?.trim() ?? "";
  if (birthdayRaw === "") {
    data.birthday = null;
  } else {
    // <input type="date"> sends YYYY-MM-DD. Anchor at UTC midnight so the
    // stored Date renders to the same calendar day for every viewer.
    const d = new Date(`${birthdayRaw}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      return { error: "Birthday must be a valid date." };
    }
    data.birthday = d;
  }

  try {
    await prisma.user.update({ where: { id: targetId }, data });
  } catch (e) {
    // P2002 = Prisma unique-constraint violation. Two unique text fields are
    // saved here (netId, handle); use meta.target to name the right one.
    const err = e as { code?: string; meta?: { target?: string[] | string } } | null;
    if (err?.code === "P2002") {
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target : target ? [target] : [];
      if (fields.some((f) => f.includes("handle"))) {
        return { error: "That handle is already taken — pick another." };
      }
      return {
        error:
          "That NetID is already on another account — contact ops to merge or correct the duplicate.",
      };
    }
    throw e;
  }

  // Keep the calendar/working-hours zone in step with the display zone.
  if (typeof data.timeZone === "string") {
    await syncAvailabilityTimezone(targetId, data.timeZone);
  }

  return redirect(redirectPathFor(request, targetId));
}

// /profile saves stay on /profile; /members/:id saves stay there. Falling
// back to the member page if the referer is missing keeps the response from
// landing somewhere random.
function redirectPathFor(request: Request, targetId: string): string {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/profile") return "/profile";
  } catch {}
  return `/members/${targetId}`;
}
