import {
  ClipboardList,
  Clock,
  Files,
  Globe,
  HardDrive,
  LayoutGrid,
  Mic,
  RotateCw,
  UserPlus,
} from "lucide-react";
import type { AreaPill } from "~/components/AreaPillNav";

// The hiring area's top-level surfaces as an AreaPillNav, mirroring the old
// sidebar sections' role gates (the sidebar now carries a single Hiring entry
// that lands on the /hiring hub). Email templates live in Admin → Email Templates.
export function hiringPills(args: {
  isCore: boolean;
  isDomainLead: boolean;
  isAdmin: boolean;
  isInterviewer: boolean;
  active:
    | "hub"
    | "reviews"
    | "interviews"
    | "applications"
    | "domain"
    | "cycles"
    | "waitlists"
    | "onboarding"
    | "library";
}): AreaPill[] {
  const { isCore, isDomainLead, isInterviewer, active } = args;
  return [
    { label: "Hub", to: "/hiring", active: active === "hub", icon: LayoutGrid },
    {
      label: "Reviews",
      to: "/hiring/reviewer",
      active: active === "reviews",
      icon: ClipboardList,
    },
    ...(isInterviewer
      ? [
          {
            label: "Interviews",
            to: "/hiring/interviews",
            active: active === "interviews",
            icon: Mic,
          },
        ]
      : []),
    {
      label: "Applications",
      to: "/hiring/applications",
      active: active === "applications",
      icon: Files,
    },
    ...(isDomainLead
      ? [
          {
            label: "Domain",
            to: "/hiring/domain-lead",
            active: active === "domain",
            icon: Globe,
          },
        ]
      : []),
    // Rubrics, agreements and challenge/application forms live in the Hiring
    // drive; this pill opens it (embedded at /hiring/library).
    ...(isCore || isDomainLead
      ? [
          {
            label: "Drive",
            to: "/hiring/library",
            active: active === "library",
            icon: HardDrive,
          },
        ]
      : []),
    ...(isCore
      ? [
          { label: "Cycles", to: "/hiring/lead", active: active === "cycles", icon: RotateCw },
          {
            label: "Waitlists",
            to: "/hiring/waitlists",
            active: active === "waitlists",
            icon: Clock,
          },
          {
            label: "Onboarding",
            to: "/hiring/onboarding",
            active: active === "onboarding",
            icon: UserPlus,
          },
        ]
      : []),
  ];
}
