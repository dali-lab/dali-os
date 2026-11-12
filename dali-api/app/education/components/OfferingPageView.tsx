import { Link } from "react-router";
import { MaterialPageBody } from "~/education/components/MaterialPageBody";
import { buttonClasses } from "~/components/ui/Button";
import type { OfferingSurface } from "~/education/lib/offering-surface";

type OfferingPageViewProps = {
  surface: OfferingSurface;
  offeringId: string;
  page: { id: string; title: string; studentEditable: boolean; content: Parameters<typeof MaterialPageBody>[0]["content"] };
  collabToken: Parameters<typeof MaterialPageBody>[0]["collabToken"];
  userName: string;
  isManager: boolean;
};

export function OfferingPageView({
  surface,
  offeringId,
  page,
  collabToken,
  userName,
  isManager,
}: OfferingPageViewProps) {
  const body = (
    <MaterialPageBody
      pageId={page.id}
      studentEditable={page.studentEditable}
      content={page.content}
      collabToken={collabToken}
      userName={userName}
    />
  );

  if (surface.kind === "portal") {
    return (
      <div className="w-full px-4 sm:px-6 py-8 flex flex-col gap-4">
        <header>
          <p className="text-xs text-muted-foreground">
            <Link to={`${surface.base}/${offeringId}/hub?tab=sessions`} className="hover:underline">
              ← Timeline
            </Link>
          </p>
          <h1 className="mt-1 font-heading text-4xl font-medium text-foreground">{page.title}</h1>
        </header>
        {body}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">{page.title}</h1>
        </div>
        {isManager && (
          <Link to={`/documents/${page.id}`} className={buttonClasses("secondary", "sm")}>
            Open in editor
          </Link>
        )}
      </header>
      {body}
    </div>
  );
}
