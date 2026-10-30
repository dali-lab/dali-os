import { prisma } from "~/lib/db.server";
import type { AdminAlertKey } from "~/admin/adminNav";

export type AttentionItem = {
  key: string;
  severity: "red" | "amber";
  title: string;
  detail: string;
  where: string;
  to: string;
  action: string;
};

export type AdminAttention = {
  counts: Record<AdminAlertKey, number>;
  items: AttentionItem[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the Overview flags and the sidebar counts: dead messages and failing jobs. */
export async function loadAdminAttention(): Promise<AdminAttention> {
  const [dead, failingJobs] = await Promise.all([
    prisma.outboundMessage.count({ where: { status: "Dead" } }),
    prisma.scheduledJob.findMany({
      where: { enabled: true, lastStatus: "Error" },
      select: { name: true, lastError: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const items: AttentionItem[] = [];
  if (dead > 0) {
    items.push({
      key: "outbox-dead",
      severity: "red",
      title: `${plural(dead, "outbound message", "outbound messages")} failed permanently`,
      detail: "They ran out of retries, so the recipients have not been notified.",
      where: "Messaging · Outbox",
      to: "/admin/messaging/outbox?status=Dead",
      action: "Review",
    });
  }
  for (const job of failingJobs) {
    items.push({
      key: `job-${job.name}`,
      severity: "red",
      title: `${job.name} is failing`,
      detail: job.lastError ? `Last error: ${job.lastError.slice(0, 200)}` : "Its last run ended in an error.",
      where: "Platform · Jobs",
      to: "/admin/platform/jobs",
      action: "Open job",
    });
  }

  return { counts: { messaging: dead, platform: failingJobs.length }, items };
}
