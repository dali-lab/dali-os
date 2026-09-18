import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { useToast } from "~/components/ui/toast";

type TemplateRow = { id: string; title: string; iconEmoji: string | null };

// ⋯ "Import template" — pick a template document and hand its blocks back to
// the editor, which inserts them into the open doc. Lists the lab-wide
// templates plus, for a project doc, that project's own.
export function ImportTemplateDialog({
  open,
  onClose,
  pageId,
  workspaceType,
  workspaceId,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  pageId: string;
  workspaceType: string;
  workspaceId: string | null;
  onImport: (blocks: unknown[]) => void;
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTemplates(null);
    const scopes = [new URLSearchParams({ workspaceType: "Lab" })];
    if (workspaceType === "Project" && workspaceId) {
      scopes.push(new URLSearchParams({ workspaceType, workspaceId }));
    }
    Promise.all(
      scopes.map((qs) =>
        fetch(`/api/page-templates?${qs}`, { credentials: "include" })
          .then((r) => r.json() as Promise<{ templates?: TemplateRow[] }>)
          .then((d) => d.templates ?? []),
      ),
    )
      .then((groups) =>
        setTemplates(
          groups
            .flat()
            .filter((t) => t.id !== pageId)
            .sort((a, b) => a.title.localeCompare(b.title)),
        ),
      )
      .catch(() => {
        toast.error("Couldn't load templates.");
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId, workspaceType, workspaceId]);

  async function apply(templateId: string) {
    setApplyingId(templateId);
    try {
      const res = await fetch(`/api/page-templates/${templateId}/blocks`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const { blocks } = (await res.json()) as { blocks: unknown[] };
      if (blocks.length === 0) {
        toast.error("That template is empty.");
        return;
      }
      onImport(blocks);
      onClose();
    } catch {
      toast.error("Couldn't import that template.");
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="import-template-title" disableEscape={applyingId !== null}>
      <ModalHeader
        titleId="import-template-title"
        title="Import template"
        subtitle="The template's content is added to the end of this document."
        onClose={onClose}
      />
      {templates === null ? (
        <div className="flex justify-center py-6 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading templates" />
        </div>
      ) : templates.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No templates yet. Mark a document as a template from its ⋯ menu to use it here.
        </p>
      ) : (
        <ul className="-mx-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={applyingId !== null}
                onClick={() => void apply(t.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-foreground hover:bg-muted disabled:opacity-60"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base">
                  {t.iconEmoji ?? <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"}</span>
                {applyingId === t.id && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
