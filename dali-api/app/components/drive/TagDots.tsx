import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { hexColor, visibleTagDots, type DriveItemTag } from "~/lib/drive-tags";

function dotClass(color: string | null) {
  return cn("block h-2 w-2 rounded-full ring-1 ring-background", !hexColor(color) && "bg-muted-foreground/50");
}

function Dot({ tag, onApply }: { tag: DriveItemTag; onApply?: (tagId: string) => void }) {
  const style = { backgroundColor: hexColor(tag.color) };
  const className = dotClass(tag.color);
  if (!onApply) return <span data-testid="tag-dot" className={className} style={style} />;
  return (
    <button
      type="button"
      data-testid="tag-dot"
      aria-label={`Filter by tag ${tag.label}`}
      onClick={(e) => {
        e.stopPropagation();
        onApply(tag.id);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(className, "cursor-pointer hover:scale-125 transition-transform")}
      style={style}
    />
  );
}

/** Up to three colored dots after a row's title, +N when there are more. */
export function TagDots({
  tags,
  onApply,
  className,
}: {
  tags: DriveItemTag[] | undefined;
  onApply?: (tagId: string) => void;
  className?: string;
}) {
  const { shown, overflow } = visibleTagDots(tags);
  if (shown.length === 0) return null;
  return (
    <Tooltip content={(tags ?? []).map((t) => t.label).join(", ")}>
      <span data-testid="tag-dots" className={cn("inline-flex shrink-0 items-center gap-1", className)}>
        {shown.map((tag) => (
          <Dot key={tag.id} tag={tag} onApply={onApply} />
        ))}
        {overflow > 0 && (
          <span data-testid="tag-dots-overflow" className="text-[10px] font-medium text-muted-foreground">
            +{overflow}
          </span>
        )}
      </span>
    </Tooltip>
  );
}

/** Every tag by label with its dot, for the details pane. */
export function TagLabels({ tags }: { tags: DriveItemTag[] }) {
  return (
    <ul data-testid="tag-labels" className="flex flex-col gap-1">
      {tags.map((tag) => (
        <li key={tag.id} className="flex items-center gap-2">
          <span className={dotClass(tag.color)} style={{ backgroundColor: hexColor(tag.color) }} />
          <span className="truncate">{tag.label}</span>
        </li>
      ))}
    </ul>
  );
}
