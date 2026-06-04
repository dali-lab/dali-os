// Seed a few "just accepted" applicants as NEW MEMBERS who still need to
// onboard, then run the real welcome path (form-backed profile todo + welcome
// email). This exercises the same helpers the acceptance-release flow uses
// (promoteToMember + sendWelcome), so the seeded members land in exactly the
// state a freshly-accepted applicant would: DALIMember with onboardedAt=null,
// P1 eligibility in a domain, and a "complete your profile" notification.
//
// Welcome emails are redirected to a single inbox by welcome.server's
// ONBOARDING_EMAIL_OVERRIDE (defaults to sophie.park@dali.dartmouth.edu), so
// running this won't email the seeded fake people.
//
// Idempotent: users are upserted by daliEmail; promoteToMember and sendWelcome
// are themselves idempotent (no duplicate member rows or duplicate welcome
// notifications on re-run).
//
// Usage:
//   npx tsx --env-file .env prisma/seeds/accepted-applicants.ts
import { PrismaClient } from "../../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { promoteToMember } from "../../app/members/lib/membership.server.js";
import { sendWelcome } from "../../app/members/lib/welcome.server.js";
import { NEW_MEMBER_PROFILE_FORM_NAME } from "../../app/members/lib/profile-form-interpreter.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// The onboarding "New Member Profile" form. Its question KEYS must match the
// interpreter (profile-form-interpreter.ts) so submitting writes User fields.
const PROFILE_QUESTIONS = [
  {
    key: "profile.pronouns",
    type: "select",
    required: true,
    data: {
      label: "Pronouns",
      options: ["she/her", "he/him", "they/them", "she/they", "he/they", "Prefer not to say", "Other"],
    },
  },
  { key: "profile.classYear", type: "text", required: true, data: { label: "Class year (e.g. 2027)" } },
  { key: "profile.major", type: "text", required: true, data: { label: "Major" } },
  { key: "profile.hometown", type: "text", required: false, data: { label: "Hometown" } },
  { key: "profile.githubUsername", type: "text", required: false, data: { label: "GitHub username" } },
  { key: "profile.linkedinUrl", type: "text", required: false, data: { label: "LinkedIn URL" } },
  // College / personal info collected at onboarding. College email is omitted
  // intentionally — it's already on file (dartmouthEmail) from the application.
  {
    key: "profile.nameOnFile",
    type: "text",
    required: false,
    data: { label: "Name on file with the College (if different from above)" },
  },
  { key: "profile.collegeId", type: "text", required: true, data: { label: "College ID number" } },
  { key: "profile.phoneNumber", type: "text", required: true, data: { label: "Phone number" } },
  {
    key: "profile.birthday",
    type: "text",
    required: true,
    data: { label: "Birthday (YYYY-MM-DD)" },
  },
  {
    key: "profile.ethnicity",
    type: "select",
    required: false,
    data: {
      label: "Ethnicity",
      options: [
        "American Indian or Alaska Native",
        "Asian",
        "Black or African American",
        "Hispanic or Latino",
        "Native Hawaiian or Other Pacific Islander",
        "White",
        "Two or more races",
        "Prefer not to say",
        "Other",
      ],
    },
  },
  {
    key: "profile.dietaryRestrictions",
    type: "text",
    required: true,
    data: { label: "Dietary restrictions (write \"none\" if none)" },
  },
];

// Welcoming subtitle shown under the form heading (stored as a ProseMirror doc
// JSON string in FormVersion.intro; rendered by RichTextViewer on the fill
// page). The heading itself is the form name ("Welcome to DALI! 👋").
const PROFILE_INTRO = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "We're so glad you're here. Tell us a bit about yourself to finish setting up your account.",
        },
      ],
    },
  ],
});

function newPublicToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Create + publish the profile form, keeping its questions in sync with
// PROFILE_QUESTIONS (idempotent by name). Consumers read the LATEST version, so
// when the questions change we add a new version; otherwise nothing changes.
async function ensureProfileForm(createdById: string): Promise<void> {
  const existing = await prisma.form.findFirst({
    where: { name: NEW_MEMBER_PROFILE_FORM_NAME },
    select: {
      id: true,
      published: true,
      publicToken: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { versionNumber: true, questions: true, intro: true },
      },
    },
  });

  if (!existing) {
    await prisma.form.create({
      data: {
        name: NEW_MEMBER_PROFILE_FORM_NAME,
        createdById,
        published: true,
        publicToken: newPublicToken(),
        versions: {
          create: {
            versionNumber: 1,
            questions: PROFILE_QUESTIONS,
            intro: PROFILE_INTRO,
            createdById,
          },
        },
      },
    });
    return;
  }

  const latest = existing.versions[0];
  const drifted =
    !latest ||
    JSON.stringify(latest.questions) !== JSON.stringify(PROFILE_QUESTIONS) ||
    latest.intro !== PROFILE_INTRO;
  if (drifted) {
    await prisma.formVersion.create({
      data: {
        formId: existing.id,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        questions: PROFILE_QUESTIONS,
        intro: PROFILE_INTRO,
        createdById,
      },
    });
  }
  if (!existing.published || !existing.publicToken) {
    await prisma.form.update({
      where: { id: existing.id },
      data: { published: true, publicToken: existing.publicToken ?? newPublicToken() },
    });
  }
}

// (firstName, lastName, domain code to grant eligibility in)
const ACCEPTED = [
  { firstName: "Riley", lastName: "Chen", domainCode: "Fullstack" },
  { firstName: "Jordan", lastName: "Okafor", domainCode: "UIUX" },
  { firstName: "Sam", lastName: "Alvarez", domainCode: "PM" },
];

function emailFor(first: string, last: string): string {
  return `${first}.${last}.seed@dali.dartmouth.edu`.toLowerCase();
}

async function main() {
  // An actor to stamp promotedBy / notification author. Prefer a real admin;
  // fall back to any user so the FK is valid.
  const actor =
    (await prisma.adminMembership.findFirst({ select: { userId: true } }))
      ?.userId ??
    (await prisma.user.findFirst({ select: { id: true } }))?.id ??
    null;

  // Publish the onboarding profile form so the welcome path can attach it.
  if (actor) {
    await ensureProfileForm(actor);
    console.log(`  ✓ "${NEW_MEMBER_PROFILE_FORM_NAME}" form ensured + published`);
  }

  let seeded = 0;
  for (const person of ACCEPTED) {
    const email = emailFor(person.firstName, person.lastName);

    const domain = await prisma.domain.findUnique({
      where: { code: person.domainCode },
      select: { id: true, displayName: true },
    });
    if (!domain) {
      console.warn(`  ⊘ domain "${person.domainCode}" not found — run the v0-reference seed first. Skipping ${person.firstName}.`);
      continue;
    }

    // Upsert the user (idempotent by daliEmail).
    const user = await prisma.user.upsert({
      where: { daliEmail: email },
      update: { firstName: person.firstName, lastName: person.lastName },
      create: {
        firstName: person.firstName,
        lastName: person.lastName,
        daliEmail: email,
      },
      select: { id: true, firstName: true },
    });

    // Promote to member + grant P1 eligibility (same as accepted release).
    // promoteToMember leaves onboardedAt null for a new member, so the layout
    // gate will route them through /onboarding.
    await promoteToMember({
      userId: user.id,
      domainId: domain.id,
      level: "P1",
      actorId: actor ?? user.id,
    });

    // Run the real welcome path: form-backed profile todo + welcome email
    // (redirected to the override inbox).
    const { notified, emailSent } = await sendWelcome({
      userId: user.id,
      actorId: actor ?? user.id,
      firstName: user.firstName,
      email, // overridden by welcome.server to the test inbox
    });

    console.log(
      `  ✓ ${person.firstName} ${person.lastName} — member + ${domain.displayName} P1; ` +
        `welcome notified=${notified}, emailSent=${emailSent}`,
    );
    seeded++;
  }

  console.log(`\nSeeded ${seeded}/${ACCEPTED.length} accepted applicants (needing onboarding).`);
  if (seeded > 0) {
    console.log("Log in as one of them (or check the override inbox) to see the onboarding flow.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
