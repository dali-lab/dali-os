// Shared loader + action helpers for the unified profile page used by both
// /profile (self) and /members/:id. Keeping these in one place ensures the
// two routes stay byte-for-byte equivalent except for which user id they
// resolve.

import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { resolvePhotoUrl } from "~/lib/photo";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import {
  currentTerm,
  getUserRoles,
  isAdmin,
  isCore,
} from "~/lib/roles";
import {
  ALLOWED_LEVELS,
  parseLevel,
  type Level,
} from "~/admin-console/lib/eligibility";
import {
  addOrUpdateEligibility,
  removeEligibility,
} from "~/admin-console/lib/eligibility.server";
import { NEW_MEMBER_PROFILE_FORM_NAME } from "~/members/lib/profile-form-interpreter";
import { getEducationProfile } from "~/education/lib/engagement.server";

export type ProfileMember = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
  pronouns: string | null;
  classYear: number | null;
  major: string | null;
  hometown: string | null;
  linkedinUrl: string | null;
  githubUsername: string | null;
  personalSite: string | null;
  timeZone: string | null;
  netId: string | null;
  phoneNumber: string | null;
  birthday: string | null;
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
  termCode: string | null;
  projectAssignments: Array<{
    id: string;
    level: string;
    project: { id: string; name: string };
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
  allDomains: Array<{ id: string; displayName: string }>;
  photoUrlResolved: string | null;
  collabToken: string | null;
  currentUserId: string;
  presenceUserName: string;
  presencePhotoUrl: string | null;
  presenceSubtitle: string | null;
  /** Re-exported so the view can render the Domains & levels picker without
   *  needing its own admin-console import. */
  allowedLevels: readonly Level[];
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
      major: true,
      hometown: true,
      linkedinUrl: true,
      githubUsername: true,
      personalSite: true,
      timeZone: true,
      photoUrl: true,
      netId: true,
      phoneNumber: true,
      birthday: true,
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
            project: { select: { id: true, name: true } },
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

  const roleLabels = [
    roles.isAdmin && "Admin",
    roles.isCore && "Hiring Lead",
    roles.isDomainLead && "Domain Lead",
    roles.isLabMember && "Lab Member",
  ].filter(Boolean) as string[];

  const collabToken = parseSessionCookie(request);

  return {
    member: {
      ...member,
      birthday: member.birthday ? member.birthday.toISOString() : null,
      domainEligibilities: member.domainEligibilities.map((e) => ({
        id: e.id,
        level: e.level as Level,
        domain: e.domain,
      })),
    },
    roleLabels,
    termCode: term?.code ?? null,
    projectAssignments,
    pendingReviews,
    showReviewsRow: pendingReviews > 0,
    isSelf,
    canEdit,
    canManageEligibility,
    allDomains,
    photoUrlResolved,
    collabToken,
    currentUserId: auth.user.sub,
    presenceUserName: presenceUser?.name ?? auth.user.email,
    presencePhotoUrl: presenceUser?.photoUrl ?? null,
    presenceSubtitle: presenceUser?.subtitle ?? null,
    allowedLevels: ALLOWED_LEVELS,
    education,
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
    await addOrUpdateEligibility({
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
    } else {
      data[field] = raw === "" ? null : raw;
    }
  }

  const personalEmail = data.personalEmail;
  if (typeof personalEmail === "string" && !personalEmail.includes("@")) {
    return { error: "Personal email looks malformed." };
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
    // P2002 = Prisma unique-constraint violation. The only unique text field
    // saved here is netId; surface a friendly error instead of a 500.
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2002") {
      return {
        error:
          "That NetID is already on another account — contact ops to merge or correct the duplicate.",
      };
    }
    throw e;
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
