// Drive-namespaced signature view route — re-exports the admin implementation.
// The signature viewer is read-only (no action). The "Back to agreement" link
// inside the component still points at /admin/agreements/:id; when the
// drive-consolidation flag is on that URL redirects to /documents/agreement/:id,
// so navigation stays consistent without touching SignatureViewPage internals.
export { loader, default } from "./admin.agreements.$id.signature.$sigId";
