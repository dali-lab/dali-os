import { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Code2,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  Link2,
  Palette,
  Video,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { parseVideoEmbed } from "~/lib/video-embed";
import { collectionCategories, filterCollection, safeHref, type ComponentData } from "./kinds";

export const COLLECTION_ICONS: Record<string, { label: string; Icon: LucideIcon }> = {
  link: { label: "Link", Icon: Link2 },
  doc: { label: "Document", Icon: FileText },
  palette: { label: "Design", Icon: Palette },
  code: { label: "Code", Icon: Code2 },
  book: { label: "Reading", Icon: BookOpen },
  wrench: { label: "Tool", Icon: Wrench },
  video: { label: "Video", Icon: Video },
  image: { label: "Image", Icon: ImageIcon },
  globe: { label: "Website", Icon: Globe },
  layers: { label: "Library", Icon: Layers },
};

const CATEGORY_TONES = ["accent", "success", "warning", "danger", "neutral"] as const;

export function categoryTone(categories: string[], category: string | undefined): string {
  const i = categories.findIndex((c) => c.toLowerCase() === (category ?? "").trim().toLowerCase());
  return i < 0 ? "neutral" : CATEGORY_TONES[i % CATEGORY_TONES.length]!;
}

export function CollectionTileBody({ item, categories }: { item: Record<string, string>; categories: string[] }) {
  const Icon = (COLLECTION_ICONS[item.icon ?? ""] ?? COLLECTION_ICONS.link!).Icon;
  return (
    <>
      <span className={`dali-cmp-coll__icon dali-cmp-tone--${categoryTone(categories, item.category)}`} aria-hidden>
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <span className="dali-cmp-coll__text">
        <span className="dali-cmp-coll__name">{item.title || "Untitled resource"}</span>
        {item.description && <span className="dali-cmp-coll__desc">{item.description}</span>}
        {item.category && <span className="dali-cmp-coll__cat">{item.category}</span>}
      </span>
    </>
  );
}

export function CollectionFilters({
  categories,
  active,
  onChange,
}: {
  categories: string[];
  active: string | null;
  onChange: (category: string | null) => void;
}) {
  if (categories.length === 0) return null;
  const tabs: (string | null)[] = [null, ...categories];
  return (
    <div className="dali-cmp-coll__filters" role="group" aria-label="Filter by category">
      {tabs.map((c) => (
        <button
          key={c ?? "all"}
          type="button"
          aria-pressed={active === c}
          className="dali-cmp-coll__chip"
          onClick={() => onChange(c)}
        >
          {c ?? "All"}
        </button>
      ))}
    </div>
  );
}

type Preview = { image: string | null; title: string | null; description: string | null };

function ResourceOverlay({ item, onClose }: { item: Record<string, string>; onClose: () => void }) {
  const href = safeHref(item.href) ?? "";
  const internal = href.startsWith("/");
  const video = internal ? null : parseVideoEmbed(href);
  const web = /^https?:/i.test(href);
  const [preview, setPreview] = useState<Preview | "loading" | null>(!internal && !video && web ? "loading" : null);

  useEffect(() => {
    if (internal || video || !web) return;
    let live = true;
    const body = new FormData();
    body.set("url", href);
    fetch("/api/link-preview", { method: "POST", body })
      .then((r) => r.json() as Promise<Preview>)
      .then((d) => live && setPreview(d))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [href, internal, video, web]);

  const domain = (() => {
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch {
      return href;
    }
  })();

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="coll-overlay-title"
      className="fixed inset-0 z-[100] flex overflow-y-auto bg-black/40 p-3 sm:p-6"
      containerClassName="m-auto w-full max-w-4xl rounded-os-card bg-os-card p-4 shadow-xl sm:p-6"
    >
      <ModalHeader
        titleId="coll-overlay-title"
        title={item.title || "Resource"}
        subtitle={item.description || undefined}
        onClose={onClose}
        className="!mb-4"
        actions={
          <a
            href={href}
            target={internal ? undefined : "_blank"}
            rel={internal ? undefined : "noopener noreferrer"}
            className="os-btn-ghost inline-flex items-center gap-1.5 text-sm"
          >
            Open original
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        }
      />
      {internal ? (
        <iframe
          title={item.title || "Resource"}
          src={href}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          className="h-[65vh] w-full rounded-xl border border-os-container bg-os-card"
        />
      ) : video ? (
        <div className="aspect-video w-full overflow-hidden rounded-xl border border-os-container bg-black">
          <iframe
            title={item.title || "Video"}
            src={video.embedUrl}
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="fullscreen"
            referrerPolicy="no-referrer"
            className="h-full w-full"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-os-container bg-os-bg p-4 sm:flex-row">
          {preview === "loading" ? (
            <div className="aspect-video w-full animate-pulse rounded-lg bg-os-hover sm:w-64" aria-hidden />
          ) : preview && preview.image ? (
            <img src={preview.image} alt="" referrerPolicy="no-referrer" className="aspect-video w-full rounded-lg object-cover sm:w-64" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{(preview && preview !== "loading" && preview.title) || item.title}</p>
            {preview && preview !== "loading" && preview.description && <p className="mt-1 text-sm text-muted-foreground">{preview.description}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{domain}</p>
            <p className="mt-3 text-sm text-muted-foreground">This site can't be shown here, so it opens in a new tab.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function CollectionView({ fields, items }: ComponentData) {
  const [open, setOpen] = useState(fields.open !== "0");
  const [category, setCategory] = useState<string | null>(null);
  const [active, setActive] = useState<Record<string, string> | null>(null);
  const categories = collectionCategories(fields, items);
  const shown = filterCollection(items, category);

  return (
    <div className={`dali-cmp-coll${open ? " dali-cmp-coll--open" : ""}`}>
      <button type="button" className="dali-cmp-coll__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="dali-cmp-title">{fields.title}</span>
        <ChevronDown className="dali-cmp-coll__chev" size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <div className="dali-cmp-coll__body" inert={!open}>
        <div className="dali-cmp-coll__inner">
          <CollectionFilters categories={categories} active={category} onChange={setCategory} />
          <div className="dali-cmp-coll__grid">
            {shown.map((it, i) => {
              const href = safeHref(it.href);
              return href ? (
                <a
                  key={i}
                  href={href}
                  className="dali-cmp-coll__tile"
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    setActive(it);
                  }}
                >
                  <CollectionTileBody item={it} categories={categories} />
                </a>
              ) : (
                <div key={i} className="dali-cmp-coll__tile">
                  <CollectionTileBody item={it} categories={categories} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {active && <ResourceOverlay item={active} onClose={() => setActive(null)} />}
    </div>
  );
}
