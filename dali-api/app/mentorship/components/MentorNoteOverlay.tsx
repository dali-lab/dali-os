import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { IconButton } from "~/components/ui/IconButton";
import { X } from "lucide-react";
import { MentorNoteView, type MentorNoteData } from "./MentorNoteView";

const TITLE_ID = "mentor-note-overlay-title";

/**
 * A mentee's weekly note, opened over the mentorship grid instead of
 * navigating away. It loads the same loader as the /mentorship/notes/:id page
 * (so access checks, the page ensure and recents all behave identically) and
 * renders the shared <MentorNoteView>. The grid stays mounted underneath, so
 * closing returns to exactly where the viewer was.
 */
export function MentorNoteOverlay({
  noteId,
  onClose,
}: {
  noteId: string | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<MentorNoteData>();
  const { load } = fetcher;

  useEffect(() => {
    if (noteId) load(`/mentorship/notes/${noteId}`);
  }, [noteId, load]);

  const data = fetcher.data && fetcher.data.id === noteId ? fetcher.data : null;

  return (
    <Modal
      open={noteId != null}
      onClose={onClose}
      labelledBy={TITLE_ID}
      containerClassName={modalCardClass("max-w-3xl !p-6 sm:!p-8")}
    >
      <div className="relative">
        <IconButton
          label="Close notes"
          icon={X}
          onClick={onClose}
          className="absolute right-0 top-0 z-10 p-1.5 rounded-full"
        />
        {data ? (
          <MentorNoteView data={data} variant="overlay" titleId={TITLE_ID} />
        ) : (
          <div className="py-16 text-center text-sm text-muted-foreground" role="status">
            <span id={TITLE_ID} className="sr-only">Mentor notes</span>
            Loading notes…
          </div>
        )}
      </div>
    </Modal>
  );
}
