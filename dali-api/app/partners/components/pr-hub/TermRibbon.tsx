import { ArrowUpRight } from "lucide-react";

export type RibbonTerm = {
  id: string;
  code: string;
  sortKey: number;
  isCurrent: boolean;
  projectCount: number;
  partnerCount: number;
};

export function TermRibbon({ terms, onPick }: { terms: RibbonTerm[]; onPick: (termId: string) => void }) {
  const current = terms.find((term) => term.isCurrent);
  return (
    <section className="hub-term-ribbon" aria-label="Explore terms">
      {terms.map((term) => (
        <button type="button" key={term.id} onClick={() => onPick(term.id)} className={`hub-term-tile${term.isCurrent ? " is-current" : ""}`}>
          <div><span>{term.isCurrent ? "Current term" : current && term.sortKey < current.sortKey ? "Past term" : "Scheduled"}</span><ArrowUpRight aria-hidden /></div>
          <strong>{term.code}</strong>
          <p>{term.projectCount} projects <span>·</span> {term.partnerCount} partners</p>
        </button>
      ))}
    </section>
  );
}
