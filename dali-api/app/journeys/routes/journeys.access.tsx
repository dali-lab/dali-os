import { data, redirect } from "react-router";
import type { Route } from "./+types/journeys.access";
import { useOsChrome } from "~/components/os-chrome";
import { JourneyAccessDetail } from "~/journeys/components/JourneyAccess";
import {
  addCollaborator,
  listAddablePeople,
  loadAccessEntries,
  removeCollaborator,
  requireJourneyViewer,
  setCollaboratorRole,
} from "~/journeys/lib/journeys.server";
import { JOURNEYS_HOME } from "~/journeys/lib/paths";
import type { JourneyRole } from "~/journeys/lib/types";

export const meta: Route.MetaFunction = ({ data }) => [{ title: `Access · ${data?.entry.title || "Journey"} · DALI OS` }];

export const handle = { hideBreadcrumbs: true };

// Access is per journey: AccessDialog loads this with ?journey=<id>. Opening the
// URL directly shows the same panel as a page.
export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  const journeyId = new URL(request.url).searchParams.get("journey");
  const [entry] = journeyId ? await loadAccessEntries(viewer, { id: journeyId }) : [];
  if (!entry) throw redirect(JOURNEYS_HOME);
  return { viewerId: viewer.id, entry, people: entry.role === "owner" ? await listAddablePeople() : [] };
}

const isRole = (v: unknown): v is JourneyRole => v === "owner" || v === "editor";

export async function action({ request }: Route.ActionArgs) {
  const viewer = await requireJourneyViewer(request);
  const form = await request.formData();
  const journeyId = String(form.get("journeyId") ?? "");
  const userId = String(form.get("userId") ?? "");
  const role = form.get("role");
  const result = await (async () => {
    switch (form.get("intent")) {
      case "add":
        return isRole(role) ? addCollaborator(viewer, journeyId, userId, role) : null;
      case "role":
        return isRole(role) ? setCollaboratorRole(viewer, journeyId, userId, role) : null;
      case "remove":
        return removeCollaborator(viewer, journeyId, userId);
      default:
        return null;
    }
  })();
  if (!result) return data({ ok: false as const, error: "Unknown action." }, { status: 400 });
  return result.ok ? result : data(result, { status: result.status });
}

export default function JourneyAccessPage({ loaderData }: Route.ComponentProps) {
  const { pageTitle, panel } = useOsChrome();
  return (
    <div className="flex flex-col gap-6">
      <h1 className={pageTitle}>Access</h1>
      <section className={`${panel} p-6 lg:p-8`}>
        <JourneyAccessDetail entry={loaderData.entry} people={loaderData.people} viewerId={loaderData.viewerId} />
      </section>
    </div>
  );
}
