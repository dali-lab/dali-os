import { useState } from "react";
import { FileText, Link2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Menu } from "~/components/ui/floating";
import type { ReferenceView } from "~/lib/references.server";

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60";

export function DaliMadeBadge() {
  return <span className="shrink-0 rounded-full bg-os-accent/15 px-2 py-0.5 text-[11px] font-medium leading-4 text-os-accent">DALI-made</span>;
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function Thumb({ item }: { item: ReferenceView }) {
  const [broken, setBroken] = useState(false);
  const src = item.kind === "image" ? item.url : item.previewUrl;
  if (src && !broken) {
    return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />;
  }
  const Icon = item.kind === "link" ? Link2 : FileText;
  const label = item.kind === "link" ? hostOf(item.url) : (item.fileName?.split(".").pop()?.toUpperCase() ?? "FILE");
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-os-grey">
      <Icon className="h-6 w-6" aria-hidden />
      <span className="max-w-[80%] truncate text-xs">{label}</span>
    </div>
  );
}

export function ReferenceCard({ item, onOpen, onEdit, onDelete }: { item: ReferenceView; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const body = (
    <>
      <span className="block aspect-[4/3] overflow-hidden rounded-xl border border-os-container bg-os-bg transition-[border-color] duration-150 group-hover:border-os-container-hi motion-reduce:transition-none">
        <Thumb item={item} />
      </span>
      <span className="mt-3 block truncate text-sm font-medium text-foreground">{item.title}</span>
      {item.creatorName && (
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 truncate text-xs text-os-grey">{item.creatorName}</span>
          {item.daliMade && <DaliMadeBadge />}
        </span>
      )}
      {!item.daliMade && <span className="block truncate text-xs text-os-muted">Shared by {item.sharedBy}</span>}
      {item.note && <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{item.note}</span>}
    </>
  );
  const manageable = item.mine || item.canDelete;
  return (
    <li className="group relative">
      {item.kind === "link" ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className={`block rounded-xl ${FOCUS}`}>
          {body}
        </a>
      ) : (
        <button type="button" onClick={onOpen} className={`block w-full rounded-xl text-left ${FOCUS}`}>
          {body}
        </button>
      )}
      {manageable && (
        <div className="absolute right-2 top-2">
          <Menu
            align="right"
            ariaLabel={`Actions for ${item.title}`}
            trigger={(open) => (
              <button
                type="button"
                aria-label={`Actions for ${item.title}`}
                className={`grid h-8 w-8 place-items-center rounded-lg border border-os-container bg-os-card/95 text-os-grey transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${open ? "opacity-100" : "opacity-0"} ${FOCUS}`}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            )}
          >
            {item.mine && (
              <Menu.Item icon={<Pencil className="h-4 w-4" aria-hidden />} onSelect={onEdit}>
                Edit
              </Menu.Item>
            )}
            {item.canDelete && (
              <Menu.Item icon={<Trash2 className="h-4 w-4" aria-hidden />} destructive onSelect={onDelete}>
                Delete
              </Menu.Item>
            )}
          </Menu>
        </div>
      )}
    </li>
  );
}
