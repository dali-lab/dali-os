import { useRef } from "react";
import { Form, redirect, useLoaderData, useSubmit } from "react-router";
import type { Route } from "./+types/admin.site-users";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { isAdmin, isAdminViaEnv } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { Avatar } from "~/components/ui/Avatar";
import { SearchInput } from "~/components/ui/SearchInput";
import { ImpersonateButton } from "~/admin/components/admin-shared";
import { useOsChrome } from "~/components/os-chrome";
import { Shield, Ban } from "lucide-react";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Site users · Admin · DALI OS" }];

export const handle = adminHandle("site-users");

// Site users — every account on the site, not just lab members: applicants,
// partners, and Dartmouth users all have User rows. Admin-only, because its one
// action is impersonation ("Log in as"). Roles & permissions in Core stays a
// member-roster tool; impersonation lives here so it can reach everyone.
//
// Server-side search (name/email) with a bounded result set — the User table
// grows with every applicant, so this never loads it whole.

const RESULT_LIMIT = 100;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isAdmin(auth.user.sub))) return redirect("/");

  // "Log in as" only works with BetterAuth sessions and 404s otherwise, so the
  // buttons render disabled until the flag is on for everyone.
  const impersonationEnabled = await isFeatureEnabledForEveryone("betterauth", request);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  const where = q
    ? {
        OR: [
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
          { daliEmail: { contains: q, mode: "insensitive" as const } },
          { dartmouthEmail: { contains: q, mode: "insensitive" as const } },
          { personalEmail: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { netId: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        daliEmail: true,
        dartmouthEmail: true,
        personalEmail: true,
        email: true,
        netId: true,
        photoUrl: true,
        banned: true,
        membershipStatus: true,
        daliMember: { select: { id: true } },
        adminMembership: { select: { id: true } },
        partnerContact: { select: { id: true } },
      },
      orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: RESULT_LIMIT,
    }),
    prisma.user.count({ where }),
  ]);

  const photoUrls = new Map(
    await Promise.all(
      rows.map(async (u) => [u.id, await resolvePhotoUrl(u.photoUrl)] as const),
    ),
  );

  const users = rows.map((u) => {
    // Primary account kind. Membership wins over the others because a lab member
    // may also carry stray applicant/Dartmouth signals.
    const kind = u.daliMember
      ? u.membershipStatus === "Alumni"
        ? "Alumni"
        : "Member"
      : u.partnerContact
        ? "Partner"
        : u.netId || u.dartmouthEmail
          ? "Dartmouth"
          : "External";
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.daliEmail ?? u.dartmouthEmail ?? u.personalEmail ?? u.email ?? u.netId ?? null,
      photoUrl: photoUrls.get(u.id) ?? null,
      kind,
      isAdmin: u.adminMembership !== null || isAdminViaEnv(u.id),
      banned: u.banned === true,
    };
  });

  return { users, total, q, impersonationEnabled, viewerUserId: auth.user.sub };
}

export default function AdminSiteUsers() {
  const { users, total, q, impersonationEnabled, viewerUserId } =
    useLoaderData<typeof loader>();
  const { pageTitle, panel } = useOsChrome();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced auto-submit: each keystroke re-runs the loader's server search
  // (replace so the back button isn't buried under every character).
  function onSearchChange() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (formRef.current) submit(formRef.current, { replace: true });
    }, 250);
  }

  const truncated = total > users.length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className={pageTitle}>Site users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every account on the site — members, applicants, partners, and Dartmouth
            users. Log in as anyone to see the app exactly as they do.
          </p>
        </div>

        {!impersonationEnabled && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            Turn on the <span className="font-semibold">betterauth</span> flag for
            everyone (Admin → Feature Flags) to enable “Log in as”.
          </p>
        )}

        <Form method="get" ref={formRef} role="search">
          <label htmlFor="site-user-search" className="sr-only">
            Search users by name or email
          </label>
          <SearchInput
            id="site-user-search"
            name="q"
            defaultValue={q}
            onChange={onSearchChange}
            placeholder="Search all users by name or email…"
            containerClassName="w-full sm:max-w-md"
          />
        </Form>

        <p className="text-xs text-muted-foreground">
          {total === 0
            ? "No users match that search."
            : truncated
              ? `Showing ${users.length} of ${total} — narrow your search to see the rest.`
              : `${total} ${total === 1 ? "user" : "users"}`}
        </p>
      </header>

      <div className={cn("overflow-hidden", panel)}>
        {users.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            {q ? "No users match that search." : "No users yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {users.map((u) => {
              const name = `${u.firstName} ${u.lastName}`.trim();
              return (
                <li
                  key={u.id}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <Avatar photoUrl={u.photoUrl} name={name} size="sm" userId={u.id} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {name || "Unnamed user"}
                      </p>
                      <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {u.kind}
                      </span>
                      {u.isAdmin && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent-coral/30 bg-accent-coral/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-coral">
                          <Shield className="h-3 w-3" />
                          Admin
                        </span>
                      )}
                      {u.banned && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                          <Ban className="h-3 w-3" />
                          Banned
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.email ?? "No email on file"}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <ImpersonateButton
                      user={{
                        id: u.id,
                        firstName: u.firstName,
                        lastName: u.lastName,
                        email: u.email,
                      }}
                      disabled={!impersonationEnabled || u.id === viewerUserId}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
