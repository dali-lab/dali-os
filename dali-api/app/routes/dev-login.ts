// DEV-ONLY: bypass Google OAuth by minting a test JWT cookie.
// This route should never exist in production.

import type { Route } from "./+types/dev-login";
import { signAccessToken } from "~/lib/auth";
import { prisma } from "~/lib/db";

export async function loader({ request }: Route.LoaderArgs) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  // ── Dev user (admin / Engineering reviewer) ──
  const user = await prisma.user.upsert({
    where: { id: "dev-user-1" },
    update: {},
    create: { id: "dev-user-1", daliEmail: "dev@dali.dartmouth.edu", firstName: "Dev", lastName: "User" },
  });
  const member = await prisma.dALIMember.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, daliEmail: "dev@dali.dartmouth.edu" },
  });

  // ── Two domains ──
  let engDomain = await prisma.domain.findFirst({ where: { name: "Engineering" } });
  if (!engDomain) engDomain = await prisma.domain.create({ data: { name: "Engineering" } });

  let designDomain = await prisma.domain.findFirst({ where: { name: "Design" } });
  if (!designDomain) designDomain = await prisma.domain.create({ data: { name: "Design" } });

  // ── Domain lead assignment (dev user leads Engineering) ──
  const existingLead = await prisma.domainLeadAssignment.findFirst({ where: { memberId: member.id, domainId: engDomain.id } });
  if (!existingLead) {
    await prisma.domainLeadAssignment.create({ data: { memberId: member.id, domainId: engDomain.id } });
  }

  // ── Second reviewer (cross-domain, Design) ──
  const user2 = await prisma.user.upsert({
    where: { id: "dev-user-2" },
    update: {},
    create: { id: "dev-user-2", daliEmail: "dev2@dali.dartmouth.edu", firstName: "Alex", lastName: "Reviewer" },
  });
  const member2 = await prisma.dALIMember.upsert({
    where: { userId: user2.id },
    update: {},
    create: { userId: user2.id, daliEmail: "dev2@dali.dartmouth.edu" },
  });

  // ── If there's an active cycle, set up reviewers ──
  const latestCycle = await prisma.applicationCycle.findFirst({ orderBy: { createdAt: "desc" } });
  if (latestCycle) {
    // Dev user = Engineering reviewer (lead)
    await prisma.cycleReviewer.upsert({
      where: { daliMemberId_applicationCycleId: { daliMemberId: member.id, applicationCycleId: latestCycle.id } },
      update: {},
      create: { daliMemberId: member.id, applicationCycleId: latestCycle.id, domainId: engDomain.id, isLead: true },
    });
    // Second user = Design reviewer (cross-domain)
    await prisma.cycleReviewer.upsert({
      where: { daliMemberId_applicationCycleId: { daliMemberId: member2.id, applicationCycleId: latestCycle.id } },
      update: {},
      create: { daliMemberId: member2.id, applicationCycleId: latestCycle.id, domainId: designDomain.id, isLead: false },
    });

    // ── Ensure DomainApplicationCycle entries exist ──
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId: engDomain.id, applicationCycleId: latestCycle.id } },
      update: {},
      create: { domainId: engDomain.id, applicationCycleId: latestCycle.id, isReady: true },
    });
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId: designDomain.id, applicationCycleId: latestCycle.id } },
      update: {},
      create: { domainId: designDomain.id, applicationCycleId: latestCycle.id, isReady: true },
    });

    // ── Test applicant with submitted application ──
    const applicant = await prisma.user.upsert({
      where: { id: "dev-applicant-1" },
      update: {},
      create: { id: "dev-applicant-1", dartmouthEmail: "applicant@dartmouth.edu", firstName: "Test", lastName: "Applicant" },
    });

    // Application form + version (needed for Application FK)
    let form = await prisma.applicationForm.findFirst();
    if (!form) form = await prisma.applicationForm.create({ data: {} });

    let formVersion = await prisma.applicationFormVersion.findFirst({ where: { applicationFormId: form.id } });
    if (!formVersion) {
      formVersion = await prisma.applicationFormVersion.create({
        data: { applicationFormId: form.id, createdById: user.id, questions: [] },
      });
    }

    // Challenge + version (needed for DomainApplication FK)
    let challenge = await prisma.challenge.findFirst();
    if (!challenge) challenge = await prisma.challenge.create({ data: { name: "Engineering Challenge" } });

    let challengeVersion = await prisma.challengeVersion.findFirst({ where: { domainId: engDomain.id } });
    if (!challengeVersion) {
      challengeVersion = await prisma.challengeVersion.create({
        data: { challengeId: challenge.id, domainId: engDomain.id, createdById: user.id, questions: [] },
      });
    }

    // Application
    const existingApp = await prisma.application.findFirst({ where: { userId: applicant.id, applicationCycleId: latestCycle.id } });
    if (!existingApp) {
      const app = await prisma.application.create({
        data: {
          userId: applicant.id,
          applicationCycleId: latestCycle.id,
          applicationFormVersionId: formVersion.id,
          answers: {},
          statusUpdates: { create: { newStatus: "Submitted", userId: applicant.id } },
          domainApplications: {
            create: { challengeVersionId: challengeVersion.id, answers: {} },
          },
        },
      });
    }
  }

  const token = await signAccessToken({
    sub: user.id,
    email: "dev@dali.dartmouth.edu",
    type: "member",
    firstName: "Dev",
    lastName: "User",
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
    headers: {
      "Set-Cookie": cookie,
      Location: "/admin",
    },
  });
}
