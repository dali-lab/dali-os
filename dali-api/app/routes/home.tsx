import { redirect, useLoaderData } from "react-router";
import { Mail, MapPin, Briefcase } from "lucide-react";
import { requireAuth, withAuth } from "~/lib/auth";
import { userInitials } from "~/lib/display";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (auth.user.type === "applicant") return withAuth(auth, redirect("/portal"));
  return withAuth(auth, { user: auth.user });
}

export default function Home() {
  const { user } = useLoaderData<typeof loader>();
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const initials = userInitials(user);

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-card border border-border rounded-lg p-6 flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="w-20 h-20 rounded-full bg-accent-coral text-white flex items-center justify-center font-bold text-2xl flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-heading text-2xl font-bold text-foreground truncate">{fullName}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{user.email}</span>
            <span className="inline-flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" />DALI Member</span>
            <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />Hanover, NH</span>
          </div>
        </div>
        <button
          type="button"
          className="px-3 py-2 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors self-start sm:self-auto"
        >
          Edit profile
        </button>
      </section>
    </div>
  );
}
