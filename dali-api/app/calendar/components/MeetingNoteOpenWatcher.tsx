import { useEffect, useRef } from "react";
import { useFetcher, useNavigate } from "react-router";
import { filedNoteFrom, type FiledNoteResponse } from "~/calendar/lib/filed-note";
import { useFiledNoteToast } from "~/calendar/lib/useFiledNoteToast";

export const OPEN_NOTE_FETCHER_KEY = "open-meeting-note";

/** Finishes "open this occurrence's note": says where the note was filed and
 *  navigates to it. Lives at the app root because the button that started the
 *  request (often in a popover) can be gone by the time it answers; holding the
 *  same keyed fetcher here is also what keeps its result from being discarded. */
export function MeetingNoteOpenWatcher() {
  const navigate = useNavigate();
  const showFiledNote = useFiledNoteToast();
  const { data, state } = useFetcher<FiledNoteResponse>({ key: OPEN_NOTE_FETCHER_KEY });
  const armed = useRef(false);
  useEffect(() => {
    if (state === "submitting") {
      armed.current = true;
      return;
    }
    if (!armed.current || !data?.notePageId) return;
    armed.current = false;
    const filed = filedNoteFrom(data);
    if (filed) showFiledNote(filed, { open: false });
    navigate(`/documents/${data.notePageId}`);
  }, [state, data, navigate, showFiledNote]);
  return null;
}
