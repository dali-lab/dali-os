import { ArrowRight, BarChart3, Circle, Braces, Code2, Image as ImageIcon, LineChart, Minus, PieChart, Plus, Shapes, Smile, Square, Table2, Type, Video, Vote } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Button } from "~/components/ui/Button";
import { Menu } from "~/components/ui/floating";
import { useFeatureFlag } from "~/components/FeatureFlags";
import type { ChartType } from "~/components/slides/deck/content";
import { SHAPE_KINDS, SHAPE_LABELS, type ShapeKind } from "~/components/slides/deck/model";

export type InsertItem =
  | { type: "text" }
  | { type: "image" }
  | { type: "video" }
  | { type: "table" }
  | { type: "chart"; chart: ChartType }
  | { type: "code" }
  | { type: "icon" }
  | { type: "emoji" }
  | { type: "poll" }
  | { type: "html" }
  | { type: "shape"; shape: ShapeKind };

const ICON = "h-3.5 w-3.5";

const SHAPE_ICONS: Record<ShapeKind, ReactNode> = {
  rect: <Square className={ICON} aria-hidden />,
  rounded: <Square className={ICON} aria-hidden />,
  ellipse: <Circle className={ICON} aria-hidden />,
  line: <Minus className={ICON} aria-hidden />,
  arrow: <ArrowRight className={ICON} aria-hidden />,
};

interface Entry {
  label: string;
  icon: ReactNode;
  item: InsertItem;
}

export const INSERT_GROUPS: Entry[][] = [
  [
    { label: "Text box", icon: <Type className={ICON} aria-hidden />, item: { type: "text" } },
    { label: "Image", icon: <ImageIcon className={ICON} aria-hidden />, item: { type: "image" } },
    { label: "Video", icon: <Video className={ICON} aria-hidden />, item: { type: "video" } },
  ],
  [
    { label: "Table", icon: <Table2 className={ICON} aria-hidden />, item: { type: "table" } },
    { label: "Bar chart", icon: <BarChart3 className={ICON} aria-hidden />, item: { type: "chart", chart: "bar" } },
    { label: "Line chart", icon: <LineChart className={ICON} aria-hidden />, item: { type: "chart", chart: "line" } },
    { label: "Pie chart", icon: <PieChart className={ICON} aria-hidden />, item: { type: "chart", chart: "pie" } },
    { label: "Code block", icon: <Code2 className={ICON} aria-hidden />, item: { type: "code" } },
    { label: "Custom HTML", icon: <Braces className={ICON} aria-hidden />, item: { type: "html" } },
  ],
  [
    { label: "Icon", icon: <Shapes className={ICON} aria-hidden />, item: { type: "icon" } },
    { label: "Emoji", icon: <Smile className={ICON} aria-hidden />, item: { type: "emoji" } },
  ],
  SHAPE_KINDS.map((shape) => ({ label: SHAPE_LABELS[shape], icon: SHAPE_ICONS[shape], item: { type: "shape" as const, shape } })),
];

const POLL_ENTRY: Entry = { label: "Poll", icon: <Vote className={ICON} aria-hidden />, item: { type: "poll" } };

export function InsertMenu({ armed, onInsert }: { armed: boolean; onInsert: (item: InsertItem) => void }) {
  const live = useFeatureFlag("slides-live");
  const groups = live ? INSERT_GROUPS.map((g, i) => (i === 2 ? [...g, POLL_ENTRY] : g)) : INSERT_GROUPS;
  return (
    <Menu
      ariaLabel="Insert"
      trigger={
        <Button variant="ghost" size="sm" aria-pressed={armed}>
          <Plus className={ICON} aria-hidden />
          Insert
        </Button>
      }
    >
      {groups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <Menu.Separator />}
          {group.map((entry) => (
            <Menu.Item key={entry.label} icon={entry.icon} onSelect={() => onInsert(entry.item)}>
              {entry.label}
            </Menu.Item>
          ))}
        </Fragment>
      ))}
    </Menu>
  );
}
