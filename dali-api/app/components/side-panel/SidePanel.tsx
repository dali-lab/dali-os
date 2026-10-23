import { lazy, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { PanelFrame } from "~/components/side-panel/PanelFrame";
import { useSidePanel } from "~/components/side-panel/use-side-panel";
import { formatSidePanel } from "~/lib/side-panel";
import { NoPageBar } from "~/components/shell/page-bar-slot";

// The editor is heavy and most pages never open a panel, so it loads on demand.
const DocumentPanel = lazy(() => import("~/components/side-panel/DocumentPanel"));

/** The routed page with the side panel beside it, when the url names one. */
export function SidePanelHost({ children }: { children: ReactNode }) {
  const { panel, close } = useSidePanel();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-start">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col self-stretch">{children}</div>
      {panel && (
        <NoPageBar>
        <Suspense
          fallback={
            <PanelFrame panel={panel} title="" onClose={close}>
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-os-accent motion-reduce:animate-none" />
              </div>
            </PanelFrame>
          }
        >
          <DocumentPanel key={formatSidePanel(panel)} panel={panel} onClose={close} />
        </Suspense>
        </NoPageBar>
      )}
    </div>
  );
}
