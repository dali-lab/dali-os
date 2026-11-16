import { FileText, TriangleAlert } from "lucide-react";
import { PageTabRow, type PageRowControl } from "~/components/os-page";
import type { SegmentedTab } from "~/components/ui/SegmentedTabs";

export function mentorshipTabs(pathname: string): SegmentedTab[] {
  return [
    { label: "Notes", href: "/mentorship/browse", icon: FileText, active: pathname.startsWith("/mentorship/browse") },
    { label: "Warnings", href: "/mentorship/warnings", icon: TriangleAlert, active: pathname.startsWith("/mentorship/warnings") },
  ];
}

export function MentorshipTabRow({ pathname, controls }: { pathname: string; controls?: PageRowControl[] }) {
  return <PageTabRow label="Mentorship" tabs={mentorshipTabs(pathname)} controls={controls} />;
}
