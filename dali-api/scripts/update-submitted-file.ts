// Swap the file attached to a question on an ALREADY-SUBMITTED application.
// Use when an applicant submitted on time but later asks to update a PDF
// (typo, wrong version, missing pages, etc.).
//
// SAFETY: defaults to preview mode. Pass --execute to actually write.
//
// Behavior:
//   * Refuses to run unless the application is already Submitted. (If you
//     want to submit + attach in one go on a never-submitted app, use
//     manual-submit.ts instead.)
//   * Uploads the new file to a fresh S3 key. The old S3 object is left in
//     place — we never delete prior uploads, in case of mistakes.
//   * Patches the target's answers JSON to point at the new key.
//   * Does NOT create a new ApplicationStatusUpdate row — status stays Submitted.
//
// Single:
//   tsx --env-file .env scripts/update-submitted-file.ts \
//     --app <applicationId> \
//     --pdf <path/to/file.pdf> \
//     [--question <questionKey>] \
//     [--domain-app <domainApplicationId>] \
//     [--execute]
//
// Batch (CSV: application_id,pdf_path,question_key,domain_application_id):
//   tsx --env-file .env scripts/update-submitted-file.ts --csv batch.csv [--execute]

import { readFileSync, existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

type Args = {
  app?: string;
  pdf?: string;
  question?: string;
  domainApp?: string;
  csv?: string;
  execute: boolean;
};

type Row = {
  applicationId: string;
  pdfPath: string;
  questionKey?: string;
  domainApplicationId?: string;
};

type Question = {
  key: string;
  type: string;
  required: boolean;
  data: { label: string; accept?: string };
};

function parseArgs(argv: string[]): Args {
  const out: Args = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app") out.app = argv[++i];
    else if (a === "--pdf") out.pdf = argv[++i];
    else if (a === "--question") out.question = argv[++i];
    else if (a === "--domain-app") out.domainApp = argv[++i];
    else if (a === "--csv") out.csv = argv[++i];
    else if (a === "--execute") out.execute = true;
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

function inferContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

function readCsv(path: string): Row[] {
  const text = readFileSync(path, "utf8").trim();
  const lines = text.split(/\r?\n/);
  const header = lines.shift()?.split(",").map(s => s.trim());
  if (!header) throw new Error("Empty CSV");
  const idx = (name: string) => header.indexOf(name);
  const iApp = idx("application_id");
  const iPdf = idx("pdf_path");
  const iQ = idx("question_key");
  const iDa = idx("domain_application_id");
  if (iApp < 0 || iPdf < 0) {
    throw new Error("CSV must have columns: application_id, pdf_path [, question_key, domain_application_id]");
  }
  return lines.filter(l => l.trim()).map(line => {
    const cols = line.split(",").map(s => s.trim());
    return {
      applicationId: cols[iApp],
      pdfPath: cols[iPdf],
      questionKey: iQ >= 0 ? cols[iQ] || undefined : undefined,
      domainApplicationId: iDa >= 0 ? cols[iDa] || undefined : undefined,
    };
  });
}

const args = parseArgs(process.argv.slice(2));

const rows: Row[] = args.csv
  ? readCsv(args.csv)
  : args.app && args.pdf
    ? [{ applicationId: args.app, pdfPath: args.pdf, questionKey: args.question, domainApplicationId: args.domainApp }]
    : (() => { console.error("Pass either --csv <file> or --app <id> --pdf <path>"); process.exit(2); })();

// Some env loaders (tsx --env-file in particular) don't strip surrounding
// quotes the way dotenv proper does. AWS SDK validates credential format
// strictly, so quoted values like "AKIA..." get rejected with an opaque
// "Resolved credential object is not valid" error. Strip defensively.
function unquote(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

const DATABASE_URL = unquote(process.env.DATABASE_URL);
const AWS_REGION = unquote(process.env.AWS_REGION);
const AWS_S3_BUCKET = unquote(process.env.AWS_S3_BUCKET);
const AWS_ACCESS_KEY_ID = unquote(process.env.AWS_ACCESS_KEY_ID);
const AWS_SECRET_ACCESS_KEY = unquote(process.env.AWS_SECRET_ACCESS_KEY);

if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(2); }
if (!AWS_S3_BUCKET) { console.error("AWS_S3_BUCKET not set"); process.exit(2); }
if (!AWS_REGION) { console.error("AWS_REGION not set"); process.exit(2); }
if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) { console.error("AWS credentials not set"); process.exit(2); }

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
const s3 = new S3Client({
  region: AWS_REGION,
  credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
});

console.log(`Mode: ${args.execute ? "EXECUTE (will write)" : "PREVIEW (no writes)"}`);
console.log(`DB: ${DATABASE_URL.split("@")[1]?.split("/")[0] ?? "?"}`);
console.log(`S3 bucket: ${AWS_S3_BUCKET}`);
console.log(`Rows to process: ${rows.length}`);
console.log();

let ok = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  const label = `[${row.applicationId}]`;
  try {
    if (!existsSync(row.pdfPath)) throw new Error(`PDF not found: ${row.pdfPath}`);

    const app = await prisma.application.findUnique({
      where: { id: row.applicationId },
      select: {
        id: true,
        answers: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        generalChallengeVersion: { select: { questions: true } },
        domainApplications: {
          select: {
            id: true,
            answers: true,
            challengeVersion: {
              select: {
                questions: true,
                domain: { select: { name: true } },
              },
            },
          },
        },
        statusUpdates: { where: { newStatus: "Submitted" }, take: 1, select: { id: true } },
      },
    });
    if (!app) throw new Error("Application not found");

    if (app.statusUpdates.length === 0) {
      console.log(`${label} SKIP — not Submitted (${app.user.firstName} ${app.user.lastName}). Use manual-submit.ts instead.`);
      skipped++;
      continue;
    }

    let targetLabel: string;
    let questions: Question[];
    let currentAnswers: Record<string, string>;
    let updateTarget: { kind: "app"; id: string } | { kind: "da"; id: string };

    if (row.domainApplicationId) {
      const da = app.domainApplications.find(d => d.id === row.domainApplicationId);
      if (!da) throw new Error(`DomainApplication ${row.domainApplicationId} not on this app`);
      questions = (da.challengeVersion.questions as unknown as Question[]) ?? [];
      currentAnswers = (da.answers as Record<string, string>) ?? {};
      targetLabel = `DomainApplication (${da.challengeVersion.domain?.name ?? "?"})`;
      updateTarget = { kind: "da", id: da.id };
    } else {
      questions = (app.generalChallengeVersion.questions as unknown as Question[]) ?? [];
      currentAnswers = (app.answers as Record<string, string>) ?? {};
      targetLabel = "general application";
      updateTarget = { kind: "app", id: app.id };
    }

    const fileQuestions = questions.filter(q => q.type === "file");
    if (fileQuestions.length === 0) {
      throw new Error(`No file-type questions on ${targetLabel}`);
    }
    let question: Question;
    if (row.questionKey) {
      const found = fileQuestions.find(q => q.key === row.questionKey);
      if (!found) throw new Error(`No file question with key ${row.questionKey} on ${targetLabel}`);
      question = found;
    } else if (fileQuestions.length === 1) {
      question = fileQuestions[0];
    } else {
      throw new Error(
        `${targetLabel} has multiple file questions — pass --question:\n` +
        fileQuestions.map(q => `  ${q.key}  ${q.data.label}`).join("\n"),
      );
    }

    const fileBytes = readFileSync(row.pdfPath);
    const contentType = inferContentType(row.pdfPath);
    const s3Key = `uploads/applications/${question.key}/${randomUUID()}-${basename(row.pdfPath)}`;
    const previousKey = currentAnswers[question.key];

    console.log(`${label} ${app.user.firstName} ${app.user.lastName}`);
    console.log(`  target: ${targetLabel}`);
    console.log(`  question: ${question.data.label} (${question.key})`);
    console.log(`  file: ${row.pdfPath} → s3://${AWS_S3_BUCKET}/${s3Key} (${contentType}, ${fileBytes.byteLength} bytes)`);
    console.log(`  replacing prior key: ${previousKey ? `"${previousKey}" (kept in S3 for safety)` : "(none — answer was empty before)"}`);
    console.log(`  status stays: Submitted (no new status row written)`);

    if (!args.execute) {
      console.log(`  PREVIEW — no writes`);
      ok++;
      console.log();
      continue;
    }

    await s3.send(new PutObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: s3Key,
      Body: fileBytes,
      ContentType: contentType,
    }));

    const nextAnswers = { ...currentAnswers, [question.key]: s3Key };
    if (updateTarget.kind === "app") {
      await prisma.application.update({ where: { id: updateTarget.id }, data: { answers: nextAnswers } });
    } else {
      await prisma.domainApplication.update({ where: { id: updateTarget.id }, data: { answers: nextAnswers } });
    }

    console.log(`  ✓ EXECUTED`);
    ok++;
  } catch (err) {
    console.error(`${label} FAIL — ${(err as Error).message}`);
    failed++;
  }
  console.log();
}

console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
await prisma.$disconnect();
