import type { ComponentType } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  Crop,
  EyeOff,
  Group,
  Image as ImageIcon,
  LayoutGrid as GalleryIcon,
  Pencil,
  PanelTop,
  Palette,
  SeparatorHorizontal,
  Layers,
  LayoutTemplate,
  Link,
  Lock,
  LockOpen,
  MessageSquarePlus,
  MousePointerSquareDashed,
  Paintbrush,
  PaintBucket,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Shapes,
  Trash2,
  Type,
  Ungroup,
} from "lucide-react";
import { expandToLeaves, isDetached } from "~/components/slides/deck/freeform";
import type { AlignMode } from "~/components/slides/deck/geometry";
import type { ReorderDirection } from "~/components/slides/deck/freeform-ops";
import { LAYOUTS } from "~/components/slides/deck/layouts";
import { SHAPE_KINDS, SHAPE_LABELS } from "~/components/slides/deck/model";
import type { InsertItem } from "./InsertMenu";
import { BACKGROUND_LABELS, BACKGROUND_TOKENS, type SlideBackground } from "~/components/slides/deck/slide-meta";
import type { RenderElement, RenderSlide } from "~/components/slides/deck/snapshot";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export interface ActionSpec {
  id: string;
  label: string;
  icon?: IconType;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  dividerBefore?: boolean;
  run?: () => void;
  children?: ActionSpec[];
}

const compact = (list: Array<ActionSpec | null | false>): ActionSpec[] => list.filter((a): a is ActionSpec => Boolean(a));

export function findAction(list: ActionSpec[], id: string): ActionSpec | undefined {
  for (const a of list) {
    if (a.id === id) return a;
    const inner = a.children && findAction(a.children, id);
    if (inner) return inner;
  }
  return undefined;
}

export function actionIds(list: ActionSpec[]): string[] {
  return list.flatMap((a) => [a.id, ...(a.children ? actionIds(a.children) : [])]);
}

export interface ElementHandlers {
  cut: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  remove: () => void;
  copyStyle: () => void;
  pasteStyle: () => void;
  reorder: (dir: ReorderDirection) => void;
  align: (mode: AlignMode, to: "slide" | "selection") => void;
  group: () => void;
  ungroup: () => void;
  lock: (locked: boolean) => void;
  replaceImage: (id: string) => void;
  crop: (id: string) => void;
  resetSize: (id: string) => void;
  addLink: (id: string) => void;
  toggleBuild: (id: string) => void;
  comment: (id: string) => void;
  snapBack: (id: string) => void;
}

export interface ElementActionContext {
  slide: RenderSlide;
  selection: string[];
  canPaste: boolean;
  styleClip: "text" | "shape" | null;
  canComment: boolean;
  handlers: ElementHandlers;
}

const ALIGN_ROWS: Array<{ mode: AlignMode; label: string; icon: IconType }> = [
  { mode: "left", label: "Left", icon: AlignStartVertical },
  { mode: "center", label: "Center", icon: AlignCenterVertical },
  { mode: "right", label: "Right", icon: AlignEndVertical },
  { mode: "top", label: "Top", icon: AlignStartHorizontal },
  { mode: "middle", label: "Middle", icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Bottom", icon: AlignEndHorizontal },
];

export interface SelectionFacts {
  leaves: RenderElement[];
  single: RenderElement | null;
  anyLocked: boolean;
  allLocked: boolean;
  hasGroup: boolean;
}

export function selectionFacts(slide: RenderSlide, selection: string[]): SelectionFacts {
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  const leaves = expandToLeaves(slide, selection).map((id) => byId.get(id)).filter((e): e is RenderElement => Boolean(e));
  const picked = selection.map((id) => byId.get(id)).filter((e): e is RenderElement => Boolean(e));
  return {
    leaves,
    single: picked.length === 1 && picked[0].kind !== "group" ? picked[0] : null,
    anyLocked: leaves.some((e) => e.locked),
    allLocked: leaves.length > 0 && leaves.every((e) => e.locked),
    hasGroup: picked.some((e) => e.kind === "group"),
  };
}

export function arrangeActions(h: ElementHandlers, locked = false): ActionSpec[] {
  return [
    { id: "arrange-front", label: "Bring to front", shortcut: "⇧⌘]", icon: ArrowUpToLine, run: () => h.reorder("front") },
    { id: "arrange-forward", label: "Bring forward", shortcut: "⌘]", icon: ArrowUpToLine, run: () => h.reorder("forward") },
    { id: "arrange-backward", label: "Send backward", shortcut: "⌘[", icon: ArrowDownToLine, run: () => h.reorder("backward") },
    { id: "arrange-back", label: "Send to back", shortcut: "⇧⌘[", icon: ArrowDownToLine, run: () => h.reorder("back") },
  ].map((a) => ({ ...a, disabled: locked }));
}

/** The right-click menu for the selected elements. The format bar's arrange and more menus are cut from this same list. */
export function elementActions(ctx: ElementActionContext): ActionSpec[] {
  const { slide, selection, handlers: h } = ctx;
  const f = selectionFacts(slide, selection);
  if (f.leaves.length === 0) return [];
  const single = f.single;
  const deletable = f.leaves.some((e) => e.slot === null || e.kind === "image") && !f.anyLocked;
  const to: "slide" | "selection" = f.leaves.length > 1 ? "selection" : "slide";
  const styleKind = single && (single.kind === "text" || single.kind === "shape") ? single.kind : null;
  const buildLabel = single?.build ? "Remove build" : "Add build";
  return compact([
    { id: "cut", label: "Cut", shortcut: "⌘X", icon: Scissors, disabled: !deletable, run: h.cut },
    { id: "copy", label: "Copy", shortcut: "⌘C", icon: Copy, run: h.copy },
    { id: "paste", label: "Paste", shortcut: "⌘V", icon: ClipboardPaste, disabled: !ctx.canPaste, run: h.paste },
    { id: "duplicate", label: "Duplicate", shortcut: "⌘D", icon: Layers, run: h.duplicate },
    { id: "delete", label: "Delete", shortcut: "⌫", icon: Trash2, destructive: true, disabled: !deletable, run: h.remove },
    { id: "copy-style", label: "Copy style", shortcut: "⌥⌘C", icon: Paintbrush, dividerBefore: true, disabled: !styleKind, run: h.copyStyle },
    { id: "paste-style", label: "Paste style", shortcut: "⌥⌘V", icon: PaintBucket, disabled: !styleKind || ctx.styleClip !== styleKind || f.anyLocked, run: h.pasteStyle },
    {
      id: "arrange",
      label: "Arrange",
      icon: Layers,
      dividerBefore: true,
      children: arrangeActions(h, f.anyLocked),
    },
    {
      id: "align",
      label: to === "selection" ? "Align to selection" : "Align to slide",
      icon: AlignCenterVertical,
      disabled: f.anyLocked,
      children: ALIGN_ROWS.map((r) => ({ id: `align-${r.mode}`, label: r.label, icon: r.icon, run: () => h.align(r.mode, to) })),
    },
    f.hasGroup ? { id: "ungroup", label: "Ungroup", shortcut: "⇧⌘G", icon: Ungroup, run: h.ungroup } : f.leaves.length >= 2 ? { id: "group", label: "Group", shortcut: "⌘G", icon: Group, run: h.group } : null,
    f.allLocked ? { id: "unlock", label: "Unlock", icon: LockOpen, run: () => h.lock(false) } : { id: "lock", label: "Lock", icon: Lock, run: () => h.lock(true) },
    single?.kind === "image" && { id: "replace-image", label: "Replace image", icon: ImageIcon, dividerBefore: true, disabled: single.locked, run: () => h.replaceImage(single.id) },
    single?.kind === "image" && { id: "crop", label: "Crop", icon: Crop, disabled: single.locked, run: () => h.crop(single.id) },
    single?.kind === "image" && { id: "reset-size", label: "Reset size", icon: RotateCcw, disabled: single.locked, run: () => h.resetSize(single.id) },
    single?.kind === "text" && { id: "add-link", label: "Add link", shortcut: "⌘K", icon: Link, dividerBefore: true, disabled: single.locked, run: () => h.addLink(single.id) },
    single && { id: "build", label: buildLabel, icon: Redo2, run: () => h.toggleBuild(single.id) },
    single && ctx.canComment && { id: "comment", label: "Comment", icon: MessageSquarePlus, run: () => h.comment(single.id) },
    single && isDetached(single) && { id: "snap-back", label: "Snap back to layout", icon: RotateCcw, dividerBefore: true, disabled: single.locked, run: () => h.snapBack(single.id) },
  ]);
}

export interface StageHandlers {
  paste: () => void;
  insert: (item: InsertItem) => void;
  changeLayout: (layoutId: string) => void;
  openLayoutGallery: () => void;
  setBackground: (background: SlideBackground | null) => void;
  pickBackgroundImage: () => void;
  selectAll: () => void;
  comment: () => void;
  setGuides: (on: boolean) => void;
  setGrid: (on: boolean) => void;
}

export interface StageActionContext {
  layoutId: string;
  background?: SlideBackground;
  canPaste: boolean;
  canComment: boolean;
  guides: boolean;
  grid: boolean;
  handlers: StageHandlers;
}

/** The right-click menu for empty space on the slide. */
export function stageActions(ctx: StageActionContext): ActionSpec[] {
  const h = ctx.handlers;
  return compact([
    { id: "paste-here", label: "Paste here", shortcut: "⌘V", icon: ClipboardPaste, disabled: !ctx.canPaste, run: h.paste },
    { id: "add-text", label: "Add text box here", icon: Type, dividerBefore: true, run: () => h.insert({ type: "text" }) },
    {
      id: "add-shape",
      label: "Add shape here",
      icon: Shapes,
      children: SHAPE_KINDS.map((s) => ({ id: `add-shape-${s}`, label: SHAPE_LABELS[s], run: () => h.insert({ type: "shape", shape: s }) })),
    },
    { id: "add-image", label: "Add image here", icon: ImageIcon, run: () => h.insert({ type: "image" }) },
    {
      id: "insert-here",
      label: "Insert here",
      icon: Plus,
      children: [
        { id: "insert-table", label: "Table", run: () => h.insert({ type: "table" }) },
        { id: "insert-chart-bar", label: "Bar chart", run: () => h.insert({ type: "chart", chart: "bar" }) },
        { id: "insert-chart-line", label: "Line chart", run: () => h.insert({ type: "chart", chart: "line" }) },
        { id: "insert-chart-pie", label: "Pie chart", run: () => h.insert({ type: "chart", chart: "pie" }) },
        { id: "insert-code", label: "Code block", run: () => h.insert({ type: "code" }) },
        { id: "insert-icon", label: "Icon", run: () => h.insert({ type: "icon" }) },
        { id: "insert-emoji", label: "Emoji", run: () => h.insert({ type: "emoji" }) },
        { id: "insert-video", label: "Video", run: () => h.insert({ type: "video" }) },
      ],
    },
    {
      id: "change-layout",
      label: "Change layout",
      icon: LayoutTemplate,
      dividerBefore: true,
      children: [
        { id: "layout-gallery", label: "Browse layouts", icon: GalleryIcon, run: h.openLayoutGallery },
        ...LAYOUTS.map((l, i) => ({ id: `layout-${l.id}`, label: l.name, dividerBefore: i === 0, checked: l.id === ctx.layoutId, run: () => h.changeLayout(l.id) })),
      ],
    },
    {
      id: "background",
      label: "Background",
      icon: Palette,
      children: [
        ...BACKGROUND_TOKENS.map((token) => ({
          id: `background-${token}`,
          label: BACKGROUND_LABELS[token],
          checked: token === "ground" ? !ctx.background : ctx.background?.kind === "color" && ctx.background.token === token,
          run: () => h.setBackground(token === "ground" ? null : { kind: "color", token }),
        })),
        { id: "background-image", label: "Image", icon: ImageIcon, dividerBefore: true, checked: ctx.background?.kind === "image", run: h.pickBackgroundImage },
      ],
    },
    { id: "select-all", label: "Select all", shortcut: "⌘A", icon: MousePointerSquareDashed, run: h.selectAll },
    ctx.canComment && { id: "comment-here", label: "Comment here", icon: MessageSquarePlus, run: h.comment },
    { id: "guides", label: "Show guides", checked: ctx.guides, dividerBefore: true, run: () => h.setGuides(!ctx.guides) },
    { id: "grid", label: "Show grid", checked: ctx.grid, run: () => h.setGrid(!ctx.grid) },
  ]);
}

export interface ThumbnailHandlers {
  newAfter: () => void;
  duplicate: () => void;
  remove: () => void;
  skip: (skipped: boolean) => void;
  changeLayout: (layoutId: string) => void;
  openLayoutGallery: () => void;
  addSection: () => void;
  renameSection: () => void;
  removeSection: () => void;
  copy: () => void;
  paste: () => void;
  moveTo: (where: "top" | "bottom") => void;
  comment: () => void;
}

export interface ThumbnailActionContext {
  targets: RenderSlide[];
  index: number;
  count: number;
  canPaste: boolean;
  canComment: boolean;
  startsSection?: boolean;
  handlers: ThumbnailHandlers;
}

/** The right-click menu for one thumbnail, or for the group of thumbnails it belongs to. */
export function thumbnailActions(ctx: ThumbnailActionContext): ActionSpec[] {
  const h = ctx.handlers;
  const many = ctx.targets.length > 1;
  const noun = many ? "slides" : "slide";
  const allSkipped = ctx.targets.every((s) => s.skipped);
  const layouts = new Set(ctx.targets.map((s) => s.layoutId));
  const atTop = !many && ctx.index === 0;
  return compact([
    { id: "new-after", label: "New slide after", icon: Plus, run: h.newAfter },
    { id: "duplicate", label: `Duplicate ${noun}`, icon: Layers, run: h.duplicate },
    { id: "delete", label: `Delete ${noun}`, icon: Trash2, destructive: true, run: h.remove },
    { id: "skip", label: allSkipped ? `Unskip ${noun}` : `Skip ${noun}`, icon: EyeOff, dividerBefore: true, run: () => h.skip(!allSkipped) },
    {
      id: "change-layout",
      label: "Change layout",
      icon: LayoutTemplate,
      children: [
        { id: "layout-gallery", label: "Browse layouts", icon: GalleryIcon, run: h.openLayoutGallery },
        ...LAYOUTS.map((l, i) => ({ id: `layout-${l.id}`, label: l.name, dividerBefore: i === 0, checked: layouts.size === 1 && layouts.has(l.id), run: () => h.changeLayout(l.id) })),
      ],
    },
    !many && !ctx.startsSection && { id: "add-section", label: "Add section here", icon: SeparatorHorizontal, run: h.addSection },
    !many && Boolean(ctx.startsSection) && { id: "rename-section", label: "Rename section", icon: Pencil, run: h.renameSection },
    !many && Boolean(ctx.startsSection) && { id: "remove-section", label: "Remove section", icon: PanelTop, run: h.removeSection },
    { id: "copy-slide", label: `Copy ${noun}`, icon: Copy, dividerBefore: true, run: h.copy },
    { id: "paste-slide", label: "Paste slide", icon: ClipboardPaste, disabled: !ctx.canPaste, run: h.paste },
    { id: "move-top", label: "Move to top", icon: ArrowUpToLine, dividerBefore: true, disabled: atTop, run: () => h.moveTo("top") },
    { id: "move-bottom", label: "Move to bottom", icon: ArrowDownToLine, disabled: !many && ctx.index === ctx.count - 1, run: () => h.moveTo("bottom") },
    !many && ctx.canComment && { id: "comment", label: "Comment", icon: MessageSquarePlus, dividerBefore: true, run: h.comment },
  ]);
}

export interface SectionHandlers {
  rename: () => void;
  remove: () => void;
  moveUp: () => void;
  moveDown: () => void;
}

export function sectionActions(h: SectionHandlers, position: { first: boolean; last: boolean }): ActionSpec[] {
  return [
    { id: "section-rename", label: "Rename section", icon: Pencil, run: h.rename },
    { id: "section-up", label: "Move section up", icon: ArrowUpToLine, disabled: position.first, run: h.moveUp },
    { id: "section-down", label: "Move section down", icon: ArrowDownToLine, disabled: position.last, run: h.moveDown },
    { id: "section-remove", label: "Remove section", icon: Trash2, destructive: true, dividerBefore: true, run: h.remove },
  ];
}
