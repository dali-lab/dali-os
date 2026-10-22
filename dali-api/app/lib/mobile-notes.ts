import type { DocBlock } from "~/collab/blocknote-server";
import { blockOwnText } from "~/components/doc/schema/configs";
import type { StoredEnhanceNotes } from "~/components/meeting-recorder/enhance-plan";

export type OutlineItem =
  | { kind: "heading"; text: string; level: number }
  | { kind: "text"; text: string; depth: number }
  | { kind: "bullet"; text: string; depth: number }
  | { kind: "check"; text: string; depth: number; checked: boolean };

export type MobileActionItem = {
  index: number;
  text: string;
  ownerUserId: string | null;
  ownerName: string | null;
  due: string | null;
  taskId: string | null;
};

const BULLET_TYPES = new Set(["bulletListItem", "numberedListItem", "toggleListItem"]);

function isTranscriptToggle(b: DocBlock): boolean {
  return b.type === "heading" && Boolean(b.props?.isToggleable) && blockOwnText(b).trim() === "Transcript";
}

// The note page flattened to what a phone shows: headings, text, bullets and
// checklist items. The Transcript toggle is dropped (the app has its own
// transcript view), and so is anything without text.
export function noteOutline(blocks: DocBlock[], depth = 0): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const b of blocks) {
    if (isTranscriptToggle(b)) continue;
    const text = blockOwnText(b).trim();
    if (text) {
      if (b.type === "heading") {
        const level = Number(b.props?.level);
        out.push({ kind: "heading", text, level: Number.isInteger(level) && level > 0 ? level : 1 });
      } else if (b.type === "checkListItem") {
        out.push({ kind: "check", text, depth, checked: b.props?.checked === true });
      } else if (BULLET_TYPES.has(b.type)) {
        out.push({ kind: "bullet", text, depth });
      } else {
        out.push({ kind: "text", text, depth });
      }
    }
    out.push(...noteOutline(b.children ?? [], depth + 1));
  }
  return out;
}

export function actionItemsOf(notes: unknown): MobileActionItem[] {
  const plan = (notes as StoredEnhanceNotes | null)?.plan;
  if (!plan || !Array.isArray(plan.actionItems)) return [];
  return plan.actionItems.map((a, index) => ({
    index,
    text: a.text,
    ownerUserId: a.ownerUserId ?? null,
    ownerName: a.ownerName ?? null,
    due: a.due ?? null,
    taskId: a.taskId ?? null,
  }));
}

/** The Drive page id behind a "doc:<pageId>:body" collab room, else null. */
export function notePageId(documentName: string): string | null {
  const [entity, id] = documentName.split(":");
  return entity === "doc" && id ? id : null;
}
