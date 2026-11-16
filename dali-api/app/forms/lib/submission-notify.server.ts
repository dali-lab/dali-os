import { createHash } from "node:crypto";
import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { renderEmailTemplate } from "~/email/lib/templates.server";
import { emailTemplateDef } from "~/email/lib/registry";
import { renderFramedEmail } from "~/email/lib/layout.server";
import { htmlToPlainText } from "~/lib/email";
import { EMAIL_PATTERN } from "~/forms/lib/form-answers";
import { formatDateTime } from "~/lib/display";
import type { Question } from "~/types";
import { buildResponseGrid } from "./answer-rows.server";
import { formUsages, managingUsage } from "./form-usages.server";

// Best-effort, after-commit notification to the form's creator for each new
// submission (Form.notifyOnSubmission). Callers invoke this AFTER their
// submission transaction resolves; the whole body is swallowed on failure —
// a notification hiccup must never fail a submission (same stance as the
// hiring interview-notifications helpers).
export async function notifyFormSubmission(args: {
  formId: string;
  submitterUserId?: string | null;
  // Display-name fallback for unauthenticated submissions.
  submitterName?: string | null;
}): Promise<void> {
  try {
    const form = await prisma.form.findUnique({
      where: { id: args.formId },
      select: {
        id: true,
        name: true,
        createdById: true,
        notifyOnSubmission: true,
      },
    });
    if (!form?.notifyOnSubmission) return;
    // The creator doesn't need to hear about their own submission.
    if (args.submitterUserId && args.submitterUserId === form.createdById) {
      return;
    }

    let name = args.submitterName?.trim() || "";
    if (args.submitterUserId) {
      const user = await prisma.user.findUnique({
        where: { id: args.submitterUserId },
        select: { firstName: true, lastName: true },
      });
      if (user) name = `${user.firstName} ${user.lastName}`.trim();
    }

    await notify({
      eventType: "form.submission",
      createdByUserId: args.submitterUserId ?? null,
      message: {
        vars: { itemTitle: form.name, personName: name || "Anonymous" },
        link: `/forms/edit/${form.id}?view=results`,
      },
      recipients: [{ userId: form.createdById }],
    });
  } catch {
    // Best-effort: never let a notification failure break a submission.
  }
}

const ANSWER_VALUE_MAX = 2000;

const oneLine = (text: string, max: number) =>
  text.replace(/\s+/g, " ").trim().slice(0, max);

async function answersBlock(
  versionNumber: number,
  questions: Question[],
  answers: Record<string, unknown>,
): Promise<string> {
  const { rowsBySubmission } = await buildResponseGrid([
    { formVersion: { versionNumber, questions }, answers },
  ]);
  return (rowsBySubmission[0] ?? [])
    .filter((row) => row.value !== "")
    .map((row) => `${oneLine(row.label, 200)}: ${oneLine(row.value, ANSWER_VALUE_MAX)}`)
    .join("\n");
}

// The address a public respondent typed at the form's first Email question,
// or null when there is no such question or its answer isn't a valid address.
export function receiptAddress(
  questions: Question[],
  answers: Record<string, unknown>,
): string | null {
  const question = questions.find((q) => q.type === "email");
  const raw = question ? answers[question.key] : null;
  if (typeof raw !== "string") return null;
  const address = raw.trim().toLowerCase();
  return EMAIL_PATTERN.test(address) ? address : null;
}

// Keeps the raw address out of the outbox row: a dedupKey outlives the message.
export function anonymousReceiptKey(
  formId: string,
  address: string,
  submittedAt: Date,
): string {
  const digest = createHash("sha256").update(address).digest("hex");
  return `form.receipt:${formId}:${digest}:${submittedAt.toISOString().slice(0, 10)}`;
}

// Best-effort, after-commit email copy of a response (Form.sendReceipt).
// Signed-in respondents get their answers; anyone else gets a fixed note with
// no answers, because the address was typed by an unauthenticated stranger and
// answers would let this sender deliver arbitrary text to it. Never throws.
export async function sendFormReceipt(args: {
  formId: string;
  submissionId: string;
}): Promise<void> {
  try {
    const form = await prisma.form.findUnique({
      where: { id: args.formId },
      select: { id: true, name: true, sendReceipt: true },
    });
    if (!form?.sendReceipt) return;
    // The setting is hidden on managed forms, so a stale value must not send.
    if (managingUsage(await formUsages(form.id))) return;

    const submission = await prisma.formSubmission.findUnique({
      where: { id: args.submissionId },
      select: {
        userId: true,
        answers: true,
        createdAt: true,
        formVersion: { select: { versionNumber: true, questions: true } },
      },
    });
    if (!submission) return;
    const questions = (submission.formVersion.questions as unknown as Question[]) ?? [];
    const answers = (submission.answers ?? {}) as Record<string, unknown>;
    const formName = oneLine(form.name, 200);
    const submittedAt = `${formatDateTime(submission.createdAt)} ET`;

    let target: string | null;
    let recipientUserId: string | null = null;
    let dedupKey: string | null;
    let templateKey: "forms.receipt" | "forms.receipt-public";
    let vars: Record<string, string>;
    if (submission.userId) {
      const user = await prisma.user.findUnique({
        where: { id: submission.userId },
        select: { firstName: true, daliEmail: true, personalEmail: true },
      });
      target = user?.daliEmail ?? user?.personalEmail ?? null;
      recipientUserId = submission.userId;
      dedupKey = `form.receipt:${args.submissionId}`;
      templateKey = "forms.receipt";
      vars = {
        firstName: user?.firstName ?? "",
        formName,
        submittedAt,
        answers: await answersBlock(submission.formVersion.versionNumber, questions, answers),
      };
    } else {
      target = receiptAddress(questions, answers);
      dedupKey = target
        ? anonymousReceiptKey(form.id, target, submission.createdAt)
        : null;
      templateKey = "forms.receipt-public";
      vars = { formName, submittedAt };
    }
    if (!target || !dedupKey) return;

    const rendered = await renderEmailTemplate(templateKey, vars);
    if (!rendered) return;
    const mail = renderFramedEmail(
      {
        subject: rendered.subject,
        preheader: rendered.subject,
        bodyHtml: rendered.html,
        text: htmlToPlainText(rendered.html),
      },
      { footer: emailTemplateDef(templateKey).footer },
    );
    const { id } = await enqueueOutbound({
      channel: "email",
      purpose: emailTemplateDef(templateKey).purpose,
      dedupKey,
      target,
      recipientUserId,
      subject: mail.subject,
      bodyHtml: mail.html,
      bodyText: mail.text,
      eventType: "form.receipt",
    });
    await drainNow([id]);
  } catch {
    console.error(`form receipt failed for form ${args.formId}`);
  }
}
