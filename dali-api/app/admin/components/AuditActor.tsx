import { Avatar } from "~/components/ui/Avatar";

export type AuditPerson = { name: string | null; photoUrl: string | null };

export function ShortId({ id }: { id: string }) {
  return <span className="font-mono text-xs text-os-muted">{id.slice(0, 8)}…</span>;
}

export function auditPersonName(p: AuditPerson): string {
  return p.name || "—";
}

// actorId without an actor means the user row is gone, which is different from
// an event the system raised on its own.
export function AuditActorAvatar({ actor, actorId }: { actor: AuditPerson | null; actorId: string | null }) {
  const name = actor ? auditPersonName(actor) : actorId ? "?" : "System";
  return <Avatar name={name} photoUrl={actor?.photoUrl ?? null} size="sm" className="shrink-0" />;
}

export function AuditActorName({ actor, actorId }: { actor: AuditPerson | null; actorId: string | null }) {
  if (actor) return <span className="font-semibold text-foreground">{auditPersonName(actor)}</span>;
  if (actorId) return <ShortId id={actorId} />;
  return <span className="italic text-os-muted">system</span>;
}
