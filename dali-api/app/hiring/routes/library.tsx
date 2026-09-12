// The hiring "Library" is an embedded view of the Hiring drive space: reuse the
// unified Drive hub, which opens straight into the Hiring scope at this path (see
// the /hiring/library default in drive.hub.tsx). Rubrics, application templates
// and challenge/application forms — the Hiring singleton's folder set — live
// there, so this replaces the old tabbed Library without leaving the Hiring area.
// Core-only (the Hiring space is gated isCore; see drive-spaces.ts + the nav gate).
export { loader, default, shouldRevalidate } from "~/routes/drive.hub";
