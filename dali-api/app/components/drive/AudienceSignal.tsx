// "Who can see this" on a Drive row (compact glyph + tooltip) and in the
// details pane (long form). Display only: the summary is computed server-side.

import type { ReactNode } from "react";
import { Globe, Lock, Users } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";
import { Avatar } from "~/components/ui/Avatar";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { AUDIENCE_PERMISSION_LABEL, type Audience } from "~/lib/page-audience";

function namedShares(audience: Audience): string | null {
  if (!audience.count || audience.kind === "people") return null;
  return `Plus ${audience.count} named ${audience.count === 1 ? "share" : "shares"}`;
}

function AudienceTip({ audience }: { audience: Audience }) {
  const extra = namedShares(audience);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{audience.label}</span>
      <span className="text-muted-foreground">{AUDIENCE_PERMISSION_LABEL[audience.permission]}</span>
      {extra && <span className="text-muted-foreground">{extra}</span>}
      {audience.inheritedFrom && (
        <span className="text-muted-foreground">Inherited from {audience.inheritedFrom.title || "a folder"}</span>
      )}
    </div>
  );
}

function AvatarStack({ audience }: { audience: Audience }) {
  const people = audience.people ?? [];
  const more = Math.max(0, (audience.count ?? people.length) - people.length);
  return (
    <span className="inline-flex items-center">
      {people.map((p, i) => (
        <Avatar
          key={p.id}
          name={p.name}
          photoUrl={p.photoUrl}
          size="xs"
          className={cn("ring-2 ring-background", i > 0 && "-ml-1.5")}
        />
      ))}
      {more > 0 && <span className="ml-1 text-[10px] font-medium text-muted-foreground">+{more}</span>}
    </span>
  );
}

/** "Everyone in the lab". A globe means the open internet, so lab-wide wears the people mark instead. */
export function LabAudienceGlyph({ labelled = true }: { labelled?: boolean }) {
  return (
    <>
      <Users className="h-3 w-3" />
      {labelled && <span className="text-[10px] font-medium">Lab</span>}
    </>
  );
}

function Glyph({ audience }: { audience: Audience }) {
  if (audience.people && audience.people.length > 0) return <AvatarStack audience={audience} />;
  switch (audience.kind) {
    case "private":
      return <Lock className="h-3 w-3" />;
    case "people":
      return (
        <>
          <Users className="h-3 w-3" />
          {audience.count !== undefined && <span className="text-[10px] font-medium">{audience.count}</span>}
        </>
      );
    case "group":
      return <span className="max-w-[7rem] truncate text-[10px] font-medium">{audience.label}</span>;
    case "project":
      return (
        <>
          <Users className="h-3 w-3" />
          <span className="text-[10px] font-medium">Team</span>
        </>
      );
    case "lab":
      return <LabAudienceGlyph />;
    default:
      return <Globe className="h-3 w-3" />;
  }
}

/**
 * Always-on audience marker for a row. Clicking opens Share when the item has
 * one (`onOpenShare`); otherwise it is a plain, hoverable marker.
 */
export function AudienceSignal({
  audience,
  onOpenShare,
}: {
  audience: Audience;
  onOpenShare?: () => void;
}) {
  const className = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full text-muted-foreground",
    audience.kind === "group" && "border border-border bg-muted/60 px-2 py-0.5",
    onOpenShare && "hover:text-foreground transition-colors",
  );
  const ariaLabel = `Who can see this: ${audience.label}`;
  return (
    <Tooltip content={<AudienceTip audience={audience} />} variant="rich">
      {onOpenShare ? (
        <button
          type="button"
          aria-label={ariaLabel}
          data-testid="audience-signal"
          data-audience-kind={audience.kind}
          onClick={(e) => {
            e.stopPropagation();
            onOpenShare();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className={className}
        >
          <Glyph audience={audience} />
        </button>
      ) : (
        <span
          role="img"
          aria-label={ariaLabel}
          data-testid="audience-signal"
          data-audience-kind={audience.kind}
          className={className}
        >
          <Glyph audience={audience} />
        </span>
      )}
    </Tooltip>
  );
}

