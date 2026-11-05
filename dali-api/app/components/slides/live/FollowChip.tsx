import { Button } from "~/components/ui/Button";

export interface FollowChipProps {
  presenterName: string;
  index: number;
  total: number;
  onBrowse: () => void;
}

export function FollowChip({ presenterName, index, total, onBrowse }: FollowChipProps) {
  return (
    <div
      role="status"
      className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-os-container bg-os-card px-3 py-1.5 text-xs text-os-fg shadow-lg"
    >
      <span className="h-2 w-2 rounded-full bg-os-green" aria-hidden />
      <span>
        Following {presenterName} · Slide {index + 1} of {total}
      </span>
      <span aria-hidden>·</span>
      <Button variant="ghost" size="xs" onClick={onBrowse}>
        Browse on my own
      </Button>
    </div>
  );
}
