import { useState } from "react";
import { Code, FileText, FlaskConical, FolderTree, Maximize2, Play, Presentation, Trash2, type LucideIcon } from "lucide-react";
import type { JourneyModule, Lab } from "~/journeys/lib/types";
import { createLab } from "~/journeys/lib/journey-edit";
import { moduleTitle } from "~/journeys/lib/journey";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { FullscreenEditor } from "./FullscreenEditor";
import { LabEditorWorkspace } from "./lab/LabEditorWorkspace";
import { LabTestDialog } from "./LabTestDialog";
import { StudioLabSummary } from "./studio/StudioLabSummary";
import { createStudio } from "~/journeys/lib/studio";
import type { StudioKind } from "~/journeys/lib/studio-types";

const PREVIEW_FILES = 8;

const LAB_TYPES: { id: "code" | StudioKind; title: string; description: string; icon: LucideIcon }[] = [
  { id: "code", title: "Code project", description: "Files and folders in an IDE, with steps checked against the running code.", icon: Code },
  { id: "canvas", title: "Whiteboard", description: "A board for critiques, affinity maps, flows and sketches.", icon: Presentation },
  { id: "document", title: "Document", description: "A writing space for tickets, briefs, research plans and readouts.", icon: FileText },
];

export function LabTab({
  module: mod,
  onChange,
}: {
  module: JourneyModule;
  onChange: (fn: (m: JourneyModule) => JourneyModule) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [justAddedStudio, setJustAddedStudio] = useState(false);
  const dialog = useDialog();
  const lab = mod.lab;

  if (mod.studio) {
    return <StudioLabSummary module={mod} studio={mod.studio} onChange={onChange} initiallyEditing={justAddedStudio} />;
  }

  if (!lab) {
    return (
      <div className="py-4">
        <FlaskConical className="h-7 w-7 text-os-muted" aria-hidden />
        <h4 className="mt-3 font-medium">Add a hands-on lab</h4>
        <p className="mt-1 text-sm text-os-grey">Pick the kind of work learners do. Each lab can use automatic checks, self-checks or mentor review.</p>
        <ul className="mt-5 space-y-2">
          {LAB_TYPES.map(({ id, title, description, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  if (id === "code") {
                    onChange((m) => ({ ...m, lab: createLab() }));
                    setEditing(true);
                  } else {
                    onChange((m) => ({ ...m, studio: createStudio(id) }));
                    setJustAddedStudio(true);
                  }
                }}
                className="flex w-full items-start gap-3 rounded-os-item border border-os-container p-4 text-left transition-colors hover:border-os-container-hi hover:bg-os-hover"
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-os-accent" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{title}</span>
                  <span className="mt-0.5 block text-sm leading-5 text-os-grey">{description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const updateLab = (fn: (l: Lab) => Lab) => onChange((m) => (m.lab ? { ...m, lab: fn(m.lab) } : m));
  const paths = Object.keys(lab.files).sort();
  const folders = new Set(paths.filter((p) => p.includes("/")).map((p) => p.split("/")[0])).size;

  const removeLab = async () => {
    const ok = await dialog.confirm({
      title: "Remove the lab?",
      description: "Its files and steps are deleted from this draft.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (ok) onChange((m) => ({ ...m, lab: undefined }));
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="flex items-center gap-1.5 text-xs text-os-muted">
          <Code className="h-3.5 w-3.5" aria-hidden />
          Code lab
        </p>
        <h4 className="mt-1 font-semibold">{lab.title || "Untitled lab"}</h4>
        {lab.intro && <p className="mt-1 line-clamp-3 text-sm leading-6 text-os-grey">{lab.intro}</p>}
        <p className="mt-2 text-xs text-os-muted">
          {paths.length} files{folders > 0 ? ` in ${folders} ${folders === 1 ? "folder" : "folders"}` : ""} · {lab.steps.length}{" "}
          guided steps
        </p>
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
        <h4 className="flex items-center gap-1.5 text-xs font-medium text-os-grey">
          <FolderTree className="h-3.5 w-3.5" aria-hidden />
          Starter files
        </h4>
        <ul className="mt-2 space-y-1 font-mono text-xs text-foreground/85">
          {paths.slice(0, PREVIEW_FILES).map((p) => (
            <li key={p} className="truncate">
              {p}
            </li>
          ))}
        </ul>
        {paths.length > PREVIEW_FILES && <p className="mt-1 text-xs text-os-muted">+{paths.length - PREVIEW_FILES} more</p>}
      </section>

      <section className="border-t border-os-container pt-5">
        <button type="button" onClick={() => void removeLab()} className={buttonClasses("ghost", "sm", "hover:text-destructive")}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove lab
        </button>
      </section>

      <FullscreenEditor
        open={editing}
        title={`${moduleTitle(mod)} · Lab`}
        subtitle="Changes save to your draft as you type"
        onClose={() => setEditing(false)}
        actions={
          <button type="button" onClick={() => setTesting(true)} className={buttonClasses("primary", "sm")}>
            <Play className="h-3.5 w-3.5" aria-hidden />
            Try as a learner
          </button>
        }
      >
        <LabEditorWorkspace lab={lab} onChange={updateLab} />
      </FullscreenEditor>

      <LabTestDialog open={testing} lab={lab} onClose={() => setTesting(false)} />
    </div>
  );
}
