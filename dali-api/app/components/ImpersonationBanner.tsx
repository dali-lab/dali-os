import { UserCog } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";

// Shown at the top of the shell while an admin is impersonating a member (a
// BetterAuth admin-plugin session — see /admin/impersonate). A plain native
// form so "Stop" does a full-document POST: ending impersonation swaps the
// session cookie back, and the whole shell (including open workspace iframes)
// must reload as the real admin rather than revalidate in place.
export function ImpersonationBanner({ userName }: { userName: string }) {
  return (
    <div className="flex-none flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-amber-900 dark:text-amber-200">
      <UserCog className="h-4 w-4 shrink-0" />
      <span className="text-sm flex-1 min-w-0">
        You're viewing DALI OS as{" "}
        <span className="font-semibold">{userName}</span>. Everything you do is
        recorded against your admin account.
      </span>
      <form method="post" action="/admin/stop-impersonating" className="shrink-0">
        <button type="submit" className={buttonClasses("secondary", "sm")}>
          Stop impersonating
        </button>
      </form>
    </div>
  );
}
