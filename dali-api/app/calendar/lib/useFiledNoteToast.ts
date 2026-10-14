import { useCallback } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { useToast } from "~/components/ui/toast";
import { declinedMoveMessage, undoFiledNote, type FiledNote } from "~/calendar/lib/filed-note";

/**
 * The toast that follows filing a meeting note: where it went, with Open and,
 * for a note just created from the calendar, Undo. A refused notebook move gets
 * a second toast naming the place `movedTo` it was asked to go.
 */
export function useFiledNoteToast() {
  const toast = useToast();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  return useCallback(
    (filed: FiledNote, opts: { open?: boolean; undo?: boolean; movedTo?: string } = {}) => {
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
                    toast.success("Note removed");
                    revalidator.revalidate();
                  });
                },
              },
            ]
          : []),
      ];
      toast.success(`Filed to ${filed.notePath.label}`, { actions, duration: 8000 });
      if (filed.declinedMove) toast.error(declinedMoveMessage(opts.movedTo));
    },
    [toast, navigate, revalidator],
  );
}
