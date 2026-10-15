import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight, NotebookPen } from "lucide-react";
import { cn } from "~/lib/cn";
import type { ItemLocation, LocationFolder } from "~/components/drive/location";
import { CORAL_FOLDER, pickGlyph } from "~/components/drive/glyphs";
import { FolderGlyph } from "~/components/drive/FolderGlyph";
import { scopeIconFor } from "~/components/drive/scope-icon";

export type LocationNotebook = { id: string; title: string; href: string };

const CRUMB =
  "inline-flex min-w-0 max-w-full items-center gap-1 truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline";
const GLYPH = "h-3.5 w-3.5";

function FolderCrumbGlyph({ folder }: { folder: LocationFolder }) {
  const glyph = pickGlyph({
    type: "folder",
    iconEmoji: folder.iconEmoji,
    folderType: folder.folderType,
    system: folder.synthetic,
  });
  if (glyph.kind === "emoji") return <span className="shrink-0 text-xs leading-none">{glyph.emoji}</span>;
  if (glyph.kind !== "folder") return null;
  return <FolderGlyph glyph={glyph} className={GLYPH} markClassName="h-2 w-2" />;
}

function Crumb({
  kind,
  glyph,
  label,
  href,
  onClick,
}: {
  kind: "space" | "folder" | "notebook";
  glyph: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span data-testid={`drive-location-glyph-${kind}`} className="inline-flex shrink-0">
        {glyph}
      </span>
      <span className="truncate">{label}</span>
    </>
  );
  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  };
  if (href) {
    return (
      <Link
        to={href}
        data-testid="drive-location-crumb"
        data-crumb-kind={kind}
        onClick={(e) => e.stopPropagation()}
        {...stop}
        className={CRUMB}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-testid="drive-location-crumb"
      data-crumb-kind={kind}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      {...stop}
      className={CRUMB}
    >
      {content}
    </button>
  );
}

/** `Space ▸ Folder ▸ …`, each crumb its own link. Callers that navigate in place pass
 *  `onNavigate`; the rest pass `hrefFor` and get router links. */
export function LocationLink({
  location,
  onNavigate,
  hrefFor,
  notebook,
}: {
  location: ItemLocation | null;
  onNavigate?: (scopeId: string, folderId: string | null) => void;
  hrefFor?: (scopeId: string, folderId: string | null) => string;
  notebook?: LocationNotebook;
}) {
  if (!location) return <span aria-hidden="true" />;
  const { scopeId } = location;
  const target = (folderId: string | null) => ({
    href: hrefFor?.(scopeId, folderId),
    onClick: () => onNavigate?.(scopeId, folderId),
  });
  const crumbs: { key: string; node: ReactNode }[] = [
    {
      key: "space",
      node: (
        <Crumb
          kind="space"
          glyph={scopeIconFor({ id: scopeId }, "sm")}
          label={location.scopeLabel}
          {...target(null)}
        />
      ),
    },
    ...location.folders.map((f) => ({
      key: f.id,
      node: <Crumb kind="folder" glyph={<FolderCrumbGlyph folder={f} />} label={f.title} {...target(f.id)} />,
    })),
    ...(notebook
      ? [
          {
            key: `notebook-${notebook.id}`,
            node: (
              <Crumb
                kind="notebook"
                glyph={<NotebookPen className={cn(GLYPH, CORAL_FOLDER)} aria-hidden />}
                label={notebook.title}
                href={notebook.href}
              />
            ),
          },
        ]
      : []),
  ];
  return (
    <span data-testid="drive-location" className="flex min-w-0 max-w-full items-center gap-x-0.5 overflow-hidden whitespace-nowrap">
      {crumbs.map((c, i) => (
        <Fragment key={c.key}>
          {i > 0 && <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 opacity-60" />}
          {c.node}
        </Fragment>
      ))}
    </span>
  );
}
