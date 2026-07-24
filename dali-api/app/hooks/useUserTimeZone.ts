import { useRouteLoaderData } from "react-router";
import { APPLICATION_TZ } from "~/lib/timezone";

/**
 * The current user's display timezone, threaded from the app layout loader
 * (`routes/layout`). Client components pass this to the tz-aware formatters so
 * they render the same instant the same way the server did — the single client
 * channel for the stored preference. Falls back to the lab zone (ET) when the
 * layout loader isn't an ancestor (e.g. portal / auth routes).
 */
export function useUserTimeZone(): string {
  const data = useRouteLoaderData("routes/layout") as
    | { userTimeZone?: string }
    | undefined;
  return data?.userTimeZone ?? APPLICATION_TZ;
}
