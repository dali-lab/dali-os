import { useEffect, useRef, useState } from "react";
import { PageIconPicker } from "~/components/doc-chrome/PageIconPicker";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

export function PageTitleHeader({
  title,
  iconEmoji,
  canEdit,
  onRename,
  onIconChange,
  className,
}: {
  title: string;
  iconEmoji: string | null;
  canEdit: boolean;
  onRename: (name: string) => void | Promise<void>;
  onIconChange: (emoji: string | null) => void;
  className?: string;
}) {
  const { pageTitle } = useOsChrome();
  const [icon, setIcon] = useState(iconEmoji);
  const [draft, setDraft] = useState(title);
  const cancelled = useRef(false);

  useEffect(() => setIcon(iconEmoji), [iconEmoji]);
  useEffect(() => setDraft(title), [title]);

  function changeIcon(next: string | null) {
    setIcon(next);
    onIconChange(next);
  }

  function commit() {
    const next = draft.trim();
    if (!cancelled.current && next && next !== title) void onRename(next);
    else setDraft(title);
    cancelled.current = false;
  }

  return (
    <div className={cn("group/header", className)}>
      {canEdit && !icon && (
        <div className="mb-1 flex h-6 items-center opacity-0 transition-opacity duration-150 group-hover/header:opacity-100 group-focus-within/header:opacity-100 touch:opacity-100">
          <PageIconPicker size="md" iconEmoji={null} canEdit onChange={changeIcon} />
        </div>
      )}
      <div className="flex items-center gap-2">
        {icon && <PageIconPicker size="md" iconEmoji={icon} canEdit={canEdit} onChange={changeIcon} />}
        {canEdit ? (
          <input
            aria-label="Title"
            value={draft}
            placeholder="Untitled"
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
            className={cn(pageTitle, "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50")}
          />
        ) : (
          <h1 className={cn(pageTitle, "min-w-0 truncate")}>{title || "Untitled"}</h1>
        )}
      </div>
    </div>
  );
}
