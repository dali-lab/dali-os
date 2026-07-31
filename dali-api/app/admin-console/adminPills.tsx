import {
  Activity,
  BarChart3,
  Clock,
  FileText,
  FileSignature,
  ClipboardCheck,
  Globe,
  LayoutGrid,
  Mail,
  Megaphone,
  Receipt,
  Shield,
  UserPlus,
} from "lucide-react";
import type { AreaPill } from "~/components/AreaPillNav";

// The Admin area's tools (the sidebar entry is childless and lands on the
// hub). Every admin page is already Core-gated, so Core tools always show;
// Admin-only tools are appended when isAdmin.
export function adminPills(args: {
  isAdmin: boolean;
  active:
    | "hub"
    | "members"
    | "domains"
    | "announcements"
    | "attendance"
    | "activity"
    | "analytics"
    | "jobs"
    | "email-senders"
    | "email-templates"
    | "agreements"
    | "payroll"
    | "payroll-reconcile";
}): AreaPill[] {
  return [
    { label: "Hub", to: "/admin-console", active: args.active === "hub", icon: LayoutGrid },
    {
      label: "Roles & Permissions",
      to: "/admin-console/members",
      active: args.active === "members",
      icon: Shield,
    },
    {
      label: "Domains",
      to: "/admin-console/domains",
      active: args.active === "domains",
      icon: Globe,
    },
    {
      label: "Announcements",
      to: "/admin-console/announcements",
      active: args.active === "announcements",
      icon: Megaphone,
    },
    // Core-visible: hiring leads and other Core members author the shared
    // email templates; only sender accounts are Admin-only.
    {
      label: "Email Templates",
      to: "/admin-console/email-templates",
      active: args.active === "email-templates",
      icon: FileText,
    },
    // Document signing: author agreements (membership, mentorship,
    // confidentiality), place fields, and track signatories. Core-visible.
    {
      label: "Agreements",
      to: "/admin-console/agreements",
      active: args.active === "agreements",
      icon: FileSignature,
    },
    {
      label: "Attendance",
      to: "/admin-console/attendance",
      active: args.active === "attendance",
      icon: ClipboardCheck,
    },
    ...(args.isAdmin
      ? [
          {
            label: "Activity",
            to: "/admin-console/activity",
            active: args.active === "activity",
            icon: Activity,
          },
          {
            label: "Analytics",
            to: "/admin-console/analytics",
            active: args.active === "analytics",
            icon: BarChart3,
          },
          {
            label: "Jobs",
            to: "/admin-console/jobs",
            active: args.active === "jobs",
            icon: Clock,
          },
          {
            label: "Email Senders",
            to: "/admin-console/email-senders",
            active: args.active === "email-senders",
            icon: Mail,
          },
          {
            label: "Payroll: Hire Setup",
            to: "/admin-console/payroll-export",
            active: args.active === "payroll",
            icon: UserPlus,
          },
          {
            label: "Payroll: Reconcile",
            to: "/admin-console/payroll",
            active: args.active === "payroll-reconcile",
            icon: Receipt,
          },
        ]
      : []),
  ];
}
