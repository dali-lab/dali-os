import type { CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";

export type TermCount = { id: string; code: string; sortKey: number; isCurrent: boolean; projectCount: number };
export type DomainCount = { name: string; count: number };

// Shared palette for every domain-colored surface (bar segments + domain bars).
const DOMAIN_PALETTE = [
  "#58b7b6", // teal
  "#f3978b", // coral
  "#e4b936", // yellow
  "#c994d7", // violet
  "#a2d483", // lime
  "#a8d3de", // sky
  "#f0a37a", // amber
  "#8da1e8", // periwinkle
];
const UNKNOWN_DOMAIN_COLOR = "#8c8c95";

export function ProjectStats({
  terms,
  domainsAll,
  projectDomainsByTerm,
  domainBreakdownByTerm,
  selectedTermId,
  onSelectTerm,
  onOpenTerm,
}: {
  terms: TermCount[];
  domainsAll: DomainCount[];
  projectDomainsByTerm: Record<string, string[]>;
  domainBreakdownByTerm: Record<string, DomainCount[]>;
  selectedTermId: string | null;
  onSelectTerm: (termId: string) => void;
  onOpenTerm?: (termId: string) => void;
}) {
  const sorted = [...terms].sort((a, b) => a.sortKey - b.sortKey);
  const maxCount = Math.max(1, ...sorted.map((t) => t.projectCount));

  // Deterministic color per domain name, consistent across bars.
  const colorByDomain = new Map<string, string>();
  domainsAll.forEach((d, i) => colorByDomain.set(d.name, DOMAIN_PALETTE[i % DOMAIN_PALETTE.length]));
  const colorFor = (name: string) => colorByDomain.get(name) ?? UNKNOWN_DOMAIN_COLOR;

  const selectedTerm = sorted.find((t) => t.id === selectedTermId) ?? null;
  const breakdown = selectedTerm ? (domainBreakdownByTerm[selectedTerm.id] ?? []) : [];
  const breakdownMax = Math.max(1, ...breakdown.map((d) => d.count));
  const breakdownTotal = breakdown.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="hub-stats-grid">
      <section className="hub-chart hub-term-chart" aria-label="Projects per term">
        <header>
          <div><h3>Projects per term</h3></div>
          <span className="hub-chart-key">Click a term to break it down →</span>
        </header>
        {sorted.length ? (
          <div className="hub-term-bars">
            {sorted.map((term) => {
              const stackDomains = projectDomainsByTerm[term.id] ?? [];
              const isSelected = term.id === selectedTermId;
              const heightPct = (term.projectCount / maxCount) * 100;
              return (
                <button
                  key={term.id}
                  type="button"
                  className={`hub-term-bar-cell${term.isCurrent ? " is-current" : ""}${isSelected ? " is-selected" : ""}`}
                  onClick={() => onSelectTerm(term.id)}
                  onDoubleClick={() => onOpenTerm?.(term.id)}
                  aria-pressed={isSelected}
                  aria-label={`${term.code}: ${term.projectCount} projects. Select to break down by domain.`}
                >
                  <span className="hub-term-bar-count">{term.projectCount}</span>
                  <div className="hub-term-bar-track">
                    <div className="hub-term-bar" style={{ height: `${heightPct}%` }}>
                      {stackDomains.map((domainName, idx) => (
                        <span
                          key={idx}
                          className="hub-term-bar-segment"
                          style={{ background: colorFor(domainName) }}
                          title={domainName}
                        />
                      ))}
                    </div>
                  </div>
                  <span className="hub-term-bar-label">{term.code}<ArrowUpRight aria-hidden /></span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="hub-empty">No terms configured yet.</p>
        )}
      </section>
      <section className="hub-chart hub-domain-chart" aria-label="Projects per domain">
        <header>
          <div>
            <h3>Projects per domain</h3>
            <p>{selectedTerm ? `Term ${selectedTerm.code} · dominant discipline per project.` : "Pick a term on the left."}</p>
          </div>
          <span className="hub-chart-total">{breakdownTotal}<small>projects</small></span>
        </header>
        {selectedTerm && breakdown.length ? (
          <div className="hub-domain-list">
            {breakdown.map((domain) => (
              <div
                className="hub-domain-row"
                key={domain.name}
                style={{ "--domain-color": colorFor(domain.name) } as CSSProperties}
              >
                <div>
                  <span><i className="hub-diamond" aria-hidden />{domain.name}</span>
                  <strong>{domain.count}</strong>
                </div>
                <div className="hub-domain-track" aria-hidden>
                  <span style={{ width: `${(domain.count / breakdownMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="hub-empty">
            {selectedTerm
              ? "No staffed projects in this term yet."
              : "Pick a term on the left to see which domains dominate."}
          </p>
        )}
      </section>
    </div>
  );
}
