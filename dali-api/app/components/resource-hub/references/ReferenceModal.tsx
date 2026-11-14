import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { FormField } from "~/components/ui/FormField";
import { Checkbox } from "~/components/ui/Checkbox";
import { uploadFileToS3 } from "~/lib/upload-client";
import { rawUploadUrl } from "~/components/doc";
import { safeHref } from "~/components/doc/components/kinds";

export const REFERENCE_ACCEPT = "image/*,.pdf,.doc,.docx,.ppt,.pptx,.key,.xls,.xlsx,.txt";

export type Creator = "mine" | "other";

export interface ReferenceValues {
  kind: "image" | "file" | "link";
  url: string;
  fileName: string;
  title: string;
  creator: Creator;
  creatorName: string;
  note: string;
}

export interface EditableReference {
  title: string;
  daliMade: boolean;
  creatorName: string | null;
  note: string | null;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, "");
const isWebLink = (href: string | null | undefined) => !!href && /^https?:\/\//i.test(href);

export function ReferenceModal({
  reference,
  busy,
  serverError,
  onClose,
  onSubmit,
}: {
  reference?: EditableReference;
  busy: boolean;
  serverError: string | null;
  onClose: () => void;
  onSubmit: (values: ReferenceValues) => void;
}) {
  const editing = !!reference;
  const { fieldLabel } = useOsChrome();
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [title, setTitle] = useState(reference?.title ?? "");
  const [titleEdited, setTitleEdited] = useState(editing);
  const [creator, setCreator] = useState<Creator>(reference ? (reference.daliMade ? "mine" : "other") : "other");
  const [creatorName, setCreatorName] = useState(reference?.creatorName ?? "");
  const [note, setNote] = useState(reference?.note ?? "");
  const [linkPreview, setLinkPreview] = useState<{ image: string | null; title: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const href = safeHref(link);
  const validLink = isWebLink(href);
  const ready = editing ? !!title.trim() : !!file || validLink;
  const working = busy || uploading;
  const imageFile = file?.type.startsWith("image/") ? file : null;
  const filePreview = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);

  useEffect(() => () => void (filePreview && URL.revokeObjectURL(filePreview)), [filePreview]);

  useEffect(() => {
    if (editing || !validLink || !href) {
      setLinkPreview(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      const body = new FormData();
      body.set("url", href);
      fetch("/api/link-preview", { method: "POST", body })
        .then((r) => (r.ok ? (r.json() as Promise<{ image: string | null; title: string | null }>) : null))
        .then((p) => live && setLinkPreview(p))
        .catch(() => live && setLinkPreview(null));
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [editing, validLink, href]);

  useEffect(() => {
    if (!titleEdited && linkPreview?.title) setTitle(linkPreview.title.slice(0, 120));
  }, [linkPreview, titleEdited]);

  const pickFile = (f: File) => {
    setFile(f);
    setLink("");
    setLinkPreview(null);
    if (!titleEdited) setTitle(stem(f.name).slice(0, 120));
  };

  const submit = async () => {
    if (!ready || working) return;
    setError(null);
    const shared = { title, creator, creatorName: creator === "other" ? creatorName : "", note };
    try {
      if (editing) return onSubmit({ ...shared, kind: "link", url: "", fileName: "" });
      if (file) {
        setUploading(true);
        const meta = await uploadFileToS3(file, "references", REFERENCE_ACCEPT);
        onSubmit({ ...shared, kind: imageFile ? "image" : "file", url: rawUploadUrl(meta.s3Key), fileName: file.name });
      } else {
        onSubmit({ ...shared, kind: "link", url: href!, fileName: "" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const previewSrc = filePreview ?? linkPreview?.image ?? null;

  return (
    <Modal open onClose={onClose} labelledBy="reference-modal-title" disableEscape={working} containerClassName={modalCardClass("max-w-lg os-form")}>
      <ModalHeader titleId="reference-modal-title" title={editing ? "Edit reference" : "Add reference"} onClose={onClose} className="!mb-5" />
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!editing && (
          <div className="flex flex-col gap-2">
            <span className={fieldLabel}>Reference</span>
            {file ? (
              <div className="flex items-center gap-2 rounded-lg border border-os-container bg-os-bg px-3 py-2 text-sm text-foreground">
                <FileText className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button type="button" aria-label="Remove file" onClick={() => setFile(null)} className="rounded p-1 text-os-grey hover:text-foreground">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="url"
                  aria-label="Link"
                  value={link}
                  inputMode="url"
                  autoFocus
                  placeholder="Paste a link"
                  onChange={(e) => setLink(e.target.value)}
                  className="min-w-0 flex-1"
                />
                <button type="button" onClick={() => fileRef.current?.click()} className="os-btn-ghost inline-flex shrink-0 items-center gap-1.5 text-sm">
                  <Upload className="h-4 w-4" aria-hidden />
                  Upload
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={REFERENCE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) pickFile(f);
              }}
            />
            {previewSrc && <img src={previewSrc} alt="" referrerPolicy="no-referrer" className="h-28 w-full rounded-lg border border-os-container bg-os-bg object-cover" />}
          </div>
        )}

        <FormField
          label="Title"
          value={title}
          placeholder={editing ? undefined : "Filled in from the link or file"}
          onChange={(v) => {
            setTitle(v.slice(0, 120));
            setTitleEdited(true);
          }}
        />

        {creator === "other" && <FormField label="Creator or source (optional)" value={creatorName} onChange={(v) => setCreatorName(v.slice(0, 120))} />}

        <FormField label="Note (optional)" multiline rows={2} value={note} placeholder="What makes this worth sharing?" onChange={(v) => setNote(v.slice(0, 400))} />

        <Checkbox tone="os" label="I made this" checked={creator === "mine"} onChange={(e) => setCreator(e.target.checked ? "mine" : "other")} />

        {(error || serverError) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? serverError}
          </p>
        )}
        <ModalFooter onCancel={onClose} cancelDisabled={working} className="!mt-0">
          <button type="submit" disabled={!ready || working} className="os-btn-primary disabled:opacity-50">
            {working ? (editing ? "Saving…" : "Adding…") : editing ? "Save" : "Add reference"}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
