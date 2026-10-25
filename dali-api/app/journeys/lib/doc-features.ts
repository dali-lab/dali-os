import type { Features } from "~/components/doc/features";

// The editor and the learner view must register the same blocks: BlockNote
// strips any block its schema doesn't know when a document loads.
export const LESSON_FEATURES: Features = { images: true, files: true, richBlocks: true };
