import { useState, type ReactNode } from "react";
import type { InsertItem } from "./InsertMenu";
import { EmojiPickerModal, IconPickerModal, VideoUrlModal } from "./InsertPickers";
import type { ContentInsert } from "./useFreeformEditor";

type Pending = { type: "icon" | "emoji" | "video"; at?: { x: number; y: number } } | null;

/** One entry point for every Insert menu item, so a toolbar, a context menu or a shortcut can place the same things. */
export function useInsertItems({
  insert,
  arm,
  pickImage,
}: {
  insert: ContentInsert;
  arm: (tool: { type: "text" } | { type: "shape"; shape: "rect" | "rounded" | "ellipse" | "line" | "arrow" } | null) => void;
  pickImage: (at?: { x: number; y: number }) => void;
}): { insertItem: (item: InsertItem, at?: { x: number; y: number }) => void; pickers: ReactNode } {
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);
  const insertItem = (item: InsertItem, at?: { x: number; y: number }) => {
    switch (item.type) {
      case "text":
        return at ? insert.text(at) : arm({ type: "text" });
      case "shape":
        return at ? insert.shape(item.shape, at) : arm({ type: "shape", shape: item.shape });
      case "image":
        return at ? pickImage(at) : pickImage();
      case "table":
        return void insert.table(at);
      case "code":
        return void insert.code(at);
      case "chart":
        return void insert.chart(item.chart, at);
      case "icon":
      case "emoji":
      case "video":
        return setPending({ type: item.type, at });
    }
  };
  const pickers = (
    <>
      {pending?.type === "icon" && (
        <IconPickerModal
          open
          onClose={close}
          onPick={(name) => {
            insert.icon(name, pending.at);
            close();
          }}
        />
      )}
      {pending?.type === "emoji" && (
        <EmojiPickerModal
          open
          onClose={close}
          onPick={(emoji) => {
            if (insert.emoji(emoji, pending.at)) close();
          }}
        />
      )}
      {pending?.type === "video" && (
        <VideoUrlModal
          open
          onClose={close}
          onSubmit={(url) => {
            if (insert.video(url, pending.at)) close();
          }}
        />
      )}
    </>
  );
  return { insertItem, pickers };
}
