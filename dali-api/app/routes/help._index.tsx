import { Link, redirect } from "react-router";
import {
  BookOpen,
  CalendarDays,
  Compass,
  Cpu,
  Keyboard,
  Bell,
  Users,
  type LucideIcon,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { HELP_ARTICLES } from "~/lib/help-articles";
import type { Route } from "./+types/help._index";

export const meta: Route.MetaFunction = () => [{ title: "Help · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  return null;
}

// Icons live here rather than in the shared HELP_ARTICLES registry, which stays
// data-only so it can be indexed by the (client-safe) palette search.
const ICONS: Record<string, LucideIcon> = {
  "getting-started": BookOpen,
  shortcuts: Keyboard,
  calendar: CalendarDays,
  staffing: Users,
  notifications: Bell,
  mcp: Cpu,
};

const CARDS = HELP_ARTICLES.map((a) => ({
  to: `/help/${a.slug}`,
  title: a.title,
  body: a.summary,
  icon: ICONS[a.slug] ?? BookOpen,
}));

export default function HelpIndex() {
  return (
    <main className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Help</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Short articles on how the pieces of DALI OS fit together.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("dali:start-tour"))}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
        >
          <Compass className="h-4 w-4" />
          Start guide
        </button>
      </div>
      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CARDS.map(({ to, title, body, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="block h-full rounded-lg border border-border bg-card p-4 transition hover:bg-muted/50"
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div>
                  <h2 className="font-medium text-foreground">{title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
