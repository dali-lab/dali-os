import { FileDown } from "lucide-react";
import { PageBarMenuItems } from "~/components/shell/page-bar-slot";
import { Menu } from "~/components/ui/floating";
import { deckPdfUrl } from "~/components/slides/live/urls";

export function DeckPdfMenuItems({ pageId, canExportNotes }: { pageId: string; canExportNotes: boolean }) {
  const go = (notes: boolean) => window.location.assign(deckPdfUrl(pageId, notes));
  return (
    <PageBarMenuItems>
      <Menu.Item icon={<FileDown className="h-3.5 w-3.5" />} onSelect={() => go(false)}>
        Download PDF
      </Menu.Item>
      {canExportNotes && (
        <Menu.Item icon={<FileDown className="h-3.5 w-3.5" />} onSelect={() => go(true)}>
          Download PDF with notes
        </Menu.Item>
      )}
    </PageBarMenuItems>
  );
}
