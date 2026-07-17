import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";

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
        title: `New response: ${form.name}`,
        body: `From ${name || "Anonymous"}`,
        link: `/forms/responses/${form.id}`,
      },
      recipients: [{ userId: form.createdById }],
    });
  } catch {
    // Best-effort: never let a notification failure break a submission.
  }
}
