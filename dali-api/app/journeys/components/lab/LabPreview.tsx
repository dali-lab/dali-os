import type { Ref } from "react";
import { RefreshCw } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";

export function LabPreview({
  doc,
  onRefresh,
  frameRef,
}: {
  doc: string;
  onRefresh: () => void;
  frameRef?: Ref<HTMLIFrameElement>;
}) {
  return (
    <section aria-label="Preview" className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-os-container bg-os-bg px-4">
        <h3 className="text-xs font-medium text-os-grey">Preview</h3>
        <IconButton label="Re-run preview" icon={RefreshCw} iconClassName="h-3.5 w-3.5" onClick={onRefresh} />
      </div>
      {/* The learner's page, so it keeps a plain white canvas in either theme. */}
      <div className="min-h-0 flex-1 bg-white">
        <iframe ref={frameRef} title="Lab preview" sandbox="allow-scripts allow-modals" srcDoc={doc} className="h-full w-full border-0" />
      </div>
    </section>
  );
}
