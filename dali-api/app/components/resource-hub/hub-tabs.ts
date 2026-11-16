import { BookOpen, Bookmark, MessagesSquare } from "lucide-react";
import type { SegmentedTab } from "~/components/ui/SegmentedTabs";

export type HubOutletContext = { leaveGuard: { current: (() => boolean) | null } };

export function hubTabs(hubId: string, hasDomain: boolean, pathname: string): SegmentedTab[] {
  const base = `/resource-hub/${hubId}`;
  const all = [
    { label: "Resources", icon: BookOpen, href: base, active: pathname === base },
    { label: "Crit Wall", icon: MessagesSquare, href: `${base}/crit`, active: pathname.startsWith(`${base}/crit`) },
    { label: "References", icon: Bookmark, href: `${base}/references`, active: pathname.startsWith(`${base}/references`) },
  ];
  return hasDomain ? all : all.slice(0, 1);
}
