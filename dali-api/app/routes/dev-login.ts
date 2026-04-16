// DEV-ONLY: shows a list of all users and unlinked DALI members.
// Click an existing user to log in; click an unlinked member to create a user on the fly.
// This route should never exist in production.

import type { Route } from "./+types/dev-login";
import { signAccessToken } from "~/lib/auth";
import { prisma } from "~/lib/db";

export async function loader({ request }: Route.LoaderArgs) {
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const memberId = url.searchParams.get("memberId");

  // Log in as an existing user
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return new Response("User not found", { status: 404 });
    return loginAsUser(user);
  }

  // Create a user for an unlinked DALI member, then log in
  if (memberId) {
    const member = await prisma.dALIMember.findUnique({ where: { id: memberId } });
    if (!member) return new Response("Member not found", { status: 404 });
    if (member.userId) {
      const user = await prisma.user.findUnique({ where: { id: member.userId } });
      if (user) return loginAsUser(user);
    }

    const user = await prisma.user.create({
      data: {
        daliEmail: member.daliEmail,
        dartmouthEmail: member.dartmouthEmail,
        firstName: member.firstName ?? "Unknown",
        lastName: member.lastName ?? "Member",
      },
    });
    await prisma.dALIMember.update({
      where: { id: memberId },
      data: { userId: user.id },
    });
    return loginAsUser(user);
  }

  // Show the user picker
  const users = await prisma.user.findMany({
    include: {
      daliMember: {
        include: {
          domainLeadAssignments: { include: { domain: true } },
          cycleReviewers: { include: { domain: true } },
        },
      },
    },
    orderBy: [{ daliEmail: "asc" }, { dartmouthEmail: "asc" }],
  });

  const unlinkedMembers = await prisma.dALIMember.findMany({
    where: { userId: null },
    include: {
      domainLeadAssignments: { include: { domain: true } },
      cycleReviewers: { include: { domain: true } },
    },
    orderBy: [{ daliEmail: "asc" }, { lastName: "asc" }],
  });

  const daliUsers = users.filter(u => u.daliEmail);
  const applicantUsers = users.filter(u => !u.daliEmail);

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
    .card-unlinked { background: #fafafa; border: 1px dashed #d1d5db; }
    .card-unlinked:hover { border-color: #f59e0b; border-style: solid; background: #fffbeb; }
    .name { font-weight: 600; font-size: 0.875rem; }
    .email { font-size: 0.75rem; color: #666; }
    .badges { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.25rem; }
    .badge { font-size: 0.625rem; font-weight: 600; padding: 0.125rem 0.375rem; border-radius: 0.25rem; white-space: nowrap; }
    .badge-member { background: #dbeafe; color: #1e40af; }
    .badge-applicant { background: #fef3c7; color: #92400e; }
    .badge-lead { background: #d1fae5; color: #065f46; }
    .badge-reviewer { background: #ede9fe; color: #5b21b6; }
    .badge-admin { background: #fce7f3; color: #9d174d; }
    .badge-unlinked { background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db; }
    .action { color: #999; font-size: 0.75rem; font-weight: 500; text-align: right; min-width: 5rem; }
    .card:hover .action { color: #3b82f6; }
    .card-unlinked:hover .action { color: #d97706; }
  </style>
</head>
<body>
  <h1>Dev Login</h1>
  <p class="subtitle">Pick a user to log in as. Non-production only.</p>
  <input type="text" class="search" id="search" placeholder="Search by name or email..." autofocus />

  <div id="users">
    ${renderSection("DALI Members with Accounts", daliUsers.map(u => renderUserCard(u)))}
    ${renderSection("Applicants", applicantUsers.map(u => renderUserCard(u)))}
    ${renderSection("Unlinked DALI Members (will create account)", unlinkedMembers.map(m => renderMemberCard(m)))}
  </div>

  <script>
    document.getElementById('search').addEventListener('input', function(e) {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.card, .card-unlinked').forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(q) ? '' : 'none';
      });
      document.querySelectorAll('.section').forEach(section => {
        const cards = section.querySelectorAll('.card, .card-unlinked');
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

async function loginAsUser(user: { id: string; daliEmail: string | null; dartmouthEmail: string | null; firstName: string; lastName: string }) {
  const email = user.daliEmail ?? user.dartmouthEmail ?? "";
  const type = user.daliEmail ? "member" : "applicant";

  const token = await signAccessToken({
    sub: user.id,
    email,
    type,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  const cookie = [
    `__dali_at=${token}`,
    "Max-Age=86400",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ");

  return new Response(null, {
    status: 302,
    headers: { "Set-Cookie": cookie, Location: "/" },
  });
}

function renderSection(title: string, cards: string[]): string {
  if (cards.length === 0) return "";
  return `
    <div class="section">
      <div class="section-title">${title} (${cards.length})</div>
      <div class="grid">${cards.join("\n")}</div>
    </div>`;
}

function renderUserCard(user: any): string {
  const email = user.daliEmail ?? user.dartmouthEmail ?? "no email";
  const badges = getBadges(user.daliEmail ? "member" : "applicant", user.daliMember);

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

function renderMemberCard(member: any): string {
  const name = member.firstName && member.lastName
    ? `${member.firstName} ${member.lastName}`
    : "Unknown Name";
  const email = member.daliEmail ?? member.dartmouthEmail ?? "no email";
  const badges = getBadges("unlinked", member);

  return `
    <a href="/dev-login?memberId=${member.id}" class="card card-unlinked">
      <div>
        <div class="name">${esc(name)}</div>
        <div class="email">${esc(email)}</div>
        <div class="badges">${badges}</div>
      </div>
      <span class="action">Create &amp; log in &rarr;</span>
    </a>`;
}

function getBadges(type: "member" | "applicant" | "unlinked", member: any): string {
  const badges: string[] = [];

  if (type === "unlinked") badges.push('<span class="badge badge-unlinked">No Account</span>');
  else if (type === "member") badges.push('<span class="badge badge-member">Member</span>');
  else badges.push('<span class="badge badge-applicant">Applicant</span>');

  if (member) {
    const roles: string[] = member.roles ?? [];
    if (roles.includes("Admin")) badges.push('<span class="badge badge-admin">Admin</span>');
    if (roles.includes("HiringLead")) badges.push('<span class="badge badge-admin">Hiring Lead</span>');
    if (member.domainLeadAssignments?.length > 0) {
      const domains = member.domainLeadAssignments.map((a: any) => a.domain.name).join(", ");
      badges.push(`<span class="badge badge-lead">Lead: ${domains}</span>`);
    }
    if (member.cycleReviewers?.length > 0) {
      badges.push('<span class="badge badge-reviewer">Reviewer</span>');
    }
  }

  return badges.join("");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
