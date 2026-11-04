import { Sparkles } from "lucide-react";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { pageBarTextButton } from "~/components/shell/page-bar-slot";
import { Tooltip } from "~/components/ui/floating";
import { ASK_SHORTCUT } from "~/lib/shortcuts";
import { useEffect } from "react";
import { loadAskPanel } from "./load-ask-panel";
import { useAskShortcut, useOpenAsk } from "./use-ask";

export function AskButton() {
  const enabled = useFeatureFlag("ask-dali");
  const { isOpen, toggle } = useOpenAsk();
  useAskShortcut(enabled, toggle);
  useEffect(() => {
    if (!enabled) return;
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => void loadAskPanel());
    return () => cancel(handle);
  }, [enabled]);
  if (!enabled) return null;
  return (
    <Tooltip content={`Ask DALI · ${ASK_SHORTCUT}`}>
      <button type="button" onClick={toggle} aria-pressed={isOpen} className={pageBarTextButton(isOpen)}>
        <Sparkles className="h-4 w-4" aria-hidden />
        Ask
      </button>
    </Tooltip>
  );
}
