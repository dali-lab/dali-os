import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useToast } from "~/components/ui/toast";
import { uploadEditorImage, uploadErrorMessage } from "~/components/doc/upload";
import { chunkSlides } from "./import-apply";
import { importSummary, parsePptxFile, PPTX_ACCEPT, PptxImportError, uploadImages, validatePptxFile } from "./import-client";
import type { ImportPlan, ReadySlide } from "./import-types";

const TOAST_ID = "slides-import";

export interface PptxImportOutcome {
  added: number;
  firstId: string | null;
}

/**
 * Reads a PowerPoint file, uploads its images and hands the slides to `append` in chunks small enough
 * for one websocket message each. `append` returns the ids it created.
 */
export function usePptxImport(append: (slides: ReadySlide[]) => string[] | Promise<string[]>, onDone?: (outcome: PptxImportOutcome) => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMemo(() => (file: File) => uploadEditorImage(file), []);

  const addSlides = useCallback(
    async (slides: ReadySlide[], skipped: ImportPlan["skipped"]) => {
      let added = 0;
      let firstId: string | null = null;
      for (const chunk of chunkSlides(slides)) {
        toast.info(`Adding slides, ${added} of ${slides.length}…`, { id: TOAST_ID, duration: 0 });
        const ids = await append(chunk);
        firstId ??= ids[0] ?? null;
        added += chunk.length;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      toast.success(importSummary(added, skipped), { id: TOAST_ID });
      onDone?.({ added, firstId });
    },
    [append, onDone, toast],
  );

  const importPrepared = useCallback(
    async (slides: ReadySlide[], skipped: ImportPlan["skipped"]) => {
      setBusy(true);
      try {
        await addSlides(slides, skipped);
      } catch (err) {
        toast.error(uploadErrorMessage(err), { id: TOAST_ID });
      } finally {
        setBusy(false);
      }
    },
    [addSlides, toast],
  );

  const run = useCallback(
    async (file: File) => {
      const invalid = validatePptxFile(file);
      if (invalid) {
        toast.error(invalid);
        return;
      }
      setBusy(true);
      toast.info("Reading the PowerPoint file…", { id: TOAST_ID, duration: 0 });
      try {
        const plan = await parsePptxFile(file);
        const uploaded = await uploadImages(plan, upload, (done, total) =>
          toast.info(`Uploading images, ${done} of ${total}…`, { id: TOAST_ID, duration: 0 }),
        );
        await addSlides(uploaded.slides, uploaded.skipped);
      } catch (err) {
        toast.error(err instanceof PptxImportError ? err.message : uploadErrorMessage(err), { id: TOAST_ID });
      } finally {
        setBusy(false);
      }
    },
    [addSlides, toast, upload],
  );

  const inputProps = {
    ref: inputRef,
    type: "file" as const,
    accept: PPTX_ACCEPT,
    hidden: true,
    "aria-label": "Import PowerPoint file",
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void run(file);
    },
  };

  return { busy, pick: () => inputRef.current?.click(), inputProps, importPrepared };
}
