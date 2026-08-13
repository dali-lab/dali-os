// Projects-namespaced transfer form.
//
// PURE RE-EXPORT of the internal-processes transfer route. The Lab Processes
// area is gone (its hub and JobX pages were removed), so Transfer — the one
// page there members still use — now hangs off Projects. The old
// /internal-processes/transfer URL keeps working and redirects here.

export { meta, loader, default } from "~/internal-processes/routes/internal-processes.transfer";
