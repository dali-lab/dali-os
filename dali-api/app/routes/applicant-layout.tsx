import { Outlet, redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/applicant-layout";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { getDownloadUrl } from "~/lib/s3";
import { Avatar } from "~/components/Avatar";
import { userInitials } from "~/lib/display";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  let profilePictureUrl: string | null = null;
  const userRecord = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { profilePictureKey: true },
  });
  if (userRecord?.profilePictureKey) {
    profilePictureUrl = await getDownloadUrl(userRecord.profilePictureKey);
  }

  return { user: auth.user, profilePictureUrl };
}

export default function ApplicantLayout() {
  const { user, profilePictureUrl } = useLoaderData<typeof loader>() as {
    user: { sub: string; email: string; type: string; firstName?: string; lastName?: string };
    profilePictureUrl: string | null;
  };

  const displayName = user.firstName
    ? `${user.firstName} ${user.lastName ?? ""}`.trim()
    : user.email;

  const initial = userInitials(user);

  return (
    <div className="min-h-screen bg-section-bg">
      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 h-16 bg-card border-b border-border flex items-center px-6">
        <Link to="/portal" className="flex items-center gap-2">
          <span className="font-heading text-lg font-bold text-dark-blue">DALI</span>
          <span className="text-xs text-muted-foreground/70 font-medium">Applicant Portal</span>
        </Link>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Link to="/account">
              <Avatar src={profilePictureUrl} fallback={initial} size={32} />
            </Link>
            <span className="text-sm font-medium text-dark-blue hidden sm:block">
              {displayName}
            </span>
          </div>
          <Link
            to="/logout"
            className="text-xs text-muted-foreground hover:text-accent-coral transition"
          >
            Sign out
          </Link>
        </div>
      </nav>

      {/* Content */}
      <div className="pt-16">
        <Outlet />
      </div>
    </div>
  );
}
