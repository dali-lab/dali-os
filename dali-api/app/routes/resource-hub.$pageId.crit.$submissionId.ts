import type { Route } from "./+types/resource-hub.$pageId.crit.$submissionId";
import { prisma } from "~/lib/db.server";
import { loadCritContext, parseCommentForm, serializeComments, serializeSubmission } from "~/lib/crit.server";

const person = { select: { firstName: true, lastName: true } };

async function load(request: Request, params: Route.LoaderArgs["params"]) {
  const ctx = await loadCritContext(request, params.pageId!);
  const submission = await prisma.critSubmission.findFirst({
    where: { id: params.submissionId, domainId: ctx.domainId },
    include: { author: person, _count: { select: { comments: true } } },
  });
  if (!submission) throw new Response("Not found", { status: 404 });
  return { ctx, submission };
}

async function payload(ctx: Awaited<ReturnType<typeof load>>["ctx"], submissionId: string) {
  const [submission, comments] = await Promise.all([
    prisma.critSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: { author: person, _count: { select: { comments: true } } } }),
    prisma.critComment.findMany({ where: { submissionId }, include: { author: person }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    submission: serializeSubmission(submission, ctx.userId, ctx.canModerate),
    comments: serializeComments(comments, ctx.userId, ctx.canModerate),
  };
}

// GET: the submission and its comments.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { ctx, submission } = await load(request, params);
  return Response.json(await payload(ctx, submission.id));
}

// POST: add a comment (pinned, general or a reply) or delete one.
export async function action({ request, params }: Route.ActionArgs) {
  const { ctx, submission } = await load(request, params);
  const form = await request.formData();

  if (form.get("intent") === "comment") {
    const parsed = parseCommentForm(form);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    const { body, x, y, parentId } = parsed.value;
    if (parentId) {
      const parent = await prisma.critComment.findFirst({ where: { id: parentId, submissionId: submission.id, parentId: null }, select: { id: true } });
      if (!parent) return Response.json({ error: "That comment is gone." }, { status: 400 });
    }
    await prisma.critComment.create({ data: { submissionId: submission.id, authorId: ctx.userId, body, x, y, parentId } });
    return Response.json(await payload(ctx, submission.id));
  }

  if (form.get("intent") === "delete-comment") {
    const comment = await prisma.critComment.findFirst({ where: { id: String(form.get("commentId") ?? ""), submissionId: submission.id }, select: { id: true, authorId: true } });
    if (!comment) return Response.json({ error: "Not found" }, { status: 404 });
    if (comment.authorId !== ctx.userId && !ctx.canModerate) return Response.json({ error: "Forbidden" }, { status: 403 });
    await prisma.critComment.delete({ where: { id: comment.id } });
    return Response.json(await payload(ctx, submission.id));
  }

  return Response.json({ error: "Bad request" }, { status: 400 });
}
