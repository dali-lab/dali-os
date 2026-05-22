// Usage: npx tsx --env-file .env scripts/applicant-answers.ts <applicationId>
// Prints the applicant's answers paired with their question prompts.

import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const id = process.argv[2];
if (!id) {
  console.error("Usage: npx tsx --env-file .env scripts/applicant-answers.ts <applicationId>");
  process.exit(1);
}

type Question = {
  key: string;
  type: string;
  required: boolean;
  data: { label?: string; description?: string; maxWords?: number; accept?: string };
};

const app = await prisma.application.findUnique({
  where: { id },
  include: {
    user: { select: { firstName: true, lastName: true, dartmouthEmail: true, daliEmail: true } },
    applicationCycle: { select: { name: true } },
    generalChallengeVersion: { select: { questions: true } },
    domainApplications: {
      include: {
        challengeVersion: {
          select: { questions: true, domain: { select: { name: true } } },
        },
      },
    },
  },
});

if (!app) {
  console.log(`No application with id ${id}`);
  await prisma.$disconnect();
  process.exit(0);
}

const email = app.user.daliEmail ?? app.user.dartmouthEmail ?? "?";
console.log(`\n=== ${app.user.firstName} ${app.user.lastName} (${email}) ===`);
console.log(`Cycle: ${app.applicationCycle.name}`);
console.log(`Application ID: ${app.id}\n`);

function renderAnswers(label: string, questions: Question[], answers: Record<string, unknown>) {
  console.log(`--- ${label} ---`);
  if (!questions || questions.length === 0) {
    console.log("(no questions)\n");
    return;
  }
  for (const q of questions) {
    const prompt = q.data?.label ?? q.key;
    const required = q.required ? " *" : "";
    const raw = answers?.[q.key];
    let display: string;
    if (raw == null || raw === "") {
      display = "(blank)";
    } else if (q.type === "file") {
      display = `[file key] ${String(raw)}`;
    } else if (typeof raw === "string") {
      display = raw.length > 600 ? raw.slice(0, 600) + "…(truncated)" : raw;
    } else {
      display = JSON.stringify(raw);
    }
    console.log(`Q (${q.type}${required}): ${prompt}`);
    console.log(`  → ${display.replace(/\n/g, "\n    ")}`);
    console.log("");
  }
}

renderAnswers(
  "General Application",
  (app.generalChallengeVersion?.questions ?? []) as Question[],
  (app.answers ?? {}) as Record<string, unknown>,
);

for (const da of app.domainApplications) {
  const dom = da.challengeVersion.domain?.name ?? "?";
  const tag = `Domain: ${dom}${da.selected ? "" : " (DESELECTED)"}`;
  renderAnswers(
    tag,
    (da.challengeVersion.questions ?? []) as Question[],
    (da.answers ?? {}) as Record<string, unknown>,
  );
}

await prisma.$disconnect();
