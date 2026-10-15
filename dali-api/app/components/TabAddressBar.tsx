import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";

// The browser-style address row under a pane's tab strip: the active tab's
// full url, selectable, with a one-click copy for sharing.
export function TabAddressBar({ path }: { path: string }) {
  // The origin is read after mount: the server render has no window, and the
  // first client render must match it.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${path}`;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the field stays selectable for Cmd+C.
    }
  }

  return (
    <div className="flex h-9 items-center gap-1.5 border-t border-border bg-section-bg px-2">
      <input
        type="text"
        readOnly
        value={url}
        aria-label="Page address"
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
        className="h-7 min-w-0 flex-1 rounded-os-item bg-os-well px-3 text-xs text-muted-foreground outline-none focus:text-foreground"
      />
      <Tooltip content={copied ? "Copied" : "Copy link"}>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy link"}
          className="os-icon-btn"
        >
          {copied ? <Check className="h-4 w-4 text-os-accent" /> : <Copy className="h-4 w-4" />}
        </button>
      </Tooltip>
    </div>
  );
}
