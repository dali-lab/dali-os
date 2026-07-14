import { Link, redirect } from "react-router";
import { CalendarDays, Cable, KeyRound, Slack, UserCircle2 } from "lucide-react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { useDesktopVersion } from "~/lib/desktop";
import type { Route } from "./+types/settings._index";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;
  return null;
}

const CARDS = [
  {
    to: "/profile",
    title: "Account",
    body: "Name, pronouns, emails, photo, class year, major.",
    icon: UserCircle2,
  },
  {
    to: "/settings/calendar",
    title: "Calendar",
    body: "Linked Google accounts and which sub-calendars block your availability.",
    icon: CalendarDays,
  },
  {
    to: "/settings/slack",
    title: "Slack",
    body: "Connect your Slack account so you're added to project channels when staffed.",
    icon: Slack,
  },
  {
    to: "/settings/sessions",
    title: "Your devices",
    body: "Browsers, the desktop app, and connected tools signed in to DALI OS. Sign out from anywhere.",
    icon: KeyRound,
  },
  {
    to: "/settings/connected-apps",
    title: "Connected apps",
    body: "AI assistants and other apps authorized to act on your behalf via MCP.",
    icon: Cable,
  },
];

export default function SettingsIndex() {
  const desktopVersion = useDesktopVersion();
  return (
    <main className="max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Manage how you appear in DALI OS and what other tools can access on your behalf.
      </p>
      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CARDS.map(({ to, title, body, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="block h-full rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-zinc-500" />
                <div>
                  <h2 className="font-medium text-zinc-900">{title}</h2>
                  <p className="mt-1 text-sm text-zinc-600">{body}</p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {desktopVersion && (
        <p className="mt-8 text-xs text-zinc-400">DALI OS Desktop v{desktopVersion}</p>
      )}
    </main>
  );
}
