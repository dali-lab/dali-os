import type { Vibe } from "./vibe";

// The subset of a grid cell that isUnfilled needs. Kept in a pure, client-safe
// module (no prisma import) so both the server grid builder and its unit test
// can use it. The full GridCell (mentor-grid.server) satisfies this
// structurally.
export type UnfilledCell = {
  state: "submitted" | "missing" | "future";
  vibe: Vibe | null;
};

// A due week with no rating recorded: either no note at all, or a note whose
// vibe was never set. "future" weeks (not yet due) never count. Shared by the
// browse "Not filled in" status filter and the mentor-nudge targeting so both
// agree on what "not filled in" means.
export function isUnfilled(cell: UnfilledCell): boolean {
  return (
    cell.state === "missing" ||
    (cell.state === "submitted" && cell.vibe == null)
  );
}
