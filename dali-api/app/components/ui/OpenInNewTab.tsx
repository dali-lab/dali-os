import type { MouseEvent } from "react";
import { ExternalLink } from "lucide-react";
import { desktopVersion } from "~/lib/desktop";
import { cn } from "~/lib/cn";
import { Tooltip } from "./floating";
import { useToast } from "./toast";

type Props = {
  href: string;
  // The desktop app has no tabs and only hands cross-origin URLs to the browser.
  externalHref?: () => Promise<string>;
  iconClassName?: string;
};

export function OpenInNewTab({ href, externalHref, iconClassName }: Props) {
  const toast = useToast();

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!externalHref || desktopVersion() == null) return;
    e.preventDefault();
    externalHref().then(
      (url) => window.location.assign(url),
      () => toast.error("The file couldn't be opened. Try again."),
    );
  };

  return (
    <Tooltip content="Open in a new tab">
      <a href={href} target="_blank" rel="noreferrer" aria-label="Open in a new tab" className="os-icon-btn" onClick={onClick}>
        <ExternalLink className={cn("h-4 w-4", iconClassName)} aria-hidden />
      </a>
    </Tooltip>
  );
}
