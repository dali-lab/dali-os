// Indexes the applications@ Shared inbox for the hiring review pages. Thin
// wrapper over the generalized runSharedInboxIndex (app/jobs/shared-inbox-index.server.ts),
// which also backs the partners@ index job.

import type { JobContext, JobResult } from "~/jobs/registry";
import { APPLICATIONS_FROM_EMAIL } from "~/lib/app-env";
import { runSharedInboxIndex } from "~/jobs/shared-inbox-index.server";

export async function runApplicantEmailIndex(ctx: JobContext): Promise<JobResult> {
  return runSharedInboxIndex(APPLICATIONS_FROM_EMAIL, ctx);
}
