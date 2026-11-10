import { ChevronDown, Presentation } from "lucide-react";
import { useNavigate } from "react-router";
import { Menu } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { useDesktopVersion } from "~/lib/desktop";
import { cn } from "~/lib/cn";
import { deckUrl, presenterUrl, presentUrl } from "./urls";

const SEGMENT = "os-btn-primary h-8";

export interface PresentMenuProps {
  pageId: string;
  currentSlideId: string | null;
}

export function PresentMenu({ pageId, currentSlideId }: PresentMenuProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const desktop = useDesktopVersion() != null;

  const openPresenter = () => {
    const url = presenterUrl(pageId, currentSlideId);
    if (desktop) return navigate(url);
    const opened = window.open(url, "_blank");
    if (!opened) navigate(url);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${deckUrl(pageId)}`);
      toast.info("Follow link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <div className="inline-flex items-center">
      <button
        type="button"
        className={cn(SEGMENT, "rounded-r-none")}
        onClick={() => navigate(presentUrl(pageId, currentSlideId))}
      >
        <Presentation className="h-4 w-4" aria-hidden />
        Present
      </button>
      <Menu
        align="right"
        ariaLabel="Present options"
        trigger={
          <button type="button" aria-label="Present options" className={cn(SEGMENT, "rounded-l-none border-l border-os-bg/30 px-1.5")}>
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        }
      >
        <Menu.Item onSelect={() => navigate(presentUrl(pageId))}>From the beginning</Menu.Item>
        <Menu.Item onSelect={openPresenter}>Presenter view</Menu.Item>
        <Menu.Item onSelect={copyLink}>Copy follow link</Menu.Item>
      </Menu>
    </div>
  );
}
