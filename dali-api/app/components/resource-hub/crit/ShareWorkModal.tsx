import { useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { modalCardClass } from "~/components/os-chrome";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { uploadFileToS3 } from "~/lib/upload-client";
import { rawUploadUrl } from "~/components/doc";
import { safeHref } from "~/components/doc/components/kinds";

const ACCEPT = "image/*,.pdf,.doc,.docx,.ppt,.pptx,.key,.xls,.xlsx,.txt";
const FIELD =
  "w-full rounded-lg border border-os-container-hi bg-os-bg px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-os-muted focus:border-os-accent focus:ring-2 focus:ring-os-accent/25 disabled:opacity-50";

export interface ShareValues {
  kind: "image" | "file" | "link";
  url: string;
  fileName: string;
  title: string;
  question: string;
  anonymous: boolean;
}

export function ShareWorkModal({
  userName,
  busy,
  serverError,
  onClose,
  onSubmit,
}: {
  userName: string;
  busy: boolean;
  serverError: string | null;
  onClose: () => void;
  onSubmit: (values: ShareValues) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const href = safeHref(link);
  const validLink = !!href && /^https?:\/\//i.test(href);
  const ready = !!file || validLink;
  const working = busy || uploading;

  const submit = async () => {
    if (!ready || working) return;
    setError(null);
    try {
      if (file) {
        setUploading(true);
        const meta = await uploadFileToS3(file, "crit-wall", ACCEPT);
        onSubmit({ kind: file.type.startsWith("image/") ? "image" : "file", url: rawUploadUrl(meta.s3Key), fileName: file.name, title, question, anonymous });
      } else {
        onSubmit({ kind: "link", url: href!, fileName: "", title, question, anonymous });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="share-work-title"
      disableEscape={working}
      containerClassName={modalCardClass("max-w-lg")}
    >
      <ModalHeader titleId="share-work-title" title="Share work" subtitle="Post something you're working on and ask for thoughts." onClose={onClose} className="!mb-4" />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Work</span>
          {file ? (
            <div className="flex items-center gap-2 rounded-lg border border-os-container bg-os-bg px-3 py-2 text-sm text-foreground">
              <FileText className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button type="button" aria-label="Remove file" onClick={() => setFile(null)} className="rounded p-1 text-os-grey hover:text-foreground">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-20 items-center justify-center gap-2 rounded-lg border border-dashed border-os-container-hi text-sm text-os-grey transition-colors duration-150 hover:border-os-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60"
            >
              <Upload className="h-4 w-4" aria-hidden />
              Upload an image or document
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) {
                setFile(f);
                setLink("");
              }
            }}
          />
          <input
            aria-label="Link"
            value={link}
            disabled={!!file}
            inputMode="url"
            placeholder="Or paste a link to Figma, Google Docs, a website…"
            onChange={(e) => setLink(e.target.value)}
            className={`${FIELD} h-9`}
          />
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
          Title <span className="sr-only">(optional)</span>
          <input value={title} maxLength={120} placeholder={file ? file.name : "Optional, we'll use the file or page name"} onChange={(e) => setTitle(e.target.value)} className={`${FIELD} h-9 font-normal`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
          <span>
            Question <span className="font-normal text-os-grey">Optional</span>
          </span>
          <textarea rows={2} value={question} maxLength={400} placeholder="What would you like feedback on?" onChange={(e) => setQuestion(e.target.value)} className={`${FIELD} resize-none py-2 font-normal`} />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium text-foreground">Post as</legend>
          {[
            { value: false, label: userName },
            { value: true, label: "Anonymous" },
          ].map((o) => (
            <label key={String(o.value)} className="flex items-center gap-2 text-sm text-foreground">
              <input type="radio" name="post-as" checked={anonymous === o.value} onChange={() => setAnonymous(o.value)} className="accent-[var(--color-os-accent)]" />
              {o.label}
            </label>
          ))}
        </fieldset>
        {(error || serverError) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? serverError}
          </p>
        )}
        <ModalFooter onCancel={onClose} cancelDisabled={working} className="!mt-1">
          <button type="submit" disabled={!ready || working} className="os-btn-primary os-btn-primary--sm disabled:opacity-50">
            {working ? "Posting…" : "Post to Crit Wall"}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
