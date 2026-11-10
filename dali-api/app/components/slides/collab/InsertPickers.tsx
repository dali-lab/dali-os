import { useMemo, useRef, useState } from "react";
import { EmojiPicker } from "~/components/EmojiPicker";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { SearchInput } from "~/components/ui/SearchInput";
import { FormField } from "~/components/ui/FormField";
import { cleanVideoUrl } from "~/components/slides/deck/content";
import { ICON_NAMES, ICONS } from "~/components/slides/deck/icon-set";
import { cn } from "~/lib/cn";

const QUICK_EMOJI = ["👍", "🎉", "🚀", "💡", "⭐", "✅", "❤️", "🔥", "📈", "🎯", "🧠", "👀", "🙌", "💬", "📌", "⚡"];

export function iconMatches(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length === 0 ? ICON_NAMES : ICON_NAMES.filter((name) => words.every((w) => name.replace(/-/g, " ").includes(w)));
}

export function IconPickerModal({ open, current, onPick, onClose }: { open: boolean; current?: string; onPick: (name: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const names = useMemo(() => iconMatches(query), [query]);
  return (
    <Modal open={open} onClose={onClose} labelledBy="slide-icon-title" initialFocusRef={input} containerClassName="w-full max-w-lg rounded-os-card bg-os-card p-5 shadow-xl">
      <ModalHeader titleId="slide-icon-title" title="Choose an icon" onClose={onClose} className="mb-3" />
      <SearchInput ref={input} size="sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search icons" aria-label="Search icons" />
      <div role="listbox" aria-label="Icons" className="mt-3 grid h-72 grid-cols-8 content-start gap-1 overflow-y-auto">
        {names.map((name) => {
          const Icon = ICONS[name];
          return (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={current === name}
              aria-label={name.replace(/-/g, " ")}
              title={name.replace(/-/g, " ")}
              onClick={() => onPick(name)}
              className={cn("flex h-10 items-center justify-center rounded-md text-os-fg transition-colors hover:bg-os-hover", current === name && "bg-os-hover ring-1 ring-os-accent")}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </button>
          );
        })}
        {names.length === 0 && <p className="col-span-8 p-3 text-center text-sm text-os-grey">No icons found.</p>}
      </div>
    </Modal>
  );
}

export function EmojiPickerModal({ open, onPick, onClose }: { open: boolean; onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="slide-emoji-title" containerClassName="w-full max-w-sm rounded-os-card bg-os-card p-4 shadow-xl">
      <ModalHeader titleId="slide-emoji-title" title="Choose an emoji" onClose={onClose} className="mb-3" />
      <EmojiPicker quick={QUICK_EMOJI} onPick={(emoji, imageUrl) => !imageUrl && onPick(emoji)} onClose={onClose} />
    </Modal>
  );
}

export function VideoUrlModal({ open, current = "", title = "Add a video", confirmLabel = "Add video", onSubmit, onClose }: { open: boolean; current?: string; title?: string; confirmLabel?: string; onSubmit: (url: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(current);
  const valid = cleanVideoUrl(value) !== null;
  const touched = value.trim() !== "";
  return (
    <Modal open={open} onClose={onClose} labelledBy="slide-video-title" containerClassName="w-full max-w-md rounded-os-card bg-os-card p-5 shadow-xl">
      <ModalHeader titleId="slide-video-title" title={title} onClose={onClose} className="mb-3" />
      <form
        className="os-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(value.trim());
        }}
      >
        <FormField label="Video link" value={value} onChange={setValue} placeholder="https://www.youtube.com/watch?v=" hint={touched && !valid ? "Paste a YouTube link." : "Paste a YouTube link. It plays when you present."} />
        <ModalFooter onCancel={onClose}>
          <Button type="submit" size="sm" disabled={!valid}>
            {confirmLabel}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
