import { useCallback, useRef } from "react";
import {
  appendBlocks,
  enhanceSnapshotBlocks,
  noteBodyText,
  findEnhanceMarks,
  findTranscriptToggle,
  hasTranscriptToggle,
  keepAllEnhance,
  keepEnhanceBlock,
  renderEnhanceOps,
  revertAllEnhance,
  revertEnhanceBlock,
  transcriptToggleBlock,
} from "~/components/doc";
import type { DocEditorInstance, DocPartialBlock } from "~/components/doc/schema/build";
import { replaceWithTaskBlock } from "~/components/doc/task/place-task-block";
import type { EditorOp, EnhanceBlockChange, EnhanceMarkEntry, SnapshotBlock } from "./enhance-plan";

type DocChangeListener = (ctx: { marks: EnhanceMarkEntry[]; changes: EnhanceBlockChange[] }) => void;

/**
 * The live-editor side of useMeetingRecording: everything the recording hook
 * needs to write into a note (Insert, Enhance, Keep/Revert, speaker renames,
 * task links), built on one editor ref. Shared by every surface that records
 * into a collab doc (Drive pages, interview notes). Pass `onEditorReady` to
 * the DocEditor and the rest to useMeetingRecording.
 *
 * `notePath` is the page hosting the note; transcript citation chips link
 * back to it with `?transcript=`.
 */
export function useRecordingEditor({ notePath }: { notePath: string }) {
  // Meeting recording writes into the doc through the live editor, so
  // collaborators see the notes arrive like any other edit.
  const editorRef = useRef<DocEditorInstance | null>(null);
  // Document-change listeners registered by useMeetingRecording's
  // subscribeDocumentChanges prop (specs/archive/meeting-recording-rail.md Step 2) —
  // a Set so the single editor.onChange subscription below fans out to every
  // registered hook instance. Kept as a ref, not state: registering must
  // never itself trigger a re-render.
  const docChangeListenersRef = useRef<Set<DocChangeListener>>(new Set());

  const onEditorReady = useCallback((ed: DocEditorInstance) => {
    editorRef.current = ed;
    const marks = findEnhanceMarks(ed.document);
    for (const cb of docChangeListenersRef.current) cb({ marks, changes: [] });
    ed.onChange((editor, { getChanges }) => {
      const liveMarks = findEnhanceMarks(editor.document);
      const changes = getChanges() as unknown as EnhanceBlockChange[];
      for (const cb of docChangeListenersRef.current) cb({ marks: liveMarks, changes });
    });
  }, []);

  // Hands the hook plain data (a mark scan + the transaction's change list)
  // so it never imports anything BlockNote-specific. Seeds the listener at
  // once if the editor is already up; otherwise onEditorReady does.
  const subscribeDocumentChanges = useCallback((cb: DocChangeListener) => {
    docChangeListenersRef.current.add(cb);
    const editor = editorRef.current;
    if (editor) cb({ marks: findEnhanceMarks(editor.document), changes: [] });
    return () => {
      docChangeListenersRef.current.delete(cb);
    };
  }, []);

  const onInsert = useCallback((markdown: string, transcript: string[]) => {
    const editor = editorRef.current;
    if (!editor) return false;
    const blocks: Parameters<DocEditorInstance["replaceBlocks"]>[1] = [...editor.tryParseMarkdownToBlocks(markdown)];
    // The transcript is long and rarely read, so it goes under a collapsed
    // toggle heading; Markdown has no way to say that, hence blocks.
    if (transcript.length) blocks.push(transcriptToggleBlock(transcript));
    appendBlocks(editor, blocks);
    return true;
  }, []);

  // Enhance (specs/meeting-notes-model.md §2): the live editor's top-level
  // blocks, plus the whole-body text isUntouchedTemplate compares against.
  const getNoteState = useCallback((): { blocks: SnapshotBlock[]; bodyText: string } | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    const doc = editor.document;
    return { blocks: enhanceSnapshotBlocks(doc), bodyText: noteBodyText(doc) };
  }, []);

  // Replays Enhance's merge ops against the live editor, then adds the
  // transcript toggle if nothing did already. Returns the captured
  // priorBlocks for the hook to persist for Revert.
  const onApplyEnhance = useCallback(
    (
      ops: EditorOp[],
      recordingId: string,
      transcript: string[],
      speakerAt: (atSeconds: number) => string | null,
    ): { ok: boolean; priorBlocks?: Record<string, unknown> } => {
      const editor = editorRef.current;
      if (!editor) return { ok: false };
      const { priorBlocks } = renderEnhanceOps(editor, ops, { notePath, recordingId, speakerAt });
      if (transcript.length && !hasTranscriptToggle(editor)) {
        appendBlocks(editor, [transcriptToggleBlock(transcript)]);
      }
      return { ok: true, priorBlocks };
    },
    [notePath],
  );

  const onKeepBlock = useCallback((id: string) => {
    const editor = editorRef.current;
    if (editor) keepEnhanceBlock(editor, id);
  }, []);
  const onRevertBlock = useCallback((id: string, priorBlocks: Record<string, unknown>) => {
    const editor = editorRef.current;
    if (editor) revertEnhanceBlock(editor, id, priorBlocks);
  }, []);
  const onKeepAllBlocks = useCallback((): number => {
    const editor = editorRef.current;
    return editor ? keepAllEnhance(editor) : 0;
  }, []);
  const onRevertAllBlocks = useCallback((priorBlocks: Record<string, unknown>): number => {
    const editor = editorRef.current;
    return editor ? revertAllEnhance(editor, priorBlocks) : 0;
  }, []);

  // A speaker rename after Insert/Enhance leaves the names in the Transcript
  // toggle stale; rewrite its children. False when there's no toggle yet.
  const onSpeakersChanged = useCallback((paragraphs: string[]): boolean => {
    const editor = editorRef.current;
    if (!editor) return false;
    const toggle = findTranscriptToggle(editor.document);
    if (!toggle || toggle.children.length === 0) return false;
    const newChildren = paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text, styles: {} }],
    })) as DocPartialBlock[];
    editor.replaceBlocks(toggle.children, newChildren);
    return true;
  }, []);

  const onTaskCreated = useCallback(
    (blockId: string, task: { taskId: string; projectId: string; label: string }) => {
      const editor = editorRef.current;
      if (editor) replaceWithTaskBlock(editor, blockId, task);
    },
    [],
  );

  const onRemoveBlock = useCallback((id: string) => {
    const editor = editorRef.current;
    if (editor?.getBlock(id)) editor.removeBlocks([id]);
  }, []);

  return {
    editorRef,
    onEditorReady,
    hookProps: {
      subscribeDocumentChanges,
      onInsert,
      getNoteState,
      onApplyEnhance,
      onKeepBlock,
      onRevertBlock,
      onKeepAllBlocks,
      onRevertAllBlocks,
      onSpeakersChanged,
      onTaskCreated,
      onRemoveBlock,
    },
  };
}
