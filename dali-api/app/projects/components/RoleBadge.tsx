import { GraduationCap, Sprout } from "lucide-react";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";

// The per-card mentor/mentee role badge on the staffing board. Role defaults to
// the member's level (P3 → mentor); clicking toggles an override for the cycle.
// Mentees are auto-paired to same-domain mentors at finalize — there's no mentee
// assignment here, just the role.
export function RoleBadge({
  isMentor,
  onToggle,
}: {
  isMentor: boolean;
  onToggle: () => void;
}) {
  const os = useFeatureFlag("os-redesign");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isMentor}
      title={
        isMentor ? "Mentor — click to make mentee" : "Mentee — click to make mentor"
      }
      aria-label={
        isMentor ? "Role: mentor, change to mentee" : "Role: mentee, change to mentor"
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        isMentor
          ? os
            ? "border-transparent bg-os-accent/15 text-os-accent hover:bg-os-accent/25"
            : "border-accent-coral/40 bg-accent-coral/10 text-accent-coral hover:bg-accent-coral/20"
          : os
            ? "border-transparent bg-os-container text-os-grey hover:text-foreground"
            : "border-border bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      {isMentor ? (
        <GraduationCap className="w-2.5 h-2.5" aria-hidden />
      ) : (
        <Sprout className="w-2.5 h-2.5" aria-hidden />
      )}
      {isMentor ? "Mentor" : "Mentee"}
    </button>
  );
}
