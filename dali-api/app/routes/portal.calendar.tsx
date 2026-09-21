import type { Route } from "./+types/portal.calendar";
import { loadCalendarData, submitCalendarAction } from "~/calendar/routes/calendar.server";

// The non-member mount of the calendar. Same page, same features — linked
// Google calendars, events, classes this term, the timesheet — read and written
// for a viewer with no DALIMember row (see loadCalendarData's `portal` option
// for what that changes). It lives here rather than being a second registration
// of the member route so each shell keeps its own layout: this one renders
// inside the portal rail, /calendar inside the member one.
export { default, handle } from "~/calendar/routes/calendar";

export const meta: Route.MetaFunction = () => [{ title: "Calendar · DALI" }];

export async function loader({ request }: Route.LoaderArgs) {
  return loadCalendarData(request, { portal: true });
}

export async function action({ request }: Route.ActionArgs) {
  return submitCalendarAction(request);
}
