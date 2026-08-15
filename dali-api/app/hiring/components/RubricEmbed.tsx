import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Link } from "react-router";

export interface RubricEmbedProps {
  rubricId: string;
  name: string;
  criteria: Array<{
    key: string;
    label: string;
    description?: string;
    maxScore: number;
  }>;
  defaultOpen?: boolean;
}

export function RubricEmbed({
  rubricId,
  name,
  criteria,
  defaultOpen = false,
}: RubricEmbedProps) {
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
            {criteria.length} {criteria.length === 1 ? "criterion" : "criteria"}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-3 shrink-0">
          <Link
            to={`/hiring/rubrics/${rubricId}`}
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
        <div className="border-t border-border p-4 bg-muted/30 space-y-3">
          {criteria.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No criteria defined.</p>
          ) : (
            criteria.map((c) => (
              <div key={c.key} className="bg-card border border-border rounded-lg p-4">
                <div className="flex justify-between items-start gap-3">
                  <h4 className="font-bold text-sm text-foreground">{c.label}</h4>
                  <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded shrink-0">
                    / {c.maxScore}
                  </span>
                </div>
                {c.description && (
                  <p className="text-sm text-muted-foreground mt-1">{c.description}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
