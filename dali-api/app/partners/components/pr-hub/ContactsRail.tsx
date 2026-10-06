import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Pencil, ArrowUpRight, FolderKanban } from "lucide-react";
import { SearchInput } from "~/components/ui/SearchInput";
import { EditableFavicon } from "./EditableFavicon";
import { PartnerFavicon } from "./PartnerFavicon";
import {
  SlideOver,
  SheetField,
  SheetDivider,
  SheetPrimaryLink,
  SheetSecondaryLink,
} from "./SlideOver";

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

export function ContactsRail({ orgs, canEdit = false }: { orgs: ContactsRailOrg[]; canEdit?: boolean }) {
  const [query, setQuery] = useState("");
  const [peekId, setPeekId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? orgs.filter((o) => o.name.toLowerCase().includes(q))
      : orgs;
    return [...filtered].sort((a, b) => b.lastTouchISO.localeCompare(a.lastTouchISO));
  }, [orgs, query]);

  const peek = useMemo(
    () => (peekId ? orgs.find((o) => o.id === peekId) ?? null : null),
    [peekId, orgs]
  );

  return (
    <section className="hub-panel hub-contacts">
      <header className="hub-section-heading">
        <div className="flex-1">
          <h2>People behind the projects</h2>
          <p className="text-xs text-muted-foreground">
            {orgs.length} {orgs.length === 1 ? "organization" : "organizations"}
          </p>
        </div>
        <Link to="/partners/organizations" className="hub-text-link" aria-label="View all organizations"><ArrowUpRight aria-hidden /></Link>
      </header>
      <div className="px-3 pt-2 pb-2">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search organizations"
          aria-label="Search organizations"
          containerClassName="w-full"
        />
      </div>
      <div className="hub-contact-list">
        {rows.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-8">
            {query ? "Nothing matches." : "No organizations yet."}
          </p>
        ) : (
          rows.map((o) => (
            <div
              key={o.id}
              className="hub-contact-row"
            >
              {canEdit ? <EditableFavicon
                orgId={o.id}
                currentChar={o.faviconChar}
                name={o.name}
              /> : <PartnerFavicon char={o.faviconChar} name={o.name} />}
              <button
                type="button"
                onClick={() => setPeekId(o.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground break-words">
                    {o.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {sinceLabel(o.lastTouchISO)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {o.projectCount} {o.projectCount === 1 ? "project" : "projects"}
                </div>
              </button>
            </div>
          ))
        )}
      </div>

      <SlideOver
        open={!!peek}
        onClose={() => setPeekId(null)}
        accent="teal"
        overline="Partner organization"
        title={peek?.name ?? ""}
        subtitle={peek ? `${peek.projectCount} ${peek.projectCount === 1 ? "project" : "projects"} on record` : undefined}
        footer={
          peek && (
            <div className="flex items-center justify-end gap-2">
              <SheetSecondaryLink to={`/partners/${peek.id}#edit`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit details
              </SheetSecondaryLink>
              <SheetPrimaryLink to={`/partners/${peek.id}`}>
                Open page
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </SheetPrimaryLink>
            </div>
          )
        }
      >
        {peek && (
          <div className="space-y-5 pt-2">
            <div className="flex items-center gap-3">
              <PartnerFavicon
                char={peek.faviconChar}
                name={peek.name}
                size="md"
              />
              <div className="min-w-0">
                <div
                  className="text-[13px] font-medium truncate"
                  style={{ color: "#F5F7FA" }}
                >
                  {peek.name}
                </div>
                <div
                  className="text-xs truncate"
                  style={{ color: "rgba(245,247,250,0.55)" }}
                >
                  Last touch · {sinceLabel(peek.lastTouchISO)}
                </div>
              </div>
            </div>

            <SheetDivider />

            <SheetField label="Projects">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-3.5 w-3.5" aria-hidden />
                <span>
                  {peek.projectCount} active {peek.projectCount === 1 ? "project" : "projects"}
                </span>
              </div>
            </SheetField>

            <SheetField label="Shortcut">
              <Link
                to={`/partners/${peek.id}`}
                className="inline-flex items-center gap-1.5 text-[13px] underline-offset-2 hover:underline"
                style={{ color: "#00ADAB" }}
              >
                /partners/{peek.id}
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            </SheetField>

            <p className="text-xs" style={{ color: "rgba(245,247,250,0.5)" }}>
              Full editing (memberships, projects, applications) lives on the
              organization page — the shortcut above opens it in the same tab.
            </p>
          </div>
        )}
      </SlideOver>
    </section>
  );
}
