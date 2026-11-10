import { Code2 } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { useCustomCodePaused } from "~/components/slides/deck/pause-custom-code";

export function PauseCustomCodeButton() {
  const [paused, setPaused] = useCustomCodePaused();
  return (
    <Button variant="ghost" size="xs" aria-pressed={paused} onClick={() => setPaused(!paused)}>
      <Code2 className="h-3.5 w-3.5" aria-hidden />
      {paused ? "Resume custom code" : "Pause custom code"}
    </Button>
  );
}
