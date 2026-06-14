import { isRouteErrorResponse, Link, useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";

type SecondaryAction =
  | { kind: "back-to-portal" }
  | { kind: "reload" }
  | { kind: "none" };

export function ApplicantErrorBoundary({
  error,
  secondaryAction = { kind: "back-to-portal" },
}: {
  error: unknown;
  secondaryAction?: SecondaryAction;
}) {
  const revalidator = useRevalidator();

  let heading = "Something went wrong";
  let description =
    "We hit an unexpected error loading this page. Try again, or head back to the portal.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      heading = "Page not found";
      description = "We couldn't find the page you were looking for.";
    } else {
      heading = `Error ${error.status}`;
      description = error.statusText || description;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    description = error.message;
    stack = error.stack;
  }

  const trying = revalidator.state !== "idle";

  return (
    <div className="max-w-2xl mx-auto py-16 px-6">
      <div className="rounded-2xl bg-card border border-border px-6 py-8 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-coral/15 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-accent-coral"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">
          {heading}
        </h2>
        <p className="text-muted-foreground leading-relaxed mb-8">
          {description}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={() => revalidator.revalidate()}
            disabled={trying}
          >
            {trying ? "Trying..." : "Try again"}
          </Button>
          {secondaryAction.kind === "back-to-portal" && (
            <Link
              to="/portal"
              className="px-6 py-2.5 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition"
            >
              Back to portal
            </Link>
          )}
          {secondaryAction.kind === "reload" && (
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              className="px-6 py-2.5 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition"
            >
              Reload page
            </button>
          )}
        </div>
        {stack && (
          <pre className="mt-6 text-left w-full p-4 overflow-x-auto rounded-lg bg-muted text-xs">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
