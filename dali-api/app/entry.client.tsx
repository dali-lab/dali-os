import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { installDesktopLinkHandling } from "~/lib/desktop-links";
import { installPrefetchFallback } from "~/lib/prefetch-fallback";

// Before hydration so a "new tab" link works in the desktop app. A no-op in a
// browser.
installDesktopLinkHandling();
installPrefetchFallback();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
