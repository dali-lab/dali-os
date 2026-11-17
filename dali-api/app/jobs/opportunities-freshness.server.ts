import type { JobContext, JobResult } from "~/jobs/registry";

export async function runOpportunitiesFreshness(_ctx: JobContext): Promise<JobResult> {
  return { items: 0 };
}
