import { useCallback } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { useToast } from "~/components/ui/toast";
import { filedWhereLabel, undoFiledNote, type FiledNote } from "~/calendar/lib/filed-note";

/**
 * The toast that follows filing a meeting note: where it went, with Open and,
 * for a note just created from the calendar, Undo.
 */
export function useFiledNoteToast() {
  const toast = useToast();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  return useCallback(
    (filed: FiledNote, opts: { open?: boolean; undo?: boolean } = {}) => {
      const actions = [
        ...(opts.open === false
          ? []
          : [{ label: "Open", onClick: () => navigate(filed.notePath.href) }]),
        ...(opts.undo
          ? [
              {
                label: "Undo",
                onClick: () => {
                  void undoFiledNote(filed).then((res) => {
                    if (!res.ok) {
                      toast.error("Couldn't undo. The note is still filed.");
                      return;
                    }
                    toast.success(res.notebookTrashed ? "Note and its empty notebook removed" : "Note removed");
                    revalidator.revalidate();
                  });
                },
              },
            ]
          : []),
      ];
      toast.success(`Note filed in ${filedWhereLabel(filed)}`, { actions, duration: 8000 });
    },
    [toast, navigate, revalidator],
  );
}
