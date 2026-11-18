import { useLoaderData } from "react-router";
import type { Route } from "./+types/paperwork";
import { PaperworkPage } from "../components/PaperworkPage";
import { guardPaperwork } from "../lib/guard.server";
import { loadPaperwork } from "../lib/paperwork.server";

export const meta: Route.MetaFunction = () => [{ title: "Paperwork · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await guardPaperwork(request, { page: true });
  if (!guard.ok) throw guard.response;
  return loadPaperwork(guard.userId, guard.roles, request);
}

export default function PaperworkRoute() {
  return <PaperworkPage data={useLoaderData<typeof loader>()} />;
}
