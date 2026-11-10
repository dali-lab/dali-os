import type { Route } from "./+types/slides.$pageId.presenter";
import { loadPresentPage } from "~/lib/slide-present.server";
import { PresentPage } from "~/components/slides/live/PresentPage";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · Presenter view · DALI OS` : "Slides · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  return loadPresentPage(request, params.pageId, { driverOnly: true });
}

export default function SlidesPresent({ loaderData }: Route.ComponentProps) {
  return <PresentPage data={loaderData} view="presenter" />;
}
