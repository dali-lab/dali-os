// Thin re-export — the legacy ProseMirror → Yjs pipeline moved to
// legacy/pm-to-y.ts as part of the BlockNote migration. New code should write
// blocks via blocknote-server.ts / write.ts instead.

export { pmJsonToYDoc, replaceFragment } from "./legacy/pm-to-y";
