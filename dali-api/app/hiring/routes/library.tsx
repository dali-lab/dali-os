// The hiring "Library" is now an embedded view of the Hiring drive: reuse the
// unified Drive hub, which opens straight into the Hiring scope at this path
// (see the /hiring/library default in drive.hub.tsx). Rubrics, agreements and
// challenge/application forms all live there, so this replaces the old tabbed
// Library without leaving the Hiring area.
export { loader, default, shouldRevalidate } from "~/routes/drive.hub";
