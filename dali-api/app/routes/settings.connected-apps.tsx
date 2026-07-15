// Settings → Connected apps. Lists the user's non-revoked OAuthGrants and
// lets them revoke any one (cascading to all sessions for that grant).

import type { Route } from "./+types/settings.connected-apps";
import { Form, redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { revokeAllForGrant } from "~/lib/session";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const grants = await prisma.oAuthGrant.findMany({
    where: { userId: auth.user.sub, revokedAt: null },
    include: { client: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return {
    grants: grants.map((g) => ({
      id: g.id,
      clientName: g.client.name,
      scopes: g.scopes,
      createdAt: g.createdAt.toISOString(),
      lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const form = await request.formData();
  const grantId = form.get("grantId");
  if (typeof grantId !== "string") {
    return redirect("/settings/connected-apps?error=missing_grantId");
  }

  // Verify ownership before revoking.
  const grant = await prisma.oAuthGrant.findUnique({ where: { id: grantId } });
  if (!grant || grant.userId !== auth.user.sub) {
    return redirect("/settings/connected-apps?error=not_found");
  }

  await prisma.oAuthGrant.update({
    where: { id: grantId },
    data: { revokedAt: new Date() },
  });
  await revokeAllForGrant(grantId);

  return redirect("/settings/connected-apps?revoked=1");
}

export default function ConnectedAppsPage({ loaderData }: Route.ComponentProps) {
  const { grants } = loaderData;
  return (
    <main className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Connected apps</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Apps you've authorized to access DALI OS on your behalf.{" "}
        <a href="/help/mcp" className="text-blue-700 underline">
          How to connect Claude to DALI OS
        </a>
        .
      </p>
      {grants.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">No connected apps.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {grants.map((g) => (
            <li
              key={g.id}
              className="rounded border border-zinc-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-medium">{g.clientName}</h2>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.scopes.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Authorized {new Date(g.createdAt).toLocaleDateString()}
                    {g.lastUsedAt ? (
                      <>
                        {" · "}Last used{" "}
                        {new Date(g.lastUsedAt).toLocaleDateString()}
                      </>
                    ) : null}
                  </p>
                </div>
                <Form method="post">
                  <input type="hidden" name="grantId" value={g.id} />
                  <button
                    type="submit"
                    className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
                  >
                    Revoke
                  </button>
                </Form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
