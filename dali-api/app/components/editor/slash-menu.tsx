import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionOptions, type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type ComponentType,
  type Ref,
} from "react";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Minus,
  ListCollapse,
  Lightbulb,
  Table as TableIcon,
} from "lucide-react";

// Notion-style "/" insert menu. Reuses @tiptap/suggestion (same primitive as the
// mention typeahead) — the trigger removes the "/query" range and runs the
// chosen block command. Enabled only with the rich-blocks extension set, so all
// referenced commands (toggle, callout, table, task list) are registered.

type IconType = ComponentType<{ size?: number | string; className?: string }>;

type SlashItem = {
  title: string;
  subtitle: string;
  icon: IconType;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
};

const ITEMS: SlashItem[] = [
  {
    title: "Text",
    subtitle: "Plain paragraph",
    icon: Type,
    keywords: ["text", "paragraph", "plain"],
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    title: "Heading 1",
    subtitle: "Large section heading",
    icon: Heading1,
    keywords: ["h1", "heading", "title", "large"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    subtitle: "Medium section heading",
    icon: Heading2,
    keywords: ["h2", "heading", "subtitle"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    subtitle: "Small section heading",
    icon: Heading3,
    keywords: ["h3", "heading"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet list",
    subtitle: "Unordered list",
    icon: List,
    keywords: ["bullet", "unordered", "list", "ul"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    subtitle: "Ordered list",
    icon: ListOrdered,
    keywords: ["numbered", "ordered", "list", "ol"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    title: "To-do list",
    subtitle: "Checkbox task list",
    icon: ListChecks,
    keywords: ["todo", "task", "checkbox", "check"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    title: "Quote",
    subtitle: "Blockquote",
    icon: Quote,
    keywords: ["quote", "blockquote", "citation"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    subtitle: "Monospace code",
    icon: Code,
    keywords: ["code", "snippet", "pre"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    subtitle: "Horizontal rule",
    icon: Minus,
    keywords: ["divider", "hr", "rule", "separator"],
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
  {
    title: "Toggle",
    subtitle: "Collapsible section",
    icon: ListCollapse,
    keywords: ["toggle", "collapse", "details", "dropdown"],
    run: (e, r) => e.chain().focus().deleteRange(r).setToggleBlock().run(),
  },
  {
    title: "Callout",
    subtitle: "Highlighted note box",
    icon: Lightbulb,
    keywords: ["callout", "note", "info", "aside"],
    run: (e, r) => e.chain().focus().deleteRange(r).setCallout().run(),
  },
  {
    title: "Table",
    subtitle: "3×3 table with header",
    icon: TableIcon,
    keywords: ["table", "grid", "rows", "columns"],
    run: (e, r) =>
      e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

const SlashPluginKey = new PluginKey("slashCommand");

export function slashCommandExtension() {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          char: "/",
          // Only trigger at the start of an empty-ish line / after whitespace,
          // so "/" mid-word (e.g. a URL) doesn't pop the menu.
          allowSpaces: false,
          startOfLine: false,
          pluginKey: SlashPluginKey,
          command: ({ editor, range, props }) => props.run(editor, range),
          items: ({ query }) => {
            const q = query.toLowerCase();
            if (!q) return ITEMS;
            return ITEMS.filter(
              (i) =>
                i.title.toLowerCase().includes(q) ||
                i.keywords.some((k) => k.includes(q)),
            );
          },
          render: renderSlashList,
        } as Omit<SuggestionOptions<SlashItem>, "editor"> & { editor: Editor }),
      ];
    },
  });
}

function renderSlashList() {
  let component: ReactRenderer<SlashListHandle, SlashListProps> | null = null;
  let popup: HTMLDivElement | null = null;

  const place = (rect: DOMRect | null | undefined) => {
    if (!popup || !rect) return;
    // Flip above the caret if there isn't room below.
    const belowSpace = window.innerHeight - rect.bottom;
    popup.style.left = `${rect.left}px`;
    if (belowSpace < 280) {
      popup.style.top = "";
      popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      popup.style.bottom = "";
      popup.style.top = `${rect.bottom + 4}px`;
    }
  };

  return {
    onStart: (props: SlashListProps) => {
      component = new ReactRenderer(SlashList, { props, editor: props.editor });
      popup = document.createElement("div");
      popup.style.position = "fixed";
      popup.style.zIndex = "60";
      popup.appendChild(component.element);
      document.body.appendChild(popup);
      place(props.clientRect?.());
    },
    onUpdate: (props: SlashListProps) => {
      component?.updateProps(props);
      place(props.clientRect?.());
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
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
}

type SlashListProps = SuggestionProps<SlashItem>;
type SlashListHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

const SlashList = forwardRef(function SlashList(
  props: SlashListProps,
  ref: Ref<SlashListHandle>,
) {
  const [selected, setSelected] = useState(0);
  const items = props.items;

  useEffect(() => setSelected(0), [items]);

  const pick = (index: number) => {
    const item = items[index];
    if (item) props.command(item);
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
      <div className="min-w-[15rem] rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-brand-2">
        No blocks match
      </div>
    );
  }

  return (
    <div className="max-h-72 min-w-[16rem] overflow-y-auto rounded-lg border border-border bg-card py-1 text-sm shadow-brand-2">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <button
            key={item.title}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              pick(index);
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
              index === selected ? "bg-muted" : "hover:bg-muted/60"
            }`}
          >
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground">
              <Icon size={15} />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{item.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
});
