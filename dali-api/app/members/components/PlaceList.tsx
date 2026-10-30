import { MapPin, X } from "lucide-react";
import { useNavigate } from "react-router";
import { Avatar } from "~/components/ui/Avatar";
import { IconButton } from "~/components/ui/IconButton";
import { LoadMore } from "~/components/ui/Pager";
import { SearchInput } from "~/components/ui/SearchInput";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { useClientSlice } from "~/hooks/useClientSlice";
import { cn } from "~/lib/cn";
import type { ConnectAlum, ConnectPlace } from "~/members/lib/connect";

export function PlaceList({
  places,
  selected,
  onSelect,
  query,
  onQueryChange,
  hasAlumni,
}: {
  places: ConnectPlace[];
  selected: ConnectPlace | null;
  onSelect: (key: string | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  hasAlumni: boolean;
}) {
  const shown = selected ? [selected] : places;
  const rows = shown.flatMap((p) => p.alumni.map((a) => ({ place: p, alum: a })));
  const { visible, pager } = useClientSlice(rows, {
    resetKey: JSON.stringify([query, selected?.key ?? null]),
  });
  const sections = visible.reduce<{ place: ConnectPlace; alumni: ConnectAlum[] }[]>((acc, row) => {
    const last = acc.at(-1);
    if (last?.place.key === row.place.key) last.alumni.push(row.alum);
    else acc.push({ place: row.place, alumni: [row.alum] });
    return acc;
  }, []);
  const count = places.reduce((n, p) => n + p.alumni.length, 0);
  return (
    <>
      <SearchInput
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search by name, place or company"
      />
      <div className="flex items-center justify-between gap-2 text-xs text-os-grey">
        {selected ? (
          <>
            <span className="truncate font-semibold text-foreground">{selected.label}</span>
            <IconButton label="Show all places" icon={X} onClick={() => onSelect(null)} />
          </>
        ) : (
          <span>
            {count} {count === 1 ? "alum" : "alumni"} in {places.length}{" "}
            {places.length === 1 ? "place" : "places"}
          </span>
        )}
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {places.length === 0 ? (
          <p className="py-6 text-center text-sm text-os-muted">
            {hasAlumni ? "No alumni match." : "No alumni on the map yet."}
          </p>
        ) : (
          sections.map(({ place: p, alumni }) => (
            <section key={p.key} className="mb-3 last:mb-0">
              {!selected && (
                <button
                  type="button"
                  onClick={() => onSelect(p.key)}
                  className="flex w-full items-center gap-1.5 py-1.5 text-left text-xs font-semibold text-os-grey hover:text-foreground"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{p.label}</span>
                  <span className="ml-auto text-os-muted">{p.alumni.length}</span>
                </button>
              )}
              {alumni.map((a) => (
                <AlumRow key={a.id} alum={a} />
              ))}
            </section>
          ))
        )}
        <LoadMore {...pager} />
      </div>
    </>
  );
}

function AlumRow({ alum }: { alum: ConnectAlum }) {
  const navigate = useNavigate();
  const url = `/members/${alum.id}`;
  return (
    <button
      type="button"
      onClick={() => {
        if (!requestOpenTabIfEmbedded(url, alum.name)) navigate(url);
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-os-item px-2 py-2 text-left transition-colors hover:bg-os-container",
      )}
    >
      <Avatar photoUrl={alum.photoUrl} name={alum.name} size="sm" userId={alum.id} className="shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">
          {alum.name}
          {alum.classYear && <span className="text-os-grey"> '{String(alum.classYear).slice(2)}</span>}
        </span>
        {alum.currentJob && (
          <span className="block truncate text-xs text-os-grey">{alum.currentJob}</span>
        )}
      </span>
    </button>
  );
}
