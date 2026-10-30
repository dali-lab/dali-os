import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";

export interface LoadMoreProps {
  hasMore: boolean;
  onLoadMore: () => void | Promise<void>;
  loading?: boolean;
  failed?: boolean;
  shown?: number;
  total?: number;
  className?: string;
}

export function LoadMore({ hasMore, onLoadMore, loading, failed, shown, total, className }: LoadMoreProps) {
  if (!hasMore) return null;
  return (
    <div className={cn("flex flex-col items-center gap-2 py-2", className)}>
      {shown !== undefined && total !== undefined && (
        <p className="text-xs text-os-muted">
          Showing {shown.toLocaleString()} of {total.toLocaleString()}
        </p>
      )}
      {failed && <p className="text-xs text-os-muted">Couldn't load more. Try again.</p>}
      <Button variant="secondary" size="sm" onClick={() => void onLoadMore()} disabled={loading}>
        {loading ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}

export function PagerLinks({
  page,
  hasNext,
  hrefFor,
  label,
  endLabel,
}: {
  page: number;
  hasNext: boolean;
  hrefFor: (page: number) => string;
  label: string;
  endLabel?: string;
}) {
  const { iconBtn } = useOsChrome();
  const pageLinkClass = cn(iconBtn, "border border-os-container");
  return (
    <nav className="flex items-center justify-between" aria-label={label}>
      {page > 1 ? (
        <Tooltip content="Previous">
          <Link to={hrefFor(page - 1)} prefetch="render" aria-label="Previous" className={pageLinkClass}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Tooltip>
      ) : (
        <span />
      )}
      {hasNext ? (
        <Tooltip content="Next">
          <Link to={hrefFor(page + 1)} prefetch="render" aria-label="Next" className={pageLinkClass}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Tooltip>
      ) : (
        <span className="text-xs text-os-muted">{endLabel ?? "End of list"}</span>
      )}
    </nav>
  );
}
