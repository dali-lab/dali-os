// Member "documents to sign" inbox — every enforced agreement the signed-in
// user still owes a signature on.

import { redirect, Link, useLoaderData } from "react-router";
import { FileSignature, CheckCircle2 } from "lucide-react";
import type { Route } from "./+types/sign._index";
import { requireAuth } from "~/lib/auth";
import { listOutstandingBindings } from "~/signing/lib/state.server";

export const meta: Route.MetaFunction = () => [{ title: "Documents to sign · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const outstanding = await listOutstandingBindings(auth.user.sub);
  return { outstanding };
}

export default function SignInboxPage() {
  const { outstanding } = useLoaderData<typeof loader>();

  return (
    <div className="max-w-2xl mx-auto py-10 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Documents to sign</h1>

      {outstanding.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-6 text-green-800">
          <CheckCircle2 className="w-6 h-6 shrink-0" />
          <p className="text-sm">You're all caught up — nothing to sign right now.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {outstanding.map((o) => (
            <li key={o.bindingId}>
              <Link
                to={`/sign/${o.bindingId}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="p-2 bg-accent-coral/10 text-accent-coral rounded-lg shrink-0">
                    <FileSignature className="w-5 h-5" />
                  </span>
                  <span className="font-medium text-foreground truncate">{o.documentName}</span>
                </span>
                <span className="text-sm font-medium text-accent-coral shrink-0">Review &amp; sign →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
