// Lets the generic side menu (DocSideMenu.tsx) offer Keep change/Revert
// change on a marked block without depending on the meeting recorder
// directly — the document route (documents.$pageId.tsx) provides this
// whenever its recording hook is mounted; everywhere else it's null and the
// side menu renders nothing extra (specs/meeting-recording-rail.md Step 2).

import { createContext } from "react";

export type EnhanceReviewHandlers = {
  keepBlock: (id: string) => void;
  revertBlock: (id: string) => void;
  /** Full prior DocBlock JSON for a changed block, keyed by id — the
   *  side-menu item's own "Was: …" context, same data the rail row shows. */
  priorBlocks: Record<string, unknown> | undefined;
};

export const EnhanceReviewContext = createContext<EnhanceReviewHandlers | null>(null);
