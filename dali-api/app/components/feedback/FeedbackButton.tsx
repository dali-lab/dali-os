import { MessageSquarePlus, MessagesSquare, PenLine } from "lucide-react";
import { Menu, MenuItem, Tooltip } from "~/components/ui/floating";
import { useFeedbackComposer } from "./FeedbackComposer";

/**
 * The shell's feedback button. Two paths: open the feature request feed, or
 * write a request, which starts on a drag-to-select screenshot of the page
 * wherever the browser can share the tab.
 */
export function FeedbackButton({
  pagePath,
  onOpenFeed,
}: {
  /** Where the user is, recorded on the request. */
  pagePath: string;
  onOpenFeed: () => void;
}) {
  const composer = useFeedbackComposer({ pagePath, fetcherKey: "os-feedback-create" });

  return (
    <>
      {!composer.capturing && (
        <div className="fixed bottom-4 right-4 z-30 md:right-[calc(1rem+var(--side-panel-w,0px))] print:hidden">
          <Menu
            align="right"
            ariaLabel="Feedback"
            trigger={
              <Tooltip content="Send feedback or view requests" placement="left">
                <button
                  type="button"
                  aria-label="Feedback"
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-os-accent text-os-bg shadow-[0_8px_24px_var(--color-os-shadow)] transition-colors hover:bg-os-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent focus-visible:ring-offset-2"
                >
                  <MessageSquarePlus className="h-5 w-5" aria-hidden />
                </button>
              </Tooltip>
            }
          >
            <MenuItem icon={<MessagesSquare className="h-4 w-4" />} onSelect={onOpenFeed}>
              View requests
            </MenuItem>
            <MenuItem icon={<PenLine className="h-4 w-4" />} onSelect={composer.startWithCapture}>
              Send feedback
            </MenuItem>
          </Menu>
        </div>
      )}
      {composer.ui}
    </>
  );
}
