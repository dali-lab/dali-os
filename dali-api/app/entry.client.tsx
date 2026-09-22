import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { installDesktopLinkHandling } from "~/lib/desktop-links";

// Before hydration, and in every document — a workspace tab is its own — so a
// "new tab" link works in the desktop shell, which has no tabs of its own. A
// no-op in a browser.
installDesktopLinkHandling();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
