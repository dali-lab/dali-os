import { isRouteErrorResponse, Link, useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";
import { ErrorScreen } from "~/components/ErrorScreen";

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
    <ErrorScreen heading={heading} description={description} stack={stack}>
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
    </ErrorScreen>
  );
}
