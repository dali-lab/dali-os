import type { Route } from "./+types/api.documents.$pageId.panel";
import { loader as documentLoader } from "~/routes/documents.$pageId";
import { resolvePanelLoad, type PanelLoad } from "~/lib/side-panel";

const MAX_HOPS = 3;

// The side panel's data: the document route's own loader, so the panel gets
// exactly the access checks and data the full page does. Redirects are resolved
// here because a fetcher that receives one navigates the whole window.
export async function loader(args: Route.LoaderArgs): Promise<PanelLoad> {
  let pageId = args.params.pageId;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let result: unknown;
    try {
      result = await documentLoader({
        ...args,
        params: { pageId },
        request: new Request(new URL(`/documents/${pageId}`, args.request.url), {
          headers: args.request.headers,
        }),
      } as Parameters<typeof documentLoader>[0]);
    } catch (thrown) {
      if (!(thrown instanceof Response)) throw thrown;
      result = thrown;
    }
    const load = resolvePanelLoad(result, pageId);
    if (load.kind !== "follow") return load;
    pageId = load.pageId;
  }
  return { kind: "missing" };
}
