import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { cn } from "~/lib/cn";
import { CUSTOM_EMOJI_MAX_BYTES } from "~/lib/file-validation";
import { CUSTOM_EMOJI_NAME } from "~/lib/reactions";
import type { CustomEmojiItem } from "~/lib/reactions.server";
import { uploadFileToS3 } from "~/lib/upload-client";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { SearchInput } from "~/components/ui/SearchInput";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

type EmojiData = {
  categories: { id: string; emojis: string[] }[];
  emojis: Record<string, { name: string; keywords: string[]; skins: { native: string }[] }>;
};

type Tile = { emoji: string; label: string; imageUrl?: string; custom?: CustomEmojiItem };
type Section = { id: string; label: string; tiles: Tile[] };

const CATEGORY_LABELS: Record<string, string> = {
  people: "Smileys and people",
  nature: "Animals and nature",
  foods: "Food and drink",
  activity: "Activities",
  places: "Travel and places",
  objects: "Objects",
  symbols: "Symbols",
  flags: "Flags",
};

const SEARCH_LIMIT = 64;
const EMOJI_API = "/api/custom-emoji";
const EMOJI_SIZE = 128;

const toTile = (data: EmojiData, id: string): Tile => ({
  emoji: data.emojis[id].skins[0].native,
  label: data.emojis[id].name,
});

const customTile = (c: CustomEmojiItem): Tile => ({
  emoji: `:${c.name}:`,
  label: `:${c.name}:`,
  imageUrl: c.imageUrl,
  custom: c,
});

/** The picker's sections: everything by category, or the matches for a search. */
export function emojiSections(
  data: EmojiData | null,
  custom: CustomEmojiItem[],
  query: string,
): Section[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const matches = (text: string) => words.every((w) => text.includes(w));
    const standard = Object.entries(data?.emojis ?? {})
      .filter(([id, e]) => matches(`${id} ${e.name} ${e.keywords.join(" ")}`.toLowerCase()))
      .map(([id]) => toTile(data!, id));
    const tiles = [...custom.filter((c) => matches(c.name)).map(customTile), ...standard];
    return tiles.length > 0
      ? [{ id: "results", label: "Results", tiles: tiles.slice(0, SEARCH_LIMIT) }]
      : [];
  }
  return [
    ...(custom.length > 0
      ? [{ id: "custom", label: "Custom", tiles: custom.map(customTile) }]
      : []),
    ...(data?.categories ?? []).map((c) => ({
      id: c.id,
      label: CATEGORY_LABELS[c.id] ?? c.id,
      tiles: c.emojis.flatMap((id) => (data!.emojis[id] ? [toTile(data!, id)] : [])),
    })),
  ];
}

/** "Party Parrot (1).png" becomes "party-parrot-1". */
export function emojiNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// A canvas would flatten a GIF, so GIFs go up untouched, and the S3 policy
// holds them to the same cap.
export async function prepareEmojiFile(file: File): Promise<File> {
  if (file.type === "image/gif") {
    if (file.size > CUSTOM_EMOJI_MAX_BYTES) throw new Error("GIFs can be up to 256 KB.");
    return new File([file], "emoji.gif", { type: "image/gif" });
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, EMOJI_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (blob?.type !== "image/png") throw new Error("That image could not be read.");
  return new File([blob], "emoji.png", { type: "image/png" });
}

async function emojiRequest(body: Record<string, string>): Promise<CustomEmojiItem[]> {
  const res = await fetch(EMOJI_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { emoji?: CustomEmojiItem[]; error?: string };
  if (!res.ok || !json.emoji) throw new Error(json.error ?? "Something went wrong.");
  return json.emoji;
}

const TILE = "flex h-9 w-9 items-center justify-center rounded-os-item text-xl hover:bg-os-container focus-visible:bg-os-container focus-visible:outline-none";

// Memoized: the grid is about 1,800 buttons and the preview changes on every hover.
const EmojiGrid = memo(function EmojiGrid({
  sections,
  onPick,
  onPreview,
}: {
  sections: Section[];
  onPick: (tile: Tile) => void;
  onPreview: (tile: Tile) => void;
}) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} className="[contain-intrinsic-size:auto_320px] [content-visibility:auto]">
          <h3 className="px-1 pb-1 pt-2 text-xs font-semibold text-os-grey">{section.label}</h3>
          <div className="grid grid-cols-8">
            {section.tiles.map((tile) => (
              <button
                key={tile.emoji}
                type="button"
                aria-label={tile.label}
                className={TILE}
                onClick={() => onPick(tile)}
                onMouseEnter={() => onPreview(tile)}
                onFocus={() => onPreview(tile)}
              >
                {tile.imageUrl ? (
                  <img src={tile.imageUrl} alt="" loading="lazy" className="h-6 w-6 object-contain" />
                ) : (
                  tile.emoji
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
});

function AddEmojiForm({
  onAdded,
  onCancel,
}: {
  onAdded: (emoji: CustomEmojiItem[]) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    try {
      setFile(await prepareEmojiFile(picked));
      if (!name) setName(emojiNameFromFile(picked.name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That image could not be read.");
    }
  }

  async function save() {
    if (!file || saving) return;
    setSaving(true);
    try {
      const { s3Key } = await uploadFileToS3(file, "custom-emoji", "image/png,image/gif");
      onAdded(await emojiRequest({ intent: "add", name, imageKey: s3Key }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the emoji");
      setSaving(false);
    }
  }

  return (
    <form
      className="os-form flex flex-col gap-3 p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3 className="text-sm font-semibold text-foreground">Add emoji</h3>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="Emoji image"
        className="hidden"
        onChange={choose}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Choose image"
          onClick={() => inputRef.current?.click()}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-os-item bg-os-container text-os-grey hover:text-foreground"
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-10 w-10 object-contain" />
          ) : (
            <ImagePlus className="h-5 w-5" aria-hidden />
          )}
        </button>
        <p className="text-xs text-os-grey">PNG, JPG, WebP or GIF. GIFs can be up to 256 KB.</p>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value.toLowerCase())}
        maxLength={48}
        placeholder="Name, like party-parrot"
        aria-label="Emoji name"
        autoComplete="off"
        className="w-full"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !file || !CUSTOM_EMOJI_NAME.test(name)}>
          {saving ? "Adding" : "Add"}
        </Button>
      </div>
    </form>
  );
}

/** Search, a quick row, every standard emoji by category, and the lab's custom emoji. */
export function EmojiPicker({
  quick,
  onPick,
  onClose,
}: {
  quick: readonly string[];
  onPick: (emoji: string, imageUrl?: string) => void;
  onClose: () => void;
}) {
  const dialog = useDialog();
  const toast = useToast();
  const [data, setData] = useState<EmojiData | null>(null);
  // Null for someone outside the lab: they can use what's on a post, not add any.
  const [custom, setCustom] = useState<CustomEmojiItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<Tile | null>(null);

  useEffect(() => {
    let live = true;
    void import("@emoji-mart/data/sets/15/native.json").then((m) => {
      if (live) setData(m.default as unknown as EmojiData);
    });
    void fetch(EMOJI_API, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { emoji: CustomEmojiItem[] } | null) => {
        if (live && json) setCustom(json.emoji);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const sections = useMemo(() => emojiSections(data, custom ?? [], query), [data, custom, query]);

  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pickTile = useCallback((tile: Tile) => pickRef.current(tile.emoji, tile.imageUrl), []);

  async function remove(item: CustomEmojiItem) {
    // The panel sits above the dialog layer and would cover the confirm.
    onClose();
    const ok = await dialog.confirm({
      title: `Delete :${item.name}:?`,
      description: "Reactions already using it stay and show its name as text.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await emojiRequest({ intent: "delete", id: item.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the emoji");
    }
  }

  if (adding) {
    return (
      <AddEmojiForm
        onCancel={() => setAdding(false)}
        onAdded={(emoji) => {
          setCustom(emoji);
          setAdding(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 p-0.5">
        <SearchInput
          size="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
          containerClassName="min-w-0 flex-1"
        />
        {custom && <IconButton label="Add emoji" icon={Plus} onClick={() => setAdding(true)} />}
      </div>
      {!query && (
        <div className="grid grid-cols-8 border-b border-os-container pb-1">
          {quick.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={TILE}
              onClick={() => pickTile({ emoji, label: emoji })}
              onMouseEnter={() => setPreview({ emoji, label: emoji })}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      <div className="h-64 overflow-y-auto px-0.5">
        {sections.length > 0 ? (
          <EmojiGrid sections={sections} onPick={pickTile} onPreview={setPreview} />
        ) : (
          <p className="p-3 text-center text-sm text-os-grey">{data ? "No emoji found." : "Loading"}</p>
        )}
      </div>
      <div className="flex h-9 items-center gap-2 border-t border-os-container px-1 pt-1 text-xs text-os-grey">
        {preview && (
          <>
            <span className={cn("shrink-0", preview.imageUrl ? "" : "text-lg")}>
              {preview.imageUrl ? (
                <img src={preview.imageUrl} alt="" className="h-5 w-5 object-contain" />
              ) : (
                preview.emoji
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {preview.custom?.addedBy
                ? `${preview.label}, added by ${preview.custom.addedBy}`
                : preview.label}
            </span>
            {preview.custom?.canDelete && (
              <IconButton
                label="Delete emoji"
                icon={Trash2}
                tone="destructive"
                onClick={() => void remove(preview.custom!)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
