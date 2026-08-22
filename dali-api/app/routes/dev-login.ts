// DEV-ONLY: shows a list of all users to log in as. Post-Phase-2, all lab
// members live as User rows (the prior "unlinked DALIMember" concept was
// migrated during deploy). This route should never exist in production.

import type { Route } from "./+types/dev-login";
import { isDevLoginEnabled } from "~/lib/dev-login";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { prisma } from "~/lib/db";

export async function loader({ request }: Route.LoaderArgs) {
  if (!isDevLoginEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { partnerContact: { select: { id: true } } },
    });
    if (!user) return new Response("User not found", { status: 404 });
    return loginAsUser(user);
  }

  const users = await prisma.user.findMany({
    include: {
      daliMember: { select: { id: true } },
      adminMembership: { select: { id: true } },
      coreAssignments: { select: { leadTitle: true } },
      domainLeadAssignmentsAsUser: { include: { domain: true } },
      cycleReviewers: { include: { domain: true } },
      partnerContact: {
        select: {
          memberships: {
            where: { endedAt: null },
            select: { role: true, org: { select: { name: true } } },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const daliUsers = users.filter((u) => u.daliMember !== null);
  const partnerUsers = users.filter(
    (u) => u.daliMember === null && u.partnerContact !== null,
  );
  const applicantUsers = users.filter(
    (u) => u.daliMember === null && u.partnerContact === null,
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dev Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 2rem; color: #111; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    .search { width: 100%; padding: 0.625rem 1rem; border: 1px solid #ddd; border-radius: 0.5rem; font-size: 0.875rem; margin-bottom: 1rem; background: #fff; }
    .search:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
    .section { margin-bottom: 2rem; }
    .section-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 0.5rem; padding-left: 0.25rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 0.5rem; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 0.5rem; padding: 0.75rem 1rem; display: flex; align-items: center; justify-content: space-between; transition: all 0.15s; cursor: pointer; text-decoration: none; color: inherit; }
    .card:hover { border-color: #3b82f6; background: #eff6ff; }
    .name { font-weight: 600; font-size: 0.875rem; }
    .email { font-size: 0.75rem; color: #666; }
    .badges { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.25rem; }
    .badge { font-size: 0.625rem; font-weight: 600; padding: 0.125rem 0.375rem; border-radius: 0.25rem; white-space: nowrap; }
    .badge-member { background: #dbeafe; color: #1e40af; }
    .badge-applicant { background: #fef3c7; color: #92400e; }
    .badge-lead { background: #d1fae5; color: #065f46; }
    .badge-reviewer { background: #ede9fe; color: #5b21b6; }
    .badge-admin { background: #fce7f3; color: #9d174d; }
    .badge-partner { background: #ccfbf1; color: #115e59; }
    .action { color: #999; font-size: 0.75rem; font-weight: 500; text-align: right; min-width: 5rem; }
    .card:hover .action { color: #3b82f6; }
  </style>
</head>
<body>
  <h1>Dev Login</h1>
  <p class="subtitle">Pick a user to log in as. Non-production only.</p>
  <input type="text" class="search" id="search" placeholder="Search by name or email..." autofocus />

  <div id="users">
    ${renderSection("DALI Members", daliUsers.map((u) => renderUserCard(u, true)))}
    ${renderSection("Partners", partnerUsers.map((u) => renderUserCard(u, false)))}
    ${renderSection("Applicants / Other", applicantUsers.map((u) => renderUserCard(u, false)))}
  </div>

  <script>
    document.getElementById('search').addEventListener('input', function(e) {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.card').forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(q) ? '' : 'none';
      });
      document.querySelectorAll('.section').forEach(section => {
        const cards = section.querySelectorAll('.card');
        const anyVisible = Array.from(cards).some(c => c.style.display !== 'none');
        section.style.display = anyVisible ? '' : 'none';
      });
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function loginAsUser(user: {
  id: string;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  firstName: string;
  lastName: string;
  partnerContact: { id: string } | null;
}) {
  const session = await issueSession({ userId: user.id });

  const headers = new Headers();
  setSessionCookie(headers, session.rawId);

  const redirect = user.daliEmail ? "/" : user.partnerContact ? "/partner" : "/portal";
  headers.set("Location", redirect);
  return new Response(null, { status: 302, headers });
}

function renderSection(title: string, cards: string[]): string {
  if (cards.length === 0) return "";
  return `
    <div class="section">
      <div class="section-title">${title} (${cards.length})</div>
      <div class="grid">${cards.join("\n")}</div>
    </div>`;
}

function renderUserCard(user: any, isMember: boolean): string {
  const email =
    user.daliEmail ?? user.dartmouthEmail ?? user.personalEmail ?? "no email";
  const badges = getBadges(isMember, user);

  return `
    <a href="/dev-login?userId=${user.id}" class="card">
      <div>
        <div class="name">${esc(user.firstName)} ${esc(user.lastName)}</div>
        <div class="email">${esc(email)}</div>
        <div class="badges">${badges}</div>
      </div>
      <span class="action">Log in &rarr;</span>
    </a>`;
}

function getBadges(isMember: boolean, user: any): string {
  const badges: string[] = [];

  if (isMember) badges.push('<span class="badge badge-member">Member</span>');
  else if (user.partnerContact) {
    const firstMembership = user.partnerContact.memberships?.[0];
    const org = firstMembership?.org?.name ?? "Partner";
    const role = firstMembership?.role;
    badges.push(
      `<span class="badge badge-partner">Partner: ${esc(org)}${role ? ` · ${esc(role)}` : ""}</span>`,
    );
  } else badges.push('<span class="badge badge-applicant">Applicant</span>');

  if (user.adminMembership) badges.push('<span class="badge badge-admin">Admin</span>');
  const coreTitles: string[] = (user.coreAssignments ?? [])
    .map((c: any) => c.leadTitle)
    .filter((t: string | null) => !!t);
  if (coreTitles.length > 0) {
    badges.push(`<span class="badge badge-admin">Core: ${esc(coreTitles.join(", "))}</span>`);
  }
  if (user.domainLeadAssignmentsAsUser?.length > 0) {
    const domains = user.domainLeadAssignmentsAsUser.map((a: any) => a.domain.displayName ?? a.domain.name).join(", ");
    badges.push(`<span class="badge badge-lead">Lead: ${esc(domains)}</span>`);
  }
  if (user.cycleReviewers?.length > 0) {
    badges.push('<span class="badge badge-reviewer">Reviewer</span>');
  }

  return badges.join("");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
