import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Users } from "lucide-react";
import { SearchInput } from "~/components/ui/SearchInput";
import { EditableFavicon } from "./EditableFavicon";

export type ContactsRailOrg = {
  id: string;
  name: string;
  faviconChar: string | null;
  projectCount: number;
  lastTouchISO: string; // for sort + rough "touched" subtext
};

function sinceLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const d = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

export function ContactsRail({ orgs }: { orgs: ContactsRailOrg[] }) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? orgs.filter((o) => o.name.toLowerCase().includes(q))
      : orgs;
    return [...filtered].sort((a, b) => b.lastTouchISO.localeCompare(a.lastTouchISO));
  }, [orgs, query]);

  return (
    <section className="flex flex-col h-full min-h-0 rounded-os-card bg-os-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Users className="h-4 w-4 text-os-grey" aria-hidden />
        <div className="flex-1">
          <h2 className="section-title text-foreground">Contacts</h2>
          <p className="text-xs text-muted-foreground">
            {orgs.length} {orgs.length === 1 ? "organization" : "organizations"}
          </p>
        </div>
      </header>
      <div className="px-3 pt-2 pb-2">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search organizations"
          containerClassName="w-full"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        {rows.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-8">
            {query ? "Nothing matches." : "No organizations yet."}
          </p>
        ) : (
          rows.map((o) => (
            <div
              key={o.id}
              className="flex items-start gap-2.5 px-2 py-2 rounded-os-item hover:bg-os-hover group"
            >
              <EditableFavicon
                orgId={o.id}
                currentChar={o.faviconChar}
                name={o.name}
              />
              <Link
                to={`/partners/${o.id}`}
                className="min-w-0 flex-1 focus:outline-none"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {o.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {sinceLabel(o.lastTouchISO)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {o.projectCount} {o.projectCount === 1 ? "project" : "projects"}
                </div>
              </Link>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
