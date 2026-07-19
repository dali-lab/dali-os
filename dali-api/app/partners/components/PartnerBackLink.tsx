import { Link } from "react-router";

// The partner portal renders outside the main app shell, so it has no
// breadcrumb trail. This is its single up-navigation affordance — one component
// so every partner detail page's back link looks and behaves identically.
export function PartnerBackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="text-xs text-muted-foreground hover:text-foreground"
    >
      ← {label}
    </Link>
  );
}
