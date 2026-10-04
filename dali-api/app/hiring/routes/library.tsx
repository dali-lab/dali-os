// The hiring "Library" is the unified Drive hub, opened on the hiring folder
// set: rubrics, application templates and challenge/application forms — the
// HiringCycle/'hiring' singleton's bound folders. Those folders are shared with
// the Core group, so they live inside the Core drive rather than in a space of
// their own; the hub resolves the bound folder id for this path and opens there
// (see drive.hub.tsx). Core-only, same as the Core drive and the nav gate.
export { loader, default, shouldRevalidate } from "~/routes/drive.hub";
