import { useState } from "react";
import { FileText, Maximize2, Play, Presentation, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { moduleTitle } from "~/journeys/lib/journey";
import { KIND_LABELS, MODE_LABELS } from "~/journeys/lib/studio";
import type { CheckMode, StudioLab } from "~/journeys/lib/studio-types";
import type { JourneyModule } from "~/journeys/lib/types";
import { FullscreenEditor } from "../FullscreenEditor";
import { StudioEditorWorkspace } from "./StudioEditorWorkspace";
import { StudioTestDialog } from "./StudioTestDialog";

/** The Lab tab for a whiteboard or document lab: what it checks, and the way into its editor. */
export function StudioLabSummary({
  module: mod,
  studio,
  onChange,
  initiallyEditing = false,
}: {
  module: JourneyModule;
  studio: StudioLab;
  onChange: (fn: (m: JourneyModule) => JourneyModule) => void;
  initiallyEditing?: boolean;
}) {
  const dialog = useDialog();
  const [editing, setEditing] = useState(initiallyEditing);
  const [testing, setTesting] = useState(false);
  const updateStudio = (fn: (s: StudioLab) => StudioLab) => onChange((m) => (m.studio ? { ...m, studio: fn(m.studio) } : m));
  const Icon = studio.kind === "canvas" ? Presentation : FileText;
  const byMode = (Object.keys(MODE_LABELS) as CheckMode[])
    .map((mode) => ({ mode, items: studio.criteria.filter((c) => c.mode === mode) }))
    .filter((g) => g.items.length > 0);
  const detail =
    studio.kind === "canvas"
      ? `${studio.canvas?.items.length ?? 0} starter items · ${studio.canvas?.hotspots.length ?? 0} hidden areas`
      : "Document template";

  const remove = async () => {
    const ok = await dialog.confirm({
      title: "Remove the lab?",
      description: "Its brief, rubric and starter content are deleted from this draft.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (ok) onChange((m) => ({ ...m, studio: undefined }));
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="flex items-center gap-1.5 text-xs text-os-muted">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {KIND_LABELS[studio.kind]} lab · {detail}
        </p>
        <h4 className="mt-1 font-semibold">{studio.title || "Untitled lab"}</h4>
        {studio.brief && <p className="mt-1 line-clamp-3 text-sm leading-6 text-os-grey">{studio.brief}</p>}
      </div>

      <div className="grid gap-2">
        <button type="button" onClick={() => setEditing(true)} className={buttonClasses("primary", "md", "w-full")}>
          <Maximize2 className="h-4 w-4" aria-hidden />
          Open lab editor
        </button>
        <button type="button" onClick={() => setTesting(true)} className={buttonClasses("secondary", "md", "w-full")}>
          <Play className="h-4 w-4" aria-hidden />
          Try as a learner
        </button>
      </div>

      <section>
        <h4 className="os-field-label">Rubric</h4>
        {byMode.length === 0 ? (
          <p className="mt-2 text-sm text-os-muted">No criteria yet.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {byMode.map(({ mode, items }) => (
              <div key={mode}>
                <p className="text-xs text-os-muted">{MODE_LABELS[mode]}</p>
                <ul className="mt-1 space-y-1">
                  {items.map((c) => (
                    <li key={c.id} className="truncate text-sm text-foreground/85">
                      {c.label || "Untitled criterion"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-os-container pt-5">
        <button type="button" onClick={remove} className={buttonClasses("ghost", "sm", "hover:text-destructive")}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove lab
        </button>
      </section>

      <FullscreenEditor
        open={editing}
        title={`${moduleTitle(mod)} · ${KIND_LABELS[studio.kind]} lab`}
        subtitle="Changes save to your draft as you go"
        onClose={() => setEditing(false)}
        actions={
          <button type="button" onClick={() => setTesting(true)} className={buttonClasses("primary", "sm")}>
            <Play className="h-3.5 w-3.5" aria-hidden />
            Try as a learner
          </button>
        }
      >
        <StudioEditorWorkspace studio={studio} onChange={updateStudio} />
      </FullscreenEditor>

      <StudioTestDialog open={testing} studio={studio} onClose={() => setTesting(false)} />
    </div>
  );
}
