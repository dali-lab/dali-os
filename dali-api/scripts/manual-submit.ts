// Manually submit an application after the cycle has closed, optionally
// attaching a PDF to a file-type question and/or patching in text answers
// transcribed from an emailed submission. Use for one-off exceptions when
// reopening the cycle isn't desirable.
//
// SAFETY: defaults to preview mode. Pass --execute to actually write.
//
// Single (any combination of --pdf / --general-answers / --domain-answers):
//   tsx --env-file .env scripts/manual-submit.ts \
//     --app <applicationId> \
//     [--pdf <path/to/file.pdf>] \
//     [--question <questionKey>] \
//     [--domain-app <domainApplicationId>] \
//     [--general-answers <general-answers.json>] \
//     [--domain-answers <domain-answers.json>] \
//     [--execute]
//
// Batch (CSV; supports --pdf only, not text answer JSONs):
//   columns: application_id,pdf_path,question_key,domain_application_id
//   tsx --env-file .env scripts/manual-submit.ts --csv batch.csv [--execute]
//
// Answer JSON shape: { "<question-key>": "<answer text>", ... }
// Only the listed keys are merged; existing answers under other keys survive.
// Unknown keys (not present on the target challenge version's questions) cause
// the row to fail — fix the JSON or use the right --domain-app.
//
// Notes:
//   * --question is required when the target challenge version has more than
//     one file-type question. Otherwise the script auto-picks the only one.
//   * --domain-app targets a DomainApplication. When set, --pdf attaches to
//     that DomainApplication's file question, and --domain-answers merges
//     into that DomainApplication's answers.
//   * --general-answers always merges into the general Application's answers.
//   * At least one of --pdf / --general-answers / --domain-answers must be
//     provided.
//   * Content type is inferred from file extension. PDFs get "application/pdf".
//   * Confirmation emails are NOT sent — handle that separately so this stays
//     safe to re-run.
//   * Skips applications that already have a Submitted status update (idempotent).

import { readFileSync, existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

type DomainAnswersSpec = { daId?: string; path: string };

type Args = {
  app?: string;
  pdf?: string;
  question?: string;
  domainApp?: string;
  csv?: string;
  generalAnswers?: string;
  domainAnswers: DomainAnswersSpec[];
  execute: boolean;
};

type Row = {
  applicationId: string;
  pdfPath?: string;
  questionKey?: string;
  domainApplicationId?: string;
  generalAnswersPath?: string;
  domainAnswers: DomainAnswersSpec[];
};

type Question = {
  key: string;
  type: string;
  required: boolean;
  data: { label: string; accept?: string };
};

function parseArgs(argv: string[]): Args {
  const out: Args = { execute: false, domainAnswers: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app") out.app = argv[++i];
    else if (a === "--pdf") out.pdf = argv[++i];
    else if (a === "--question") out.question = argv[++i];
    else if (a === "--domain-app") out.domainApp = argv[++i];
    else if (a === "--csv") out.csv = argv[++i];
    else if (a === "--general-answers") out.generalAnswers = argv[++i];
    else if (a === "--domain-answers") {
      // Repeatable. Accepts either "<path>" (pairs with --domain-app) or
      // "<da_id>=<path>" (explicit target — required for multi-domain runs).
      const v = argv[++i];
      const eq = v.indexOf("=");
      if (eq > 0) out.domainAnswers.push({ daId: v.slice(0, eq), path: v.slice(eq + 1) });
      else out.domainAnswers.push({ path: v });
    }
    else if (a === "--execute") out.execute = true;
    else if (a === "--help" || a === "-h") {
      console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(0, 30).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
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
      domainAnswers: [],
    };
  });
}

const args = parseArgs(process.argv.slice(2));

const rows: Row[] = args.csv
  ? readCsv(args.csv)
  : args.app && (args.pdf || args.generalAnswers || args.domainAnswers.length > 0)
    ? [{
        applicationId: args.app,
        pdfPath: args.pdf,
        questionKey: args.question,
        domainApplicationId: args.domainApp,
        generalAnswersPath: args.generalAnswers,
        domainAnswers: args.domainAnswers,
      }]
    : (() => {
        console.error("Pass --csv <file> OR --app <id> with at least one of --pdf / --general-answers / --domain-answers");
        process.exit(2);
      })();

// Bare --domain-answers (no <da_id>=) need a fallback target via --domain-app.
if (args.domainAnswers.some(d => !d.daId) && !args.domainApp) {
  console.error("--domain-answers without <da_id>= requires --domain-app, or use --domain-answers <da_id>=<path>");
  process.exit(2);
}

function readAnswerJson(path: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${path}: expected a JSON object of question_key → answer`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") throw new Error(`${path}: answer for "${k}" must be a string`);
    out[k] = v;
  }
  return out;
}

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

function truncate(s: string, max = 60): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

let pendingUpload: { key: string; bytes: Buffer; contentType: string } | undefined;
let ok = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  const label = `[${row.applicationId}]`;
  try {
    if (row.pdfPath && !existsSync(row.pdfPath)) throw new Error(`PDF not found: ${row.pdfPath}`);
    if (row.generalAnswersPath && !existsSync(row.generalAnswersPath)) throw new Error(`general answers JSON not found: ${row.generalAnswersPath}`);
    for (const da of row.domainAnswers) {
      if (!existsSync(da.path)) throw new Error(`domain answers JSON not found: ${da.path}`);
    }

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

    if (app.statusUpdates.length > 0) {
      console.log(`${label} SKIP — already Submitted (${app.user.firstName} ${app.user.lastName})`);
      skipped++;
      continue;
    }

    console.log(`${label} ${app.user.firstName} ${app.user.lastName}`);

    type DA = typeof app.domainApplications[number];
    type DaState = { da: DA; next: Record<string, string>; changed: boolean };

    // ─── 1. Resolve fallback target DomainApplication (for --pdf and bare --domain-answers) ──
    let fallbackDa: DA | undefined;
    if (row.domainApplicationId) {
      fallbackDa = app.domainApplications.find(d => d.id === row.domainApplicationId);
      if (!fallbackDa) throw new Error(`DomainApplication ${row.domainApplicationId} not on this app`);
    }

    const generalQuestions = (app.generalChallengeVersion.questions as unknown as Question[]) ?? [];
    const generalAnswers: Record<string, string> = (app.answers as Record<string, string>) ?? {};

    let nextGeneralAnswers = generalAnswers;
    let generalChanged = false;

    // DomainApplication-id → in-flight state. Built lazily as we touch DAs.
    const daStates = new Map<string, DaState>();
    function getDaState(da: DA): DaState {
      let s = daStates.get(da.id);
      if (!s) {
        s = { da, next: (da.answers as Record<string, string>) ?? {}, changed: false };
        daStates.set(da.id, s);
      }
      return s;
    }

    // ─── 2. PDF upload (optional) ──────────────────────────────────────────
    let s3Key: string | undefined;
    if (row.pdfPath) {
      const pdfTargetIsDa = !!fallbackDa;
      const pdfDaQuestions = fallbackDa ? ((fallbackDa.challengeVersion.questions as unknown as Question[]) ?? []) : [];
      const targetLabel = pdfTargetIsDa
        ? `DomainApplication (${fallbackDa!.challengeVersion.domain?.name ?? "?"})`
        : "general application";
      const fileQs = (pdfTargetIsDa ? pdfDaQuestions : generalQuestions).filter(q => q.type === "file");
      if (fileQs.length === 0) throw new Error(`No file-type questions on ${targetLabel}`);

      let question: Question;
      if (row.questionKey) {
        const found = fileQs.find(q => q.key === row.questionKey);
        if (!found) throw new Error(`No file question with key ${row.questionKey} on ${targetLabel}`);
        question = found;
      } else if (fileQs.length === 1) {
        question = fileQs[0];
      } else {
        throw new Error(
          `${targetLabel} has multiple file questions — pass --question:\n` +
          fileQs.map(q => `  ${q.key}  ${q.data.label}`).join("\n"),
        );
      }

      const fileBytes = readFileSync(row.pdfPath);
      const contentType = inferContentType(row.pdfPath);
      s3Key = `uploads/applications/${question.key}/${randomUUID()}-${basename(row.pdfPath)}`;
      const priorRecord = pdfTargetIsDa
        ? ((fallbackDa!.answers as Record<string, string>) ?? {})
        : generalAnswers;
      const prior = priorRecord[question.key];

      console.log(`  PDF → ${targetLabel}`);
      console.log(`    question: ${question.data.label} (${question.key})`);
      console.log(`    file: ${row.pdfPath} → s3://${AWS_S3_BUCKET}/${s3Key} (${contentType}, ${fileBytes.byteLength} bytes)`);
      console.log(`    replacing prior: ${prior ? `"${prior}"` : "(none)"}`);

      if (pdfTargetIsDa) {
        const s = getDaState(fallbackDa!);
        s.next = { ...s.next, [question.key]: s3Key };
        s.changed = true;
      } else {
        nextGeneralAnswers = { ...nextGeneralAnswers, [question.key]: s3Key };
        generalChanged = true;
      }

      // Defer the actual S3 upload to the --execute branch below so PREVIEW
      // doesn't touch S3. Keep the bytes around so we can write them.
      pendingUpload = { key: s3Key, bytes: fileBytes, contentType };
    }

    // ─── 3. General text answers (optional) ────────────────────────────────
    if (row.generalAnswersPath) {
      const patch = readAnswerJson(row.generalAnswersPath);
      const known = new Set(generalQuestions.map(q => q.key));
      const unknown = Object.keys(patch).filter(k => !known.has(k));
      if (unknown.length > 0) {
        throw new Error(`general-answers contains unknown question keys: ${unknown.join(", ")}`);
      }
      console.log(`  general answers patch (${Object.keys(patch).length} keys):`);
      for (const [k, v] of Object.entries(patch)) {
        const q = generalQuestions.find(qq => qq.key === k);
        const before = nextGeneralAnswers[k];
        console.log(`    ${q?.data.label ?? k}: ${before ? `"${truncate(before)}"` : "(empty)"} → "${truncate(v)}"`);
      }
      nextGeneralAnswers = { ...nextGeneralAnswers, ...patch };
      generalChanged = true;
    }

    // ─── 4. Domain text answers (optional, repeatable) ─────────────────────
    for (const spec of row.domainAnswers) {
      const targetDa = spec.daId
        ? app.domainApplications.find(d => d.id === spec.daId)
        : fallbackDa;
      if (!targetDa) {
        throw new Error(spec.daId
          ? `DomainApplication ${spec.daId} not on this app`
          : `--domain-answers ${spec.path} has no target — pass --domain-app or use <da_id>=<path>`);
      }
      const patch = readAnswerJson(spec.path);
      const daQs = (targetDa.challengeVersion.questions as unknown as Question[]) ?? [];
      const known = new Set(daQs.map(q => q.key));
      const unknown = Object.keys(patch).filter(k => !known.has(k));
      if (unknown.length > 0) {
        throw new Error(`${spec.path}: unknown question keys for ${targetDa.challengeVersion.domain?.name}: ${unknown.join(", ")}`);
      }
      const state = getDaState(targetDa);
      console.log(`  domain answers patch (${Object.keys(patch).length} keys) → ${targetDa.challengeVersion.domain?.name}:`);
      for (const [k, v] of Object.entries(patch)) {
        const q = daQs.find(qq => qq.key === k);
        const before = state.next[k];
        console.log(`    ${q?.data.label ?? k}: ${before ? `"${truncate(before)}"` : "(empty)"} → "${truncate(v)}"`);
      }
      state.next = { ...state.next, ...patch };
      state.changed = true;
    }

    console.log(`  will create ApplicationStatusUpdate(Submitted) attributed to user ${app.user.id}`);

    if (!args.execute) {
      console.log(`  PREVIEW — no writes`);
      ok++;
      pendingUpload = undefined;
      console.log();
      continue;
    }

    // ─── 5. Execute: S3 upload (if any) then DB transaction ────────────────
    if (pendingUpload) {
      await s3.send(new PutObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: pendingUpload.key,
        Body: pendingUpload.bytes,
        ContentType: pendingUpload.contentType,
      }));
      pendingUpload = undefined;
    }

    await prisma.$transaction(async tx => {
      if (generalChanged) {
        await tx.application.update({ where: { id: app.id }, data: { answers: nextGeneralAnswers } });
      }
      for (const state of daStates.values()) {
        if (state.changed) {
          await tx.domainApplication.update({ where: { id: state.da.id }, data: { answers: state.next } });
        }
      }
      await tx.applicationStatusUpdate.create({
        data: { newStatus: "Submitted", applicationId: app.id, userId: app.user.id },
      });
    });

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
