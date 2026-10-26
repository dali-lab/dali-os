// Shared split-panel chrome for all auth/onboarding screens.
// Props:
//   heading  – page heading shown in the right form panel
//   error    – optional inline error string (shown as a red banner)
//   children – form content placed inside the right panel
//   v2       – the dali.os redesign (behind the desktop-tabs flag); stepKey
//              and notice only apply there.

import { AuthShellV2 } from "~/components/auth/v2";

interface AuthShellProps {
  heading: string;
  error?: string | null;
  children: React.ReactNode;
  v2?: boolean;
  stepKey?: string;
  notice?: string | null;
}

export default function AuthShell({ heading, error, children, v2 = false, stepKey, notice }: AuthShellProps) {
  if (v2) {
    return (
      <AuthShellV2 title={heading} stepKey={stepKey} error={error} notice={notice}>
        {children}
      </AuthShellV2>
    );
  }
  return (
    <div className="os-type min-h-screen bg-page flex relative overflow-hidden">
      {/* Decorative blocks along right edge — rotated so original width spans viewport height */}
      <img
        src="/spread-out-blocks.png"
        alt=""
        className="hidden md:block absolute opacity-20 dark:opacity-10 pointer-events-none z-0"
        style={{
          top: "50%",
          right: "-30vh",
          width: "100vh",
          transform: "translateY(-50%) rotate(-90deg)",
        }}
      />
      {/* Left decorative panel: copy up top, the tile mosaic anchored to the
          bottom, like the design. */}
      <div className="hidden md:flex w-1/2 min-h-screen bg-brand-tint flex-col justify-between py-14 px-12 lg:px-16 relative overflow-hidden">
        <div className="relative z-10">
          <img
            src="/logo-blue.svg"
            alt="DALI Lab"
            className="h-16 lg:h-20 w-auto mb-10"
          />
          <h2 className="font-heading text-4xl lg:text-5xl font-bold text-dark-blue leading-tight mb-6">
            Welcome to
            <br />
            <span className="text-accent-coral">DALI OS</span>
          </h2>
          <p className="text-dark-blue/70 text-lg leading-relaxed max-w-sm">
            Dartmouth's experiential learning lab — where students build real
            products for real partners.
          </p>
        </div>

        {/* Animated tile mosaic — the tiles pop in on load (CSS animation
            inside the SVG; it honors prefers-reduced-motion itself). */}
        <img
          src="/dali-tile-pop.svg"
          alt=""
          className="relative z-10 mt-10 w-full max-w-md dark:opacity-90"
        />
      </div>

      {/* Right form panel */}
      <div className="w-full md:w-1/2 min-h-screen flex items-center justify-center px-6 md:px-12 lg:px-16 bg-page">
        {/* The column rises in on load; the heading re-runs the same rise when
            a step changes it (keyed below), so the flow reads as advancing. */}
        <div className="w-full max-w-sm motion-safe:animate-auth-rise">
          {/* Mobile-only logo + wordmark (left panel is hidden on small screens) */}
          <div className="md:hidden mb-8 flex items-center gap-3">
            <img
              src="/logo-blue.svg"
              alt="DALI Lab"
              className="h-12 w-auto"
            />
            <span className="font-heading text-2xl font-bold text-dark-blue">
              DALI OS
            </span>
          </div>
          <h1 key={heading} className="font-heading text-3xl font-bold text-dark-blue mb-5 motion-safe:animate-auth-rise">
            {heading}
          </h1>

          {error && (
            <p role="alert" className="mb-6 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 motion-safe:animate-auth-rise">
              {error}
            </p>
          )}

          {children}

          {/* Public policy links. This page doubles as the app's public home
              page for Google OAuth verification, which requires the home page
              to link to the privacy policy. */}
          <footer className="mt-10 flex items-center gap-4 text-xs text-muted-foreground">
            <a href="/privacy" className="hover:text-foreground underline">
              Privacy Policy
            </a>
            <a href="/terms" className="hover:text-foreground underline">
              Terms of Service
            </a>
          </footer>
        </div>
      </div>
    </div>
  );
}
