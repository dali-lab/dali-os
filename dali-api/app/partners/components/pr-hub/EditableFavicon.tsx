import { useRef, useState } from "react";
import { useFetcher } from "react-router";
import { PartnerFavicon } from "./PartnerFavicon";

// Click the hub-list favicon to replace the stored glyph. The field accepts up
// to 8 chars (so a short emoji sequence fits); blank reverts to the first
// letter of the org name. Submits to the hub action via useFetcher so the row
// just updates in place.
export function EditableFavicon({
  orgId,
  currentChar,
  name,
}: {
  orgId: string;
  currentChar: string | null;
  name: string;
}) {
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentChar ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const next = value.slice(0, 8);
    setEditing(false);
    if ((currentChar ?? "") === next) return;
    fetcher.submit(
      { _intent: "favicon/set", orgId, char: next },
      { method: "post", action: "/partners" },
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setValue(currentChar ?? "");
            setEditing(false);
          }
        }}
        maxLength={8}
        className="h-8 w-8 rounded-md border border-os-accent/60 bg-os-well text-center text-[13px] text-foreground focus:outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(currentChar ?? "");
        setEditing(true);
      }}
      title="Change favicon"
      className="focus:outline-none"
    >
      <PartnerFavicon char={currentChar} name={name} />
    </button>
  );
}
