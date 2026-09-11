// The hiring "Library" is an embedded view of the Core drive: reuse the unified
// Drive hub, which opens straight into the Core scope at this path (see the
// /hiring/library default in drive.hub.tsx). Rubrics, agreements and challenge/
// application forms folded into Core live there, so this replaces the old tabbed
// Library without leaving the Hiring area. Core-only now (see the nav gate).
export { loader, default, shouldRevalidate } from "~/routes/drive.hub";
