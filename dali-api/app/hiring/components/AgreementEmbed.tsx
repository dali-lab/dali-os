import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";

export interface AgreementEmbedProps {
  agreementId: string;
  name: string;
  body: unknown;
  defaultOpen?: boolean;
}

export function AgreementEmbed({
  agreementId,
  name,
  body,
  defaultOpen = false,
}: AgreementEmbedProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 flex items-center justify-between bg-muted/50 hover:bg-muted/70 transition-colors text-left"
      >
        <div className="min-w-0 flex-1">
          <span className="block font-semibold text-sm text-foreground truncate">
            {name}
          </span>
          <span className="block text-xs text-muted-foreground mt-0.5">
            Confidentiality agreement
          </span>
        </div>
        <div className="flex items-center gap-3 ml-3 shrink-0">
          <Link
            to={`/documents/agreement/${agreementId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            onClick={(e) => e.stopPropagation()}
          >
            Open in Drive
            <ExternalLink className="w-3 h-3" />
          </Link>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="border-t border-border p-4 bg-muted/30">
          {isEmptyBlocks(body) ? (
            <p className="text-sm text-muted-foreground italic">No content yet.</p>
          ) : (
            <div className="text-dark-blue px-4 py-3 rounded-lg border border-border bg-muted/30">
              <DocEditor
                features="notes"
                density="compact"
                editable={false}
                initialContent={body}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
