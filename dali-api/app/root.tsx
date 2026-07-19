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
    href: "https://fonts.googleapis.com/css2?family=Dosis:wght@600;700&family=Open+Sans:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
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
        {/* Blocking boot so theme applies before first paint (CSP-safe static file). */}
        <script src={THEME_BOOT_SRC} />
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeSync />
        <NavigationProgress />
        {children}
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
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
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
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
