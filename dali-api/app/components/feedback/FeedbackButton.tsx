import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Camera, MessageSquarePlus, MessagesSquare, PenLine, X } from "lucide-react";
import { cn } from "~/lib/cn";
import { FEEDBACK_BODY_MAX, newFeedbackScreenshotKey } from "~/lib/feedback";
import { Modal } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Menu, MenuItem } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { ScreenshotSelector, captureTabFrame } from "./ScreenshotSelector";

async function uploadScreenshot(image: Blob): Promise<string> {
  const presign = await fetch("/api/upload/presign", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: newFeedbackScreenshotKey(),
      contentType: "image/png",
      contentLength: image.size,
      accept: "image/png",
    }),
  });
  if (!presign.ok) {
    const { error } = await presign.json().catch(() => ({ error: null }));
    throw new Error(error ?? "Could not upload the screenshot");
  }
  const { url, fields, key } = await presign.json();
  const form = new FormData();
  for (const [name, value] of Object.entries(fields as Record<string, string>)) {
    form.append(name, value);
  }
  form.append("file", image, "screenshot.png");
  const upload = await fetch(url, { method: "POST", body: form });
  if (!upload.ok) throw new Error("Could not upload the screenshot");
  return key;
}

type Stage =
  | { name: "idle" }
  // The share prompt is up, or its frame is being read: nothing of ours on screen.
  | { name: "capturing" }
  // `resume`: opened from the composer, so cancelling goes back to it.
  | { name: "selecting"; frame: HTMLCanvasElement; resume: boolean }
  | { name: "composing" };

/**
 * The shell's feedback button. Two paths: open the feature request feed, or
 * write a request, which starts on a drag-to-select screenshot of the page
 * wherever the browser can share the tab.
 */
export function FeedbackButton({
  pagePath,
  onOpenFeed,
}: {
  /** Where the user is, recorded on the request. */
  pagePath: string;
  onOpenFeed: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [body, setBody] = useState("");
  const [screenshot, setScreenshot] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [canCapture, setCanCapture] = useState(false);
  const fetcher = useFetcher<{ ok: boolean }>({ key: "os-feedback-create" });
  const toast = useToast();
  const { formClass } = useOsChrome();
  const titleId = useId();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setCanCapture(typeof navigator.mediaDevices?.getDisplayMedia === "function");
  }, []);

  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  async function startCapture(resume: boolean) {
    setStage({ name: "capturing" });
    const frame = await captureTabFrame();
    setStage(frame ? { name: "selecting", frame, resume } : { name: "composing" });
  }

  function reset() {
    setStage({ name: "idle" });
    setBody("");
    setScreenshot(null);
  }

  const posting = uploading || fetcher.state !== "idle";

  async function post() {
    const text = body.trim();
    if (!text || posting) return;
    let screenshotKey = "";
    if (screenshot) {
      setUploading(true);
      try {
        screenshotKey = await uploadScreenshot(screenshot);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not upload the screenshot");
        return;
      } finally {
        setUploading(false);
      }
    }
    fetcher.submit(
      { intent: "create", body: text, screenshotKey, pagePath },
      { method: "post", action: "/feedback" },
    );
  }

  // The submit's own result, handled once: fetcher.data persists afterwards.
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok) {
      toast.success("Feedback posted");
      reset();
    } else {
      toast.error("Could not post your feedback");
    }
  }, [fetcher.state, fetcher.data, toast]);

  if (stage.name === "capturing") return null;

  if (stage.name === "selecting") {
    return (
      <ScreenshotSelector
        frame={stage.frame}
        onCapture={(image) => {
          setScreenshot(image);
          setStage({ name: "composing" });
        }}
        onSkip={() => setStage({ name: "composing" })}
        onCancel={() => setStage(stage.resume ? { name: "composing" } : { name: "idle" })}
      />
    );
  }

  return (
    <>
      <div className="fixed bottom-4 right-4 z-30 print:hidden">
        <Menu
          align="right"
          ariaLabel="Feedback"
          trigger={
            <button
              type="button"
              aria-label="Feedback"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-os-accent text-os-bg shadow-[0_8px_24px_var(--color-os-shadow)] transition-colors hover:bg-os-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent focus-visible:ring-offset-2"
            >
              <MessageSquarePlus className="h-5 w-5" aria-hidden />
            </button>
          }
        >
          <MenuItem icon={<MessagesSquare className="h-4 w-4" />} onSelect={onOpenFeed}>
            Feature requests
          </MenuItem>
          <MenuItem
            icon={<PenLine className="h-4 w-4" />}
            onSelect={canCapture ? () => startCapture(false) : () => setStage({ name: "composing" })}
          >
            Send feedback
          </MenuItem>
        </Menu>
      </div>

      <Modal
        open={stage.name === "composing"}
        onClose={reset}
        labelledBy={titleId}
        initialFocusRef={bodyRef}
        disableEscape={posting}
        containerClassName={modalCardClass("max-w-lg")}
      >
        <form
          className={cn(formClass, "flex flex-col gap-4")}
          onSubmit={(e) => {
            e.preventDefault();
            void post();
          }}
        >
          <h2 id={titleId} className="font-heading text-xl font-semibold text-foreground">
            Send feedback
          </h2>
          {previewUrl && (
            <div className="relative overflow-hidden rounded-os-item border border-os-container bg-os-well">
              <img src={previewUrl} alt="Screenshot" className="max-h-56 w-full object-contain" />
              <div className="absolute right-1.5 top-1.5 flex gap-1 rounded-os-item bg-os-card/90 p-0.5">
                <IconButton label="Retake" icon={Camera} onClick={() => startCapture(true)} />
                <IconButton
                  label="Remove screenshot"
                  icon={X}
                  tone="destructive"
                  onClick={() => setScreenshot(null)}
                />
              </div>
            </div>
          )}
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post();
            }}
            required
            rows={5}
            maxLength={FEEDBACK_BODY_MAX}
            placeholder="What should DALI OS do, or do better?"
            aria-label="Feedback"
            className="w-full resize-y"
          />
          <div className="flex items-center gap-2">
            {canCapture && !screenshot && (
              <IconButton
                label="Add screenshot"
                icon={Camera}
                tooltipSide="top"
                onClick={() => startCapture(true)}
              />
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={reset} disabled={posting}>
                Cancel
              </Button>
              <Button type="submit" disabled={posting || !body.trim()}>
                {posting ? "Posting" : "Post"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
