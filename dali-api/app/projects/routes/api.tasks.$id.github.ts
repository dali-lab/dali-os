import type { Route } from "./+types/api.tasks.$id.github";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { githubAppClient, parseRepo, isNotFound } from "~/lib/github";
import { normalizeRepo } from "../lib/github-task-sync";

// POST   /api/tasks/:id/github — link an EXISTING GitHub issue to a task
//        that isn't mirrored yet. Body: { repo, issueNumber }. `repo` must be
//        one of the project's repoUrls (same validation as MCP
//        link_task_to_github) and the issue must actually exist — checked
//        against the GitHub API before the link is written. Unlike the
//        create-flow mirror toggle, this never creates an issue.
// DELETE /api/tasks/:id/github — unlink. Mirrors MCP unlink_task_from_github:
//        clears the three mirror fields; the GH issue itself is untouched.
//
// Permission model mirrors the other task routes (Core or project member).

type PostBody = { repo: string; issueNumber: number };

function isPostBody(x: unknown): x is PostBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.repo === "string" &&
    typeof o.issueNumber === "number" &&
    Number.isInteger(o.issueNumber) &&
    o.issueNumber > 0
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      projectId: true,
      githubIssueNumber: true,
      project: { select: { repoUrls: true } },
    },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, task.projectId);
  if (!gate.ok) return gate.response;

  if (request.method === "DELETE") {
    if (task.githubIssueNumber === null) {
      return withCors(request, Response.json({ ok: true, noop: true }));
    }
    await prisma.task.update({
      where: { id: params.id },
      data: { githubRepo: null, githubIssueNumber: null, githubIssueUrl: null },
    });
    return withCors(request, Response.json({ ok: true }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isPostBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  if (task.githubIssueNumber !== null) {
    return withCors(
      request,
      Response.json({ error: "Task is already linked to a GitHub issue" }, { status: 400 }),
    );
  }

  const normalized = normalizeRepo(body.repo);
  if (!normalized) {
    return withCors(request, Response.json({ error: "Invalid repo" }, { status: 400 }));
  }
  const allowed = task.project.repoUrls
    .map(normalizeRepo)
    .filter((r): r is string => !!r);
  if (!allowed.includes(normalized)) {
    return withCors(
      request,
      Response.json({ error: "Repo is not one of the project's repoUrls" }, { status: 400 }),
    );
  }

  // (githubRepo, githubIssueNumber) is unique across tasks — surface the
  // conflict up front instead of letting the constraint violation 500.
  const alreadyLinked = await prisma.task.findFirst({
    where: { githubRepo: normalized, githubIssueNumber: body.issueNumber },
    select: { id: true },
  });
  if (alreadyLinked) {
    return withCors(
      request,
      Response.json({ error: "Another task is already linked to that issue" }, { status: 409 }),
    );
  }

  const { owner, repo } = parseRepo(normalized, "api.tasks.$id.github");
  let issueUrl: string;
  try {
    const res = await githubAppClient().rest.issues.get({
      owner,
      repo,
      issue_number: body.issueNumber,
    });
    issueUrl = res.data.html_url;
  } catch (err) {
    if (isNotFound(err)) {
      return withCors(
        request,
        Response.json(
          { error: `Issue #${body.issueNumber} not found in ${normalized}` },
          { status: 400 },
        ),
      );
    }
    console.error(`task ${params.id}: github issue lookup failed`, err);
    return withCors(
      request,
      Response.json({ error: "GitHub lookup failed" }, { status: 502 }),
    );
  }

  await prisma.task.update({
    where: { id: params.id },
    data: {
      githubRepo: normalized,
      githubIssueNumber: body.issueNumber,
      githubIssueUrl: issueUrl,
    },
  });

  return withCors(
    request,
    Response.json({
      ok: true,
      githubRepo: normalized,
      githubIssueNumber: body.issueNumber,
      githubIssueUrl: issueUrl,
    }),
  );
}
