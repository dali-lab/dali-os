import { redirect, useLoaderData, Link } from "react-router";
import {
  LogOut,
  Mail,
  Shield,
  FolderKanban,
  MessageSquare,
  Pencil,
  User as UserIcon,
  Github,
  Linkedin,
  Globe,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { getUserRoles, currentTerm } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { userInitials } from "~/lib/display";
import { NEW_MEMBER_PROFILE_FORM_NAME } from "~/members/lib/profile-form-interpreter";
import type { Route } from "./+types/profile";

export const meta: Route.MetaFunction = () => [{ title: "Profile · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const userId = auth.user.sub;

  // A member still in onboarding (onboardedAt null) who hasn't filled out the
  // "New Member Profile" form yet is sent to it before they can view their
  // profile page. Established members (onboardedAt backfilled by the migration)
  // are NOT redirected even if they predate this form. Once a member submits
  // the form, this falls through to the normal read-only profile view.
  const membership = await prisma.dALIMember.findUnique({
    where: { userId },
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
          userId,
          form: { name: NEW_MEMBER_PROFILE_FORM_NAME },
        },
      });
      if (submitted === 0) {
        return redirect(`/forms/fill/${profileForm.publicToken}`);
      }
    }
  }
  const [user, roles, term] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
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
        photoUrl: true,
        hometown: true,
        githubUsername: true,
        linkedinUrl: true,
        personalSite: true,
        collegeId: true,
        phoneNumber: true,
        birthday: true,
        dietaryRestrictions: true,
      },
    }),
    getUserRoles(userId),
    currentTerm(),
  ]);
  if (!user) throw new Response("Not found", { status: 404 });

  // "My activity": current-term project assignments + reviews still in
  // progress. Both reuse existing models; scoped so this stays a cheap read.
  const [projectAssignments, pendingReviews] = await Promise.all([
    term
      ? prisma.projectAssignment.findMany({
          where: { userId, termId: term.id },
          select: {
            id: true,
            level: true,
            project: { select: { id: true, name: true } },
            domain: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.applicationReview.count({
      where: { cycleReviewer: { userId }, submittedAt: null },
    }),
  ]);

  const roleLabels = [
    roles.isAdmin && "Admin",
    roles.isCore && "Hiring Lead",
    roles.isDomainLead && "Domain Lead",
    roles.isLabMember && "Lab Member",
  ].filter(Boolean) as string[];

  return {
    user: { ...user, photoUrl: await resolvePhotoUrl(user.photoUrl) },
    email: auth.user.email,
    roleLabels,
    termCode: term?.code ?? null,
    projectAssignments,
    pendingReviews,
  };
}

export default function Profile() {
  const {
    user,
    email,
    roleLabels,
    termCode,
    projectAssignments,
    pendingReviews,
  } = useLoaderData<typeof loader>();

  const emails = [user.daliEmail, user.dartmouthEmail, user.personalEmail].filter(
    Boolean,
  ) as string[];

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <header className="flex flex-col items-center gap-4 text-center">
        {user.photoUrl ? (
          <img
            src={user.photoUrl}
            alt=""
            className="w-32 h-32 rounded-lg object-cover border border-border"
          />
        ) : (
          <div className="w-32 h-32 rounded-lg border border-border bg-accent-coral/15 text-accent-coral flex items-center justify-center font-bold text-3xl">
            {userInitials({ ...user, email })}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {user.firstName} {user.lastName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {user.pronouns ? `${user.pronouns} · ` : ""}
            {email}
            {user.classYear ? ` · '${String(user.classYear).slice(-2)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/members/${user.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </Link>
          <a
            href="/logout"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Log out
          </a>
        </div>
      </header>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <Shield className="w-4 h-4 text-accent-coral" />
          Account
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Detail label="Major" value={user.major} />
          <Detail label="Class year" value={user.classYear?.toString() ?? null} />
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
      </section>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <UserIcon className="w-4 h-4 text-accent-coral" />
          Personal
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Detail label="Hometown" value={user.hometown} />
          <Detail label="Birthday" value={formatBirthday(user.birthday)} />
          <Detail label="Phone" value={user.phoneNumber} />
          <Detail label="College ID" value={user.collegeId} />
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Dietary restrictions</dt>
            <dd className="text-sm text-foreground whitespace-pre-wrap">
              {user.dietaryRestrictions || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground mb-0.5">GitHub</dt>
            <dd className="text-sm text-foreground">
              {user.githubUsername ? (
                <a
                  href={`https://github.com/${user.githubUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-accent-coral hover:underline"
                >
                  <Github className="w-3.5 h-3.5" />
                  {user.githubUsername}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground mb-0.5">LinkedIn</dt>
            <dd className="text-sm text-foreground">
              {user.linkedinUrl ? (
                <a
                  href={user.linkedinUrl}
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
            <dt className="text-xs text-muted-foreground mb-0.5">Personal site</dt>
            <dd className="text-sm text-foreground">
              {user.personalSite ? (
                <a
                  href={user.personalSite}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-accent-coral hover:underline break-all"
                >
                  <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                  {user.personalSite}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <FolderKanban className="w-4 h-4 text-accent-coral" />
          My activity
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

        <div className="flex items-center gap-2 pt-1 border-t border-border mt-1">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-foreground">
            {pendingReviews === 0
              ? "No reviews in progress"
              : `${pendingReviews} review${pendingReviews === 1 ? "" : "s"} in progress`}
          </span>
          {pendingReviews > 0 && (
            <Link
              to="/hiring/reviewer"
              className="ml-auto text-xs font-medium text-accent-coral hover:underline"
            >
              Go to reviews →
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}

// Birthday is stored at UTC midnight; format from UTC components so a viewer in
// a negative-offset timezone doesn't see the previous day.
function formatBirthday(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}
