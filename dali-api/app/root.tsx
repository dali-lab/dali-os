import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { useEffect } from "react";

import type { Route } from "./+types/root";
import "./app.css";
import {
  AnalyticsErrorReporter,
  reportBoundaryError,
} from "~/components/AnalyticsErrorReporter";
import { NavigationProgress } from "~/components/NavigationProgress";
import { ThemeSync } from "~/components/ThemeSync";
import { ErrorScreen } from "~/components/ErrorScreen";
import { buttonClasses } from "~/components/ui/Button";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
import { PresenceStatusProvider } from "~/components/presence/PresenceStatusProvider";
import { THEME_BOOT_SRC } from "~/lib/theme";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Dosis:wght@600;700;800&family=Inter:wght@300;400;500;600;700;800&family=Open+Sans:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500;600&family=Mulish:wght@400;500;600;700;900&family=Plus+Jakarta+Sans:wght@600;700&display=swap",
  },
  { rel: "icon", href: "/icon-blue.svg", type: "image/svg+xml" },
  { rel: "alternate icon", href: "/favicon.ico" },
  { rel: "apple-touch-icon", href: "/icon-blue.svg" },
  { rel: "mask-icon", href: "/icon-blue.svg", color: "#1E5779" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

// og:site_name and application-name pin the app's name to "DALI OS" for
// crawlers (Google's OAuth verification reads these). Without them Google
// falls back to the domain/favicon and resolves the name as "DALI Lab",
// which fails the consent-screen name-match check.
export const meta: Route.MetaFunction = () => [
  { title: "DALI OS" },
  { name: "application-name", content: "DALI OS" },
  { property: "og:site_name", content: "DALI OS" },
  { property: "og:title", content: "DALI OS" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  // Published as a <meta> tag rather than an inline <script> so that
  // `script-src 'self'` in the CSP can stay strict. Only computed server-side;
  // on the client the DOM already carries it.
  const collabUrl =
    typeof window === "undefined"
      ? process.env.COLLAB_URL ??
        `ws://localhost:${process.env.COLLAB_PORT ?? "3002"}`
      : document
          .querySelector('meta[name="collab-url"]')
          ?.getAttribute("content") ?? "";

  // Same meta-tag pattern: whether an AI provider key is configured (the
  // boolean only — never the key). Surfaces still opt in per-mount via the
  // DocEditor aiEnabled prop; this is the env half of the gate.
  const aiEnabled =
    typeof window === "undefined"
      ? Boolean(process.env.ANTHROPIC_API_KEY || process.env.DARTMOUTH_CHAT_API_KEY)
      : document.querySelector('meta[name="dali-ai-enabled"]')?.getAttribute("content") === "1";

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="google-site-verification"
          content="s4kefSeLQR8Y2pXHEif-nQKDZXN5ZZ8GcD2r8X1ixC4"
        />
        <meta name="collab-url" content={collabUrl} suppressHydrationWarning />
        <meta name="dali-ai-enabled" content={aiEnabled ? "1" : "0"} suppressHydrationWarning />
        {/* Blocking boot so theme applies before first paint (CSP-safe static file). */}
        <script src={THEME_BOOT_SRC} />
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeSync />
        <NavigationProgress />
        <ToastProvider>
          <DialogProvider>
            {/* Mounted at the document root so avatar presence dots work inside
                every workspace iframe too (each iframe is its own document).
                currentUserId is null here — root has no authed user; own-avatar
                status just resolves "active" via the normal status fetch. */}
            <PresenceStatusProvider currentUserId={null}>
              {children}
            </PresenceStatusProvider>
          </DialogProvider>
        </ToastProvider>
        <AnalyticsErrorReporter />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Something went wrong";
  let description =
    "An unexpected error occurred. Try reloading the page, or head back home.";
  let stack: string | undefined;
  let notFound = false;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      notFound = true;
      heading = "Page not found";
      description =
        "We couldn't find that page. It may have moved, or the link may be out of date.";
    } else {
      heading = `Error ${error.status}`;
      description =
        error.statusText ||
        "Something went wrong on our end. Try reloading, or head back home.";
    }
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    description = error.message;
    stack = error.stack;
  }

  // Only report genuine render-time errors — 404s and other intentional
  // routing responses are not crashes.
  const reportable = !isRouteErrorResponse(error) && error;
  useEffect(() => {
    if (!reportable) return;
    if (typeof window === "undefined") return;
    reportBoundaryError(error, window.location.pathname);
  }, [reportable, error]);

  return (
    <ErrorScreen heading={heading} description={description} stack={stack}>
      {/* Plain anchors, not <Link>: a full-document load is the robust way out
          even when a render crash has wedged the client router. */}
      <a href="/" className={buttonClasses("primary", "md")}>
        Go to home
      </a>
      {!notFound && (
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          className={buttonClasses("secondary", "md")}
        >
          Reload page
        </button>
      )}
    </ErrorScreen>
  );
}
