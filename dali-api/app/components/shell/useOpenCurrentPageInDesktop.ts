import { useCallback } from "react";
import { useToast } from "~/components/ui/toast";
import { currentPagePath, openInDesktopApp } from "~/lib/open-in-desktop";

export function useOpenCurrentPageInDesktop() {
  const toast = useToast();
  return useCallback(() => {
    openInDesktopApp(currentPagePath(), {
      onFallback: () =>
        toast.info("The desktop app didn't open.", {
          duration: 10000,
          actions: [
            { label: "Download", onClick: () => window.open("/download", "_blank", "noopener") },
          ],
        }),
    });
  }, [toast]);
}
