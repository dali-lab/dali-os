import { Users } from "lucide-react";

export function PageBarShareButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Share" className="os-edit-btn os-edit-btn--strong h-8">
      <Users className="h-4 w-4" />
      <span className="hidden sm:inline">Share</span>
    </button>
  );
}
