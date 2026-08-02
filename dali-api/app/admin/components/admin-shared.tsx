import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";
import { Shield, ChevronDown, X, Check, Plus, Briefcase } from "lucide-react";
import { fullName } from "~/lib/display";

// Phase 2 reshape: Member is rooted at User. Role flags derive from typed
// assignment tables (AdminMembership, CoreAssignment, DomainLeadAssignment)
// rather than the dropped DALIMember.roles[] enum.

export interface DomainRow {
  id: string;
  name: string;
}

export interface DomainLeadAssignmentForMember {
  id: string;
  domain: DomainRow;
}

// One row per current-term CoreAssignment for a member. leadTitle is a
// free-text display label; null means "Core" with no specific title.
export interface CoreAssignmentForMember {
  id: string;
  leadTitle: string | null;
}

export interface Member {
  // User.id — the canonical actor id used by all admin actions.
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
  /** Resolved (signed) avatar URL, or null. */
  photoUrl?: string | null;
  // Presence indicates a lab member (vs a Dartmouth student or partner).
  isLabMember: boolean;
  // Presence = Admin (AdminMembership row exists).
  isAdmin: boolean;
  // Full-time staff — the AdminMembership.isStaff subset. Implies isAdmin.
  isStaff: boolean;
  // Convenience: has any current-term CoreAssignment. Derive from
  // coreAssignments rather than passing as a separate field where possible.
  isCore: boolean;
  // All current-term Core titles for this member. Used by the Core picker.
  coreAssignments: CoreAssignmentForMember[];
  domainLeadAssignments: DomainLeadAssignmentForMember[];
}

export interface DomainLeadAssignmentWithUser {
  id: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    daliEmail: string | null;
  };
}

export interface DomainEligibilityForDomain {
  id: string;
  level: "P1" | "P2" | "P3";
  user: {
    id: string;
    firstName: string;
    lastName: string;
    daliEmail: string | null;
  };
}

export interface DomainWithCounts extends DomainRow {
  domainLeadAssignments: DomainLeadAssignmentWithUser[];
  eligibilities: DomainEligibilityForDomain[];
  _count: {
    challengeVersions: number;
    applicationCycles: number;
    domainLeadAssignments: number;
    cycleReviewers: number;
    cycleInterviewers: number;
    delibsSessions: number;
    eligibilities: number;
    projectAssignments: number;
    projects: number;
    projectScopes: number;
    projectRoleRequests: number;
    partnerApplicationDomains: number;
    tasks: number;
    mentorshipPairs: number;
  };
}

export function memberLabel(member: { firstName: string; lastName: string; daliEmail: string | null }) {
  const name = fullName(member);
  return name || member.daliEmail || "Unnamed member";
}

export function RemoveDomainLeadButton({ assignmentId }: { assignmentId: string }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" className="inline">
      <input type="hidden" name="intent" value="remove-domain-lead" />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <button
        type="submit"
        aria-label="Remove domain lead assignment"
        className="hover:text-purple-600 ml-0.5 p-2 -m-1.5 inline-flex items-center justify-center"
      >
        <X className="w-3 h-3" />
      </button>
    </fetcher.Form>
  );
}

function AddDomainLeadButton({ userId, domain, onAdded }: { userId: string; domain: DomainRow; onAdded: () => void }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" onSubmit={onAdded}>
      <input type="hidden" name="intent" value="add-domain-lead" />
      <input type="hidden" name="userId" value={userId} />
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
                        userId={member.id}
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

export function AdminToggle({ member, disabled }: { member: Member; disabled?: boolean }) {
  const fetcher = useFetcher();
  const submittedValue = fetcher.formData?.get("value");
  const isAdminMember = submittedValue != null
    ? submittedValue === "true"
    : member.isAdmin;

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="set-admin" />
      <input type="hidden" name="userId" value={member.id} />
      <input type="hidden" name="value" value={String(!isAdminMember)} />
      <button
        type="submit"
        disabled={disabled}
        title={disabled ? "Only Admins can grant or revoke Admin." : undefined}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
          isAdminMember
            ? "border border-accent-coral/30 bg-accent-coral/10 text-accent-coral hover:bg-accent-coral/20"
            : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
        } disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {isAdminMember ? <Check className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
        {isAdminMember ? "Admin" : "Set Admin"}
      </button>
    </fetcher.Form>
  );
}

// Staff is a strict subset of Admin: marking Staff also grants Admin (the
// action upserts the AdminMembership with isStaff=true). Un-marking clears the
// flag but leaves Admin intact. Admin-gated, same as AdminToggle.
export function StaffToggle({ member, disabled }: { member: Member; disabled?: boolean }) {
  const fetcher = useFetcher();
  const submittedValue = fetcher.formData?.get("value");
  const isStaffMember = submittedValue != null
    ? submittedValue === "true"
    : member.isStaff;

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="set-staff" />
      <input type="hidden" name="userId" value={member.id} />
      <input type="hidden" name="value" value={String(!isStaffMember)} />
      <button
        type="submit"
        disabled={disabled}
        title={disabled ? "Only Admins can mark Staff." : "Staff are exempt from student checklist items and gain Admin access."}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
          isStaffMember
            ? "border border-accent-teal/30 bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/20"
            : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
        } disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {isStaffMember ? <Check className="w-3 h-3" /> : <Briefcase className="w-3 h-3" />}
        {isStaffMember ? "Staff" : "Set Staff"}
      </button>
    </fetcher.Form>
  );
}

// Two-click confirm: the first click "arms" the button (shows "Remove?"),
// the second click actually submits. Removing a Core title is destructive
// and Core is self-perpetuating, so we want a guard against stray clicks
// without the disruption of a window.confirm() modal. Auto-disarms after
// 3s so a stray hover doesn't leave the button armed indefinitely.
function RemoveCoreTitleButton({ assignmentId }: { assignmentId: string }) {
  const fetcher = useFetcher();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label="Remove Core title"
        className="hover:text-green-900 ml-0.5 p-2 -m-1.5 inline-flex items-center justify-center"
      >
        <X className="w-3 h-3" />
      </button>
    );
  }

  return (
    <fetcher.Form method="post" className="inline">
      <input type="hidden" name="intent" value="remove-core-title" />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <button
        type="submit"
        aria-label="Confirm remove Core title"
        className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-red-600 text-white hover:bg-red-700"
      >
        Remove?
      </button>
    </fetcher.Form>
  );
}

// Free-text Core title picker. CoreAssignment.leadTitle is intentionally
// free-form (display only — Core has broad access regardless of title), so
// the input accepts any string. Chips render existing titles; clicking
// "+ Title" reveals a text input that submits on Enter.
export function CorePicker({ member }: { member: Member }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const fetcher = useFetcher();
  const submitting = fetcher.state !== "idle";
  const wasSubmitting = useRef(false);

  // Auto-close the input on a successful submit (resets to chip view).
  useEffect(() => {
    if (submitting) wasSubmitting.current = true;
    else if (wasSubmitting.current) {
      wasSubmitting.current = false;
      setValue("");
      setOpen(false);
    }
  }, [submitting]);

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {member.coreAssignments.length === 0 && !open && (
        <span className="text-xs text-muted-foreground/70 italic mr-1">Not Core</span>
      )}
      {member.coreAssignments.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border border-accent-green/40 bg-accent-green/15 text-foreground"
        >
          {a.leadTitle ?? "Core"}
          <RemoveCoreTitleButton assignmentId={a.id} />
        </span>
      ))}

      {open ? (
        <fetcher.Form method="post" className="inline-flex items-center gap-1">
          <input type="hidden" name="intent" value="add-core-title" />
          <input type="hidden" name="userId" value={member.id} />
          <input
            type="text"
            name="leadTitle"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Title (e.g. PM)"
            autoFocus
            onBlur={() => {
              // Cancel if empty and unfocused.
              if (!value.trim() && !submitting) setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setValue("");
                setOpen(false);
              }
            }}
            className="px-2 py-0.5 text-xs border border-border rounded-md bg-background text-foreground w-28 focus:outline-none focus:ring-2 focus:ring-green-500/30"
          />
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs bg-green-700 text-white hover:bg-green-800 disabled:opacity-60"
            aria-label="Add Core title"
          >
            <Check className="w-3 h-3" />
          </button>
        </fetcher.Form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted"
        >
          <Plus className="w-3 h-3" />
          Title
        </button>
      )}
    </div>
  );
}
