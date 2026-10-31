import { useRef } from "react";
import { Form, redirect, useLoaderData, useSearchParams, useSubmit } from "react-router";
import type { Route } from "./+types/admin.site-users";
import type { Prisma } from "~/generated/prisma/client";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState, Pill, adminTable } from "~/admin/components/console-ui";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isAdminViaEnv } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { derivePresenceState } from "~/lib/presence";
import { relativeTime } from "~/lib/relative-time";
import { Avatar } from "~/components/ui/Avatar";
import { SearchInput } from "~/components/ui/SearchInput";
import { Segmented } from "~/components/ui/Segmented";
import { Tooltip } from "~/components/ui/floating";
import { PagerLinks } from "~/components/ui/Pager";
import { offsetPage, offsetWindow, parsePageParam } from "~/lib/pagination";
import { ImpersonateButton } from "~/admin/components/admin-shared";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Site users · Admin · DALI OS" }];

export const handle = adminHandle("users");

// Every account on the site, not just lab members. Admin-only, because its one
// action is impersonation. The User table grows with every applicant, so the
// search is server-side and paged instead of loading it whole.

export const PAGE_SIZE = 50;

export const SITE_USER_KINDS = ["Member", "Alumni", "Partner", "Dartmouth", "External"] as const;
export type SiteUserKind = (typeof SITE_USER_KINDS)[number];

// Membership wins over the other kinds because a lab member may also carry
// stray partner/Dartmouth signals. `kindWhere` must stay the exact inverse of
// `kindOf` so the filter and the per-kind counts agree with the label.
export function kindOf(u: {
  daliMember: unknown;
  membershipStatus: string;
  partnerContact: unknown;
  netId: string | null;
  dartmouthEmail: string | null;
}): SiteUserKind {
  if (u.daliMember) return u.membershipStatus === "Alumni" ? "Alumni" : "Member";
  if (u.partnerContact) return "Partner";
  if (u.netId || u.dartmouthEmail) return "Dartmouth";
  return "External";
}

export function kindWhere(kind: SiteUserKind): Prisma.UserWhereInput {
  const notMember = { daliMember: { is: null } };
  const notPartner = { partnerContact: { is: null } };
  switch (kind) {
    case "Member":
      return { daliMember: { isNot: null }, membershipStatus: { not: "Alumni" } };
    case "Alumni":
      return { daliMember: { isNot: null }, membershipStatus: "Alumni" };
    case "Partner":
      return { ...notMember, partnerContact: { isNot: null } };
    case "Dartmouth":
      return {
        AND: [notMember, notPartner, { OR: [{ netId: { not: null } }, { dartmouthEmail: { not: null } }] }],
      };
    case "External":
      return { AND: [notMember, notPartner, { netId: null }, { dartmouthEmail: null }] };
  }
}

function searchWhere(q: string): Prisma.UserWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: "insensitive" as const };
  return {
    OR: [
      { firstName: contains },
      { lastName: contains },
      { name: contains },
      { daliEmail: contains },
      { dartmouthEmail: contains },
      { personalEmail: contains },
      { email: contains },
      { netId: contains },
    ],
  };
}

function parseKind(raw: string | null): SiteUserKind | null {
  return (SITE_USER_KINDS as readonly string[]).includes(raw ?? "") ? (raw as SiteUserKind) : null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isAdmin(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const kind = parseKind(url.searchParams.get("kind"));
  const page = parsePageParam(url.searchParams.get("page"));

  const search = searchWhere(q);
  const where: Prisma.UserWhereInput = kind ? { AND: [search, kindWhere(kind)] } : search;

  const [rows, kindTotals] = await Promise.all([
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
        lastActiveAt: true,
        hideActivity: true,
        daliMember: { select: { id: true } },
        adminMembership: { select: { id: true } },
        partnerContact: { select: { id: true } },
      },
      orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
      ...offsetWindow(page, PAGE_SIZE),
    }),
    Promise.all(SITE_USER_KINDS.map((k) => prisma.user.count({ where: { AND: [search, kindWhere(k)] } }))),
  ]);

  const counts = Object.fromEntries(SITE_USER_KINDS.map((k, i) => [k, kindTotals[i] ?? 0])) as Record<
    SiteUserKind,
    number
  >;
  const all = kindTotals.reduce((a, b) => a + b, 0);
  const total = kind ? counts[kind] : all;

  const { items: pageRows, hasNext } = offsetPage(rows, PAGE_SIZE);
  const photoUrls = new Map(
    await Promise.all(pageRows.map(async (u) => [u.id, await resolvePhotoUrl(u.photoUrl)] as const)),
  );

  const now = new Date();
  const users = pageRows.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.daliEmail ?? u.dartmouthEmail ?? u.personalEmail ?? u.email ?? u.netId ?? null,
    photoUrl: photoUrls.get(u.id) ?? null,
    kind: kindOf(u),
    isAdmin: u.adminMembership !== null || isAdminViaEnv(u.id),
    banned: u.banned === true,
    lastSeen: u.hideActivity
      ? { hidden: true as const, at: null, online: false }
      : {
          hidden: false as const,
          at: u.lastActiveAt?.toISOString() ?? null,
          online: derivePresenceState(u.lastActiveAt, now) === "active",
        },
  }));

  return { users, total, all, counts, kind, q, page, hasNext, viewerUserId: auth.user.sub, isAdmin: true };
}

type SiteUser = ReturnType<typeof useLoaderData<typeof loader>>["users"][number];

function LastSeen({ lastSeen }: { lastSeen: SiteUser["lastSeen"] }) {
  if (lastSeen.hidden) {
    return (
      <Tooltip content="This person hides their activity.">
        <span className="text-os-muted">Hidden</span>
      </Tooltip>
    );
  }
  if (!lastSeen.at) return <span className="text-os-muted">Never</span>;
  if (lastSeen.online) return <span className="text-os-green">Online</span>;
  return (
    <Tooltip content={new Date(lastSeen.at).toLocaleString()}>
      <span className="text-os-grey">{relativeTime(lastSeen.at)}</span>
    </Tooltip>
  );
}

type KindFilter = "all" | SiteUserKind;

export default function AdminSiteUsers() {
  const { users, total, all, counts, kind, q, page, hasNext, viewerUserId } = useLoaderData<typeof loader>();
  const { panel } = useOsChrome();
  const submit = useSubmit();
  const [, setSearchParams] = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Replace so the back button isn't buried under every keystroke.
  function onSearchChange() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (formRef.current) submit(formRef.current, { replace: true });
    }, 250);
  }

  function onKindChange(next: KindFilter) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "all") params.delete("kind");
      else params.set("kind", next);
      params.delete("page");
      return params;
    });
  }

  function pageHref(nextPage: number): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (kind) params.set("kind", kind);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  }

  const firstShown = (page - 1) * PAGE_SIZE + 1;

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader section="accounts" />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Form method="get" ref={formRef} role="search" className="lg:w-80">
          <label htmlFor="site-user-search" className="sr-only">
            Search users by name or email
          </label>
          <SearchInput
            id="site-user-search"
            name="q"
            defaultValue={q}
            onChange={onSearchChange}
            placeholder="Search by name or email"
          />
          {kind && <input type="hidden" name="kind" value={kind} />}
        </Form>
        <div className="max-w-full overflow-x-auto">
          <Segmented<KindFilter>
            ariaLabel="Account type"
            value={kind ?? "all"}
            onChange={onKindChange}
            options={[
              { value: "all", label: "All", count: all },
              ...SITE_USER_KINDS.map((k) => ({ value: k, label: k, count: counts[k] })),
            ]}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-os-muted">
          {total === 0
            ? "No users match that search."
            : total > PAGE_SIZE
              ? users.length === 0
                ? `No users on this page. ${total} in all.`
                : `Showing ${firstShown}-${firstShown + users.length - 1} of ${total}`
              : `${total} ${total === 1 ? "user" : "users"}`}
        </p>

        <div className={cn(panel, "overflow-x-auto")}>
          {users.length === 0 ? (
            <EmptyState>{q || kind ? "No users match that search." : "No users yet."}</EmptyState>
          ) : (
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className={adminTable.th}>Account</th>
                  <th className={adminTable.th}>Type</th>
                  <th className={adminTable.th}>Last seen</th>
                  <th className={adminTable.th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const name = `${u.firstName} ${u.lastName}`.trim();
                  return (
                    <tr key={u.id} className={adminTable.row}>
                      <td className={adminTable.td}>
                        <div className="flex items-center gap-3">
                          <Avatar photoUrl={u.photoUrl} name={name} size="sm" userId={u.id} />
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                              {name || "Unnamed user"}
                              {u.isAdmin && <Pill>Admin</Pill>}
                              {u.banned && <Pill tone="bad">Banned</Pill>}
                            </p>
                            <p className="truncate text-xs text-os-muted">{u.email ?? "No email on file"}</p>
                          </div>
                        </div>
                      </td>
                      <td className={cn(adminTable.td, "text-os-grey")}>{u.kind}</td>
                      <td className={cn(adminTable.td, "whitespace-nowrap")}>
                        <LastSeen lastSeen={u.lastSeen} />
                      </td>
                      <td className={cn(adminTable.td, "text-right")}>
                        <ImpersonateButton
                          user={{ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }}
                          disabled={u.id === viewerUserId}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <PagerLinks page={page} hasNext={hasNext} hrefFor={pageHref} label="Site users pagination" endLabel="End of list" />
    </div>
  );
}
