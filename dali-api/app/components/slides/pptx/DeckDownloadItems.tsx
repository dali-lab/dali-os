import { FileDown } from "lucide-react";
import { Menu } from "~/components/ui/floating";
import { PageBarMenuItems } from "~/components/shell/page-bar-slot";

export const pptxDownloadHref = (pageId: string) => `/slides/${pageId}/export.pptx`;

/** The deck's "Download as" rows for the page bar's more menu. */
export function DeckDownloadItems({ pageId }: { pageId: string }) {
  return (
    <PageBarMenuItems>
      <Menu.Item icon={<FileDown className="h-3.5 w-3.5" />} onSelect={() => window.location.assign(pptxDownloadHref(pageId))}>
        Download PowerPoint
      </Menu.Item>
    </PageBarMenuItems>
  );
}
