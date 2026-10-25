import { useMemo, useState } from "react";
import { Link, useFetcher } from "react-router";
import { ArrowUpRight, Pencil, UserMinus } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { IconButton } from "~/components/ui/IconButton";
import { Combobox, Select } from "~/components/ui/floating";
import type { AccessEntry, JourneyCollaborator, JourneyPerson } from "~/journeys/lib/journeys.server";
import { accessPath, editPath, journeyPath } from "~/journeys/lib/paths";
import type { JourneyRole } from "~/journeys/lib/types";

// Every change posts to the access route; its loader feeds AccessDialog.
const ACCESS_ACTION = accessPath();

const ROLE_OPTIONS: { value: JourneyRole; label: string }[] = [
  { value: "editor", label: "Can edit" },
  { value: "owner", label: "Owner" },
];
const roleLabel = (r: JourneyRole) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

export function JourneyAccessDetail({ entry, people, viewerId }: { entry: AccessEntry; people: JourneyPerson[]; viewerId: string }) {
  const canManage = entry.role === "owner";
  const owners = entry.people.filter((p) => p.role === "owner");
  return (
    <div>
      <p className="text-sm text-os-muted">
        {entry.domain.name} · {entry.isPublished ? "Published" : "Draft, not published yet"}
        {entry.creator && ` · Created by ${entry.creator}`}
      </p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-semibold">{entry.title.trim() || "Untitled journey"}</h2>
          <p className="mt-1 text-sm text-os-grey">
            {entry.role === "owner" ? "You can manage access" : entry.role === "editor" ? "You can edit this journey" : "You don't have edit access"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {entry.isPublished && (
            <Link to={journeyPath(entry.domain.slug, entry.id)} className={buttonClasses("ghost", "sm")}>
              Open journey
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
          {entry.role && (
            <Link to={editPath(entry.domain.slug, entry.id)} className={buttonClasses("secondary", "sm")}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit journey
            </Link>
          )}
        </div>
      </div>

      <div className="mt-8">
        {canManage ? (
          <AddPeopleForm journeyId={entry.id} people={people.filter((p) => !entry.people.some((c) => c.id === p.id))} />
        ) : (
          <p className="rounded-os-item bg-os-well px-4 py-3 text-sm leading-6 text-os-grey">
            {entry.role === "editor" ? "Only owners can change who has access." : "Ask one of its owners below to add you."}
          </p>
        )}
      </div>

      <section className="mt-8" aria-labelledby={`access-list-${entry.id}`}>
        <h3 id={`access-list-${entry.id}`} className="os-field-label">
          People with access <span className="tabular-nums">{entry.people.length}</span>
        </h3>
        {entry.people.length === 0 ? (
          <p className="mt-3 text-sm text-os-muted">Nobody is listed yet. Core can manage it in the meantime.</p>
        ) : (
          <ul className="mt-1 divide-y divide-os-container">
            {entry.people.map((p) => (
              <CollaboratorRow
                key={p.id}
                journeyId={entry.id}
                person={p}
                isSelf={p.id === viewerId}
                canManage={canManage}
                lockedReason={p.role === "owner" && owners.length === 1 ? "Every journey needs at least one owner." : undefined}
              />
            ))}
          </ul>
        )}
      </section>

      <dl className="mt-8 grid gap-2 border-t border-os-container pt-5 text-xs leading-5 sm:grid-cols-[88px_1fr]">
        <dt className="text-os-grey">Owner</dt>
        <dd className="text-os-muted">Edits and publishes content, deletes the journey, and manages access.</dd>
        <dt className="text-os-grey">Can edit</dt>
        <dd className="text-os-muted">Edits and publishes content.</dd>
        <dt className="text-os-grey">Everyone else</dt>
        <dd className="text-os-muted">Takes the journey once it's published.</dd>
      </dl>
    </div>
  );
}

function AddPeopleForm({ journeyId, people }: { journeyId: string; people: JourneyPerson[] }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<JourneyRole>("editor");
  const options = useMemo(() => people.map((p) => ({ value: p.id, label: p.name, description: p.email })), [people]);

  const add = () => {
    if (!userId) return;
    fetcher.submit({ intent: "add", journeyId, userId, role }, { method: "post", action: ACCESS_ACTION });
    setUserId("");
  };

  return (
    <div className="os-form">
      <p className="os-field-label">Add people</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <div className="min-w-0 flex-1">
          <Combobox value={userId} options={options} onChange={setUserId} ariaLabel="Lab member to add" placeholder="Search lab members" emptyLabel="No members match" />
        </div>
        <div className="w-32">
          <Select ariaLabel="Access for the new person" value={role} options={ROLE_OPTIONS} onChange={setRole} />
        </div>
        <button type="button" onClick={add} disabled={!userId || fetcher.state !== "idle"} className={buttonClasses("primary", "md")}>
          Add
        </button>
      </div>
      {fetcher.data && !fetcher.data.ok && <p className="mt-2 text-sm text-destructive">{fetcher.data.error}</p>}
    </div>
  );
}

function CollaboratorRow({
  journeyId,
  person,
  isSelf,
  canManage,
  lockedReason,
}: {
  journeyId: string;
  person: JourneyCollaborator;
  isSelf: boolean;
  canManage: boolean;
  lockedReason?: string;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const dialog = useDialog();
  const pendingRole = fetcher.formData?.get("intent") === "role" ? (fetcher.formData.get("role") as JourneyRole) : null;
  const removing = fetcher.formData?.get("intent") === "remove";

  const remove = async () => {
    const ok = await dialog.confirm({
      title: isSelf ? "Leave this journey?" : `Remove ${person.name}?`,
      description: isSelf ? "You won't be able to edit it unless an owner adds you back." : "They won't be able to edit this journey anymore.",
      confirmLabel: isSelf ? "Leave" : "Remove",
      tone: "destructive",
    });
    if (ok) fetcher.submit({ intent: "remove", journeyId, userId: person.id }, { method: "post", action: ACCESS_ACTION });
  };

  if (removing) return null;
  return (
    <li className="flex items-center gap-3 py-3">
      <Avatar photoUrl={person.photoUrl} name={person.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          {person.name}
          {isSelf && <span className="text-os-muted"> (you)</span>}
        </p>
        <p className="truncate text-xs text-os-muted">{person.email}</p>
        {fetcher.data && !fetcher.data.ok && <p className="mt-1 text-xs text-destructive">{fetcher.data.error}</p>}
      </div>
      {canManage ? (
        <div className="flex shrink-0 items-center gap-1" title={lockedReason}>
          <div className="os-form w-32">
            <Select
              ariaLabel={`Access for ${person.name}`}
              value={pendingRole ?? person.role}
              options={ROLE_OPTIONS}
              disabled={Boolean(lockedReason)}
              onChange={(next) => fetcher.submit({ intent: "role", journeyId, userId: person.id, role: next }, { method: "post", action: ACCESS_ACTION })}
            />
          </div>
          <IconButton
            label={lockedReason ?? (isSelf ? "Leave journey" : `Remove ${person.name}`)}
            icon={UserMinus}
            tone="destructive"
            disabled={Boolean(lockedReason)}
            onClick={remove}
          />
        </div>
      ) : (
        <span className="shrink-0 text-sm text-os-grey">{roleLabel(person.role)}</span>
      )}
    </li>
  );
}
