import { cn } from "~/lib/cn";
import { useOsChrome } from "~/components/os-chrome";

// The "nothing to show" panel shared by the hub and the notes browser. One
// definition so the two surfaces can't drift apart as the page dress changes.
export function EmptyState({ children }: { children: React.ReactNode }) {
  const { panel, panelPad } = useOsChrome();
  return (
    <section className={cn(panel, panelPad)}>
      <p className="text-sm text-muted-foreground">{children}</p>
    </section>
  );
}
