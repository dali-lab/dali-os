// Shared split-panel chrome for all auth/onboarding screens.
// Props:
//   heading  – page heading shown in the right form panel
//   error    – optional inline error string (shown as a red banner)
//   children – form content placed inside the right panel

import { useOsShellRoot } from "~/lib/os-shell";

interface AuthShellProps {
  heading: string;
  error?: string | null;
  children: React.ReactNode;
}

export default function AuthShell({ heading, error, children }: AuthShellProps) {
  useOsShellRoot(true);

  return (
    <div className="os-shell min-h-screen bg-os-bg text-foreground flex relative">
      {/* Left panel — the shell's recessed frame, carrying the wordmark and copy */}
      <div className="hidden md:flex w-1/2 min-h-screen bg-os-nav flex-col justify-center px-12 lg:px-16">
        <div>
          <span className="font-os-logo text-2xl font-semibold text-os-accent">
            dali.os
          </span>
          <h2 className="font-heading text-4xl font-medium text-foreground leading-tight mt-10 mb-4">
            Welcome to
            <br />
            <span className="text-os-accent">DALI OS</span>
          </h2>
          <p className="text-base text-os-grey leading-relaxed max-w-sm">
            Dartmouth's experiential learning lab — where students build real
            products for real partners.
          </p>
        </div>
      </div>

      {/* Right panel — the form */}
      <div className="w-full md:w-1/2 min-h-screen flex items-center justify-center px-6 md:px-12 lg:px-16 bg-os-bg">
        <div className="w-full max-w-sm">
          {/* Mobile-only wordmark (left panel is hidden on small screens) */}
          <div className="md:hidden mb-8">
            <span className="font-os-logo text-2xl font-semibold text-os-accent">
              dali.os
            </span>
          </div>

          <div className="rounded-os-card bg-os-card p-8">
            <h1 className="font-heading text-3xl font-medium text-foreground mb-5">
              {heading}
            </h1>

            {error && (
              <p className="mb-6 text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">
                {error}
              </p>
            )}

            {children}
          </div>

          {/* Public policy links. This page doubles as the app's public home
              page for Google OAuth verification, which requires the home page
              to link to the privacy policy. */}
          <footer className="mt-10 flex items-center gap-4 text-xs text-os-muted">
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
