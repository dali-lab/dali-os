import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";
import { Shield, ChevronDown, X, Check } from "lucide-react";

export interface DomainRow {
  id: string;
  name: string;
}

export interface DomainLeadAssignment {
  id: string;
  domain: DomainRow;
}

export interface Member {
  id: string;
  firstName: string | null;
  lastName: string | null;
  daliEmail: string | null;
  roles: string[];
  user: { id: string; firstName: string; lastName: string } | null;
  domainLeadAssignments: DomainLeadAssignment[];
}

export interface DomainLeadAssignmentWithMember {
  id: string;
  member: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    daliEmail: string | null;
  };
}

export interface DomainWithCounts extends DomainRow {
  domainLeadAssignments: DomainLeadAssignmentWithMember[];
  _count: {
    challengeVersions: number;
    applicationCycles: number;
    domainLeadAssignments: number;
    cycleReviewers: number;
    cycleInterviewers: number;
    rubrics: number;
    delibsSessions: number;
  };
}

export function memberLabel(member: { firstName: string | null; lastName: string | null; daliEmail: string | null }) {
  const name = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
  return name || member.daliEmail || "Unnamed member";
}

export function RemoveDomainLeadButton({ assignmentId }: { assignmentId: string }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" className="inline">
      <input type="hidden" name="intent" value="remove-domain-lead" />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <button type="submit" className="hover:text-purple-600 ml-0.5">
        <X className="w-3 h-3" />
      </button>
    </fetcher.Form>
  );
}

function AddDomainLeadButton({ memberId, domain, onAdded }: { memberId: string; domain: DomainRow; onAdded: () => void }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" onSubmit={onAdded}>
      <input type="hidden" name="intent" value="add-domain-lead" />
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="domainId" value={domain.id} />
      <button type="submit" className="w-full text-left px-4 py-2 text-sm text-foreground/80 hover:bg-muted/50">
        {domain.name}
      </button>
    </fetcher.Form>
  );
}

export function DomainLeadPicker({
  member,
  domains,
  existingAssignments,
}: {
  member: Member;
  domains: DomainRow[];
  existingAssignments: Member["domainLeadAssignments"];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const assignedDomainIds = new Set(existingAssignments.map((a) => a.domain.id));
  const available = domains.filter((d) => !assignedDomainIds.has(d.id));

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {existingAssignments.map((assignment) => (
        <span
          key={assignment.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
        >
          {assignment.domain.name}
          <RemoveDomainLeadButton assignmentId={assignment.id} />
        </span>
      ))}

      {available.length > 0 && (
        <>
          <button
            ref={triggerRef}
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted"
          >
            + Domain
            <ChevronDown className="w-3 h-3" />
          </button>
          {open && menuPos && typeof document !== "undefined" &&
            createPortal(
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div
                  className="fixed z-50 w-40 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5"
                  style={{ top: menuPos.top, right: menuPos.right }}
                >
                  <div className="py-1">
                    {available.map((domain) => (
                      <AddDomainLeadButton
                        key={domain.id}
                        memberId={member.id}
                        domain={domain}
                        onAdded={() => setOpen(false)}
                      />
                    ))}
                  </div>
                </div>
              </>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}

export function AdminToggle({ member }: { member: Member }) {
  const fetcher = useFetcher();
  const submittedValue = fetcher.formData?.get("value");
  const isAdminMember = submittedValue != null
    ? submittedValue === "true"
    : member.roles.includes("Admin");

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="set-admin" />
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="value" value={String(!isAdminMember)} />
      <button
        type="submit"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
          isAdminMember
            ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
            : "bg-muted text-muted-foreground hover:bg-muted"
        }`}
      >
        {isAdminMember ? <Check className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
        {isAdminMember ? "Admin" : "Set Admin"}
      </button>
    </fetcher.Form>
  );
}

export function HiringLeadToggle({ member }: { member: Member }) {
  const fetcher = useFetcher();
  const submittedValue = fetcher.formData?.get("value");
  const isHiringLead = submittedValue != null
    ? submittedValue === "true"
    : member.roles.includes("HiringLead");

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="set-hiring-lead" />
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="value" value={String(!isHiringLead)} />
      <button
        type="submit"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
          isHiringLead
            ? "bg-green-100 text-green-800 hover:bg-green-200"
            : "bg-muted text-muted-foreground hover:bg-muted"
        }`}
      >
        {isHiringLead ? <Check className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
        {isHiringLead ? "Hiring Lead" : "Set Hiring Lead"}
      </button>
    </fetcher.Form>
  );
}
