import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type Ref,
} from "react";

// @-mention support for the shared RichTextEditor. The node stores the tagged
// user's id in attrs.id (read server-side by extractMentionUserIds) and their
// handle in attrs.label for display. The viewer variant only renders stored
// nodes; the editor variant adds the "@" typeahead backed by /api/mentions/search.

export type MentionUser = {
  id: string;
  name: string;
  handle: string;
  photoUrl?: string | null;
};

const MENTION_CLASS =
  "rounded bg-accent-coral/15 px-1 py-0.5 font-medium text-accent-coral";

// Read-only: renders mention nodes from stored JSON, no suggestion trigger.
export function mentionViewerExtension() {
  return Mention.configure({ HTMLAttributes: { class: MENTION_CLASS } });
}

// Editor: adds the typeahead. `search` hits the member-search endpoint.
export function mentionEditorExtension(search: (q: string) => Promise<MentionUser[]>) {
  return Mention.configure({
    HTMLAttributes: { class: MENTION_CLASS },
    suggestion: buildSuggestion(search),
  });
}

// Default fetch used by the modal — thin wrapper over the search endpoint.
export async function searchMentionableUsers(q: string): Promise<MentionUser[]> {
  try {
    const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(q)}`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { members?: MentionUser[] };
    return data.members ?? [];
  } catch {
    return [];
  }
}

type MentionListHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

function buildSuggestion(
  search: (q: string) => Promise<MentionUser[]>,
): Omit<SuggestionOptions<MentionUser>, "editor"> {
  return {
    items: ({ query }) => search(query),
    render: () => {
      let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
      let popup: HTMLDivElement | null = null;

      const place = (rect: DOMRect | null | undefined) => {
        if (!popup || !rect) return;
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 4}px`;
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          });
          popup = document.createElement("div");
          popup.style.position = "fixed";
          popup.style.zIndex = "60";
          popup.appendChild(component.element);
          document.body.appendChild(popup);
          place(props.clientRect?.());
        },
        onUpdate: (props) => {
          component?.updateProps(props);
          place(props.clientRect?.());
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            popup?.remove();
            popup = null;
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popup?.remove();
          popup = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}

type MentionListProps = SuggestionProps<MentionUser>;

const MentionList = forwardRef(function MentionList(
  props: MentionListProps,
  ref: Ref<MentionListHandle>,
) {
  const [selected, setSelected] = useState(0);
  const items = props.items;

  useEffect(() => setSelected(0), [items]);

  const pick = (index: number) => {
    const item = items[index];
    if (item) props.command({ id: item.id, label: item.handle } as unknown as MentionUser);
  };

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelected((s) => (s - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          pick(selected);
          return true;
        }
        return false;
      },
    }),
    [items, selected],
  );

  if (items.length === 0) {
    return (
      <div className="min-w-[12rem] rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-brand-2">
        No members found
      </div>
    );
  }

  return (
    <div className="min-w-[12rem] overflow-hidden rounded-lg border border-border bg-card py-1 text-sm shadow-brand-2">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          // onMouseDown (not onClick): fires before the editor loses focus, so
          // the mention inserts instead of the click being swallowed by blur.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(index);
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
            index === selected ? "bg-muted" : "hover:bg-muted/60"
          }`}
        >
          <span className="font-medium text-foreground">{item.name}</span>
          <span className="text-xs text-muted-foreground">@{item.handle}</span>
        </button>
      ))}
    </div>
  );
});
