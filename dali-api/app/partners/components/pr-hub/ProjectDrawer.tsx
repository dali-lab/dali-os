import { Link } from "react-router";
import { X, ArrowUpRight, FileText, Users } from "lucide-react";
import { Modal } from "~/components/Modal";
import { PartnerFavicon } from "./PartnerFavicon";

export type DrawerApplication = {
  id: string;
  title: string;
  status: string;
  partnerName: string;
  faviconChar: string | null;
  summary: string | null;
  updatedAt: string;
  contactName: string | null;
  contactEmail: string | null;
  partnerOrgId: string | null;
};

// Slide-over from the right. The hub shows the summary + contact + links; the
// application detail route (/partners/applications/:id) owns full edits, SOW
// authoring and the activity timeline — one authoring surface, two entry
// points. No cycle with the kanban: a drag writes status via the hub action,
// not through this drawer.
export function ProjectDrawer({
  application,
  onClose,
}: {
  application: DrawerApplication;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="pr-project-drawer-title"
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"
      containerClassName="w-full max-w-md h-full bg-os-card shadow-brand-3 overflow-hidden flex flex-col"
    >
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-start gap-3 min-w-0">
          <PartnerFavicon
            char={application.faviconChar}
            name={application.partnerName}
            size="md"
          />
          <div className="min-w-0">
            <h2
              id="pr-project-drawer-title"
              className="text-lg font-medium text-foreground truncate"
            >
              {application.partnerName}
            </h2>
            <p className="text-xs text-muted-foreground truncate">
              {application.title}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-os-item p-1.5 hover:bg-os-hover text-muted-foreground shrink-0"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <section>
          <p className="os-field-label">Status</p>
          <p className="mt-1 text-sm text-foreground">{application.status}</p>
        </section>

        {application.summary && (
          <section>
            <p className="os-field-label">Summary</p>
            <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
              {application.summary}
            </p>
          </section>
        )}

        {(application.contactName || application.contactEmail) && (
          <section>
            <p className="os-field-label">Point of contact</p>
            <p className="mt-1 text-sm text-foreground">
              {application.contactName ?? application.contactEmail}
            </p>
            {application.contactEmail && application.contactName && (
              <p className="text-xs text-muted-foreground">{application.contactEmail}</p>
            )}
          </section>
        )}
      </div>

      <footer className="border-t border-border px-5 py-3 flex flex-col gap-2">
        <Link
          to={`/partners/applications/${application.id}`}
          className="inline-flex items-center justify-between rounded-full border border-border bg-os-well px-4 py-2 text-sm text-foreground hover:border-os-container-hi"
        >
          <span className="inline-flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" aria-hidden /> Open application (SOW, history)
          </span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        {application.partnerOrgId && (
          <Link
            to={`/partners/${application.partnerOrgId}`}
            className="inline-flex items-center justify-between rounded-full border border-border bg-os-well px-4 py-2 text-sm text-foreground hover:border-os-container-hi"
          >
            <span className="inline-flex items-center gap-2">
              <Users className="h-3.5 w-3.5" aria-hidden /> Open organization page
            </span>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </footer>
    </Modal>
  );
}
