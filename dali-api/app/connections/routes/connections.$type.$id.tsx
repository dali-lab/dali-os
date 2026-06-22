import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/connections.$type.$id";
import { prisma } from "~/lib/db";
import { requireAuth, redirectApplicantToPortal, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { buildConnections, type EntityType } from "~/lib/connections";
import { ConnectionsPanel } from "~/components/ConnectionsPanel";

export const meta: Route.MetaFunction = ({ data }) => {
  const focus = (data as { data?: { focus?: { label: string } } } | undefined)?.data?.focus;
  return [{ title: focus ? `${focus.label} · Connections · DALI OS` : "Connections · DALI OS" }];
};

function isEntityType(x: string): x is EntityType {
  return x === "project" || x === "user" || x === "domain";
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const { type, id } = params;
  if (!isEntityType(type)) throw new Response("Unknown entity type", { status: 404 });

  // No new data exposure: the domain neighborhood is Core-only on the
  // admin-console domains view, so its connections view matches that gate.
  // Project/user connections mirror what an authenticated member already sees
  // on the respective detail pages.
  if (type === "domain" && !(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  const data = await buildConnections(prisma, type, id);
  return { data };
}

export default function ConnectionsRoute() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-3xl mx-auto py-4">
      <ConnectionsPanel data={data} standalone />
    </div>
  );
}
