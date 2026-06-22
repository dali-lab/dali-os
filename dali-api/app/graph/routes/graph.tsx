import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/graph";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { buildGlobalGraph } from "~/lib/connections";
import { GraphExplorer } from "~/graph/components/GraphExplorer";

export const meta: Route.MetaFunction = () => [{ title: "Graph · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  // Members only — applicants don't get the lab graph.
  if (auth.user.type === "applicant") return redirect("/portal");

  const graph = await buildGlobalGraph(prisma);
  return { graph };
}

export default function GraphRoute() {
  const { graph } = useLoaderData<typeof loader>();
  return <GraphExplorer graph={graph} />;
}
