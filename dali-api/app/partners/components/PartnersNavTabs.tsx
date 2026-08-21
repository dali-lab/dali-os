import { Link } from "react-router";
import { LayoutGrid, FileText } from "lucide-react";
import { cn } from "~/lib/cn";
import { useFeatureFlag } from "~/components/FeatureFlags";

// Switches between the two Partners surfaces: the organization list ("standard
// view") and the applications funnel ("pipeline"). The classic sub-nav
// (AreaPillNav) returns null under the redesign shells, and the redesign
// sidebar shows Partners as a flat leaf with no way to reach the pipeline — so
// this renders ONLY in the redesign modes to fill that gap without doubling up
// with AreaPillNav in the classic shell.
export function PartnersNavTabs({
  active,
}: {
  active: "organizations" | "pipeline";
}) {
  const redesign =
    useFeatureFlag("os-redesign") || useFeatureFlag("sidebar-redesign");
  if (!redesign) return null;

  const tabs = [
    {
      key: "organizations",
      label: "Organizations",
      to: "/partners",
      icon: LayoutGrid,
    },
    {
      key: "pipeline",
      label: "Pipeline",
      to: "/partners/applications",
      icon: FileText,
    },
  ] as const;

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.key}
            to={t.to}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active === t.key
                ? "bg-accent-coral text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
