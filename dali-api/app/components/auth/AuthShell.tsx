// Shared split-panel chrome for all auth/onboarding screens.
// Extracted verbatim from login.tsx — pixel-identical markup and classes.
// Props:
//   heading  – page heading shown in the right form panel
//   error    – optional inline error string (shown as a red banner)
//   children – form content placed inside the right panel

interface AuthShellProps {
  heading: string;
  error?: string | null;
  children: React.ReactNode;
}

export default function AuthShell({ heading, error, children }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-page flex relative overflow-hidden">
      {/* Decorative blocks along right edge — rotated so original width spans viewport height */}
      <img
        src="/spread-out-blocks.png"
        alt=""
        className="absolute opacity-20 dark:opacity-10 pointer-events-none z-0"
        style={{
          top: "50%",
          right: "-30vh",
          width: "100vh",
          transform: "translateY(-50%) rotate(-90deg)",
        }}
      />
      {/* Left decorative panel */}
      <div className="hidden md:flex w-1/2 min-h-screen bg-brand-tint flex-col justify-center px-12 lg:px-16 relative overflow-hidden">
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

        <img
          src="/three-blocks.png"
          alt=""
          className="relative z-10 mt-10 w-64 lg:w-72 dark:opacity-90"
        />
      </div>

      {/* Right form panel */}
      <div className="w-full md:w-1/2 min-h-screen flex items-center justify-center px-6 md:px-12 lg:px-16 bg-page">
        <div className="w-full max-w-sm">
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
          <h1 className="font-heading text-3xl font-bold text-dark-blue mb-5">
            {heading}
          </h1>

          {error && (
            <p className="mb-6 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
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
