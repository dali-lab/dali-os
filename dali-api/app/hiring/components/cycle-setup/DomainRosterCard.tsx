import { useState, type ReactNode } from "react";
import { Form } from "react-router";
import { Users, X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { Select, Tooltip } from "~/components/ui/floating";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { SetupCard, rowTrigger } from "./SetupCard";

export type RosterPerson = {
  id: string;
  userId: string;
  domainId: string;
  name: string;
  /** Extra state on the right of the name (e.g. an interviewer's free time). */
  detail?: ReactNode;
};

// A Students cycle's reviewer or interviewer roster, one domain at a time:
// pick the domain on top, then see and change just that domain's people.
// Adding goes through the roster APIs the caller wires in; "Add all mentors"
// posts the page's add-domain-mentors intent for the chosen domain.
export function DomainRosterCard({
  title,
  description,
  role,
  domains,
  people,
  members,
  onAdd,
  onRemove,
  mentors,
  cycleId,
}: {
  title: string;
  description?: ReactNode;
  role: "reviewer" | "interviewer";
  domains: { id: string; name: string }[];
  people: RosterPerson[];
  /** Everyone who can be added (current lab members). */
  members: { id: string; name: string }[];
  onAdd: (userId: string, domainId: string) => void;
  onRemove: (person: RosterPerson) => void;
  /** Offer "Add all mentors" (Students cycles, where domains have mentors). */
  mentors: boolean;
  /** Sent with add-domain-mentors when the route isn't the cycle's own page. */
  cycleId?: string;
}) {
  const { bodyText, formTrigger } = useOsChrome();
  const [domainId, setDomainId] = useState(domains[0]?.id ?? "");
  const selected = domains.some((d) => d.id === domainId) ? domainId : (domains[0]?.id ?? "");
  const here = people.filter((p) => p.domainId === selected);
  const taken = new Set(here.map((p) => p.userId));
  const candidates = members.filter((m) => !taken.has(m.id));
  const domainName = domains.find((d) => d.id === selected)?.name ?? "";

  if (domains.length === 0) {
    return (
      <SetupCard title={title} description={description}>
        <p className={cn(bodyText, "py-4 text-center")}>Add domains on Setup first.</p>
      </SetupCard>
    );
  }

  return (
    <SetupCard title={title} description={description}>
      {(domains.length > 1 || mentors) && (
      <div className="flex flex-wrap items-stretch justify-between gap-3">
        {domains.length === 1 ? (
          <span />
        ) : domains.length <= 6 ? (
          <SegmentedTabButtons
            label="Domain"
            items={domains.map((d) => ({ label: d.name, active: d.id === selected, onClick: () => setDomainId(d.id) }))}
          />
        ) : (
          <div className="w-64">
            <Select
              ariaLabel="Domain"
              value={selected}
              onChange={setDomainId}
              options={domains.map((d) => ({ value: d.id, label: d.name }))}
              buttonClassName={rowTrigger(formTrigger)}
            />
          </div>
        )}
        {mentors && (
        <Form method="post" preventScrollReset className="flex">
          <input type="hidden" name="intent" value="add-domain-mentors" />
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="domainId" value={selected} />
          {cycleId && <input type="hidden" name="cycleId" value={cycleId} />}
          <button type="submit" className={buttonClasses("secondary", "md")}>
            <Users className="h-3.5 w-3.5" aria-hidden /> Add all mentors
          </button>
        </Form>
        )}
      </div>
      )}

      <div className="flex flex-col gap-2">
        {here.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
            <span className="text-sm font-semibold text-foreground">{p.name}</span>
            <span className="flex items-center gap-3 text-sm">
              {p.detail}
              <Tooltip content="Remove">
                <button
                  type="button"
                  onClick={() => onRemove(p)}
                  aria-label={`Remove ${p.name}`}
                  className="rounded-os-item p-1.5 text-os-grey transition-colors hover:bg-os-container hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </Tooltip>
            </span>
          </div>
        ))}
        {here.length === 0 && <p className={cn(bodyText, "py-3 text-center")}>No one on {domainName} yet.</p>}
      </div>

      <div>
        <Select
          ariaLabel={`Add a ${role} to ${domainName}`}
          value=""
          placeholder="Add person"
          onChange={(userId) => userId && onAdd(userId, selected)}
          options={candidates.map((m) => ({ value: m.id, label: m.name }))}
          buttonClassName={rowTrigger(formTrigger)}
        />
      </div>
    </SetupCard>
  );
}
