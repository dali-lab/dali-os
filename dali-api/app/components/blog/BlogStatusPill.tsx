import type { BlogStatus } from "~/lib/blog-post.server";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";

const STATUS = {
  published: { dot: "success", label: "Published" },
  review: { dot: "warning", label: "In review" },
  draft: { dot: "neutral", label: "Draft" },
} as const;

export function BlogStatusPill({ status }: { status: BlogStatus }) {
  return <Pill dot={STATUS[status].dot}>{STATUS[status].label}</Pill>;
}
