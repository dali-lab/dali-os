import { Save, Check } from "lucide-react";

// Small "Saving… → Saved at HH:MM:SS" indicator used next to any auto-saving
// field (review form, interview notes, etc). The parent owns the state: pass
// `saving` true whenever there's unsaved content or an in-flight request, and
// `lastSaved` as the timestamp of the most recent successful save.
export function SaveStatusIndicator({
  saving,
  lastSaved,
  className = "",
}: {
  saving: boolean;
  lastSaved: Date | null;
  className?: string;
}) {
  const base = `inline-flex items-center gap-1 text-xs ${className}`;
  if (saving) {
    return (
      <span className={`${base} text-blue-600`}>
        <Save className="w-3 h-3 animate-pulse" />
        Saving…
      </span>
    );
  }
  if (lastSaved) {
    return (
      <span className={`${base} text-green-600`}>
        <Check className="w-3 h-3" />
        Saved at{" "}
        {lastSaved.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>
    );
  }
  return <span className={`${base} text-gray-400`}>Not yet saved</span>;
}
