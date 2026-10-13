import {
  RECEIVER_LABELS,
  RECEIVER_SLOTS,
  type ReceiverFolderType,
  type ReceiverProcessType,
} from "~/lib/drive-receivers";

import { pickDrives, type PickerRows } from "~/components/drive/picker-rows";

export type SlotChoice = {
  processType: ReceiverProcessType;
  processId: string | null;
  folderType: ReceiverFolderType;
};

export const CHOICE_NONE = "none";
export const CHOICE_HINT = "hint";

export type Choice = typeof CHOICE_NONE | typeof CHOICE_HINT | `slot:${string}`;

export type ReceiverRequest =
  | { intent: "set"; processType: ReceiverProcessType; processId?: string; folderType: ReceiverFolderType; folderId: string }
  | { intent: "clear"; processType: ReceiverProcessType; processId?: string; folderType: ReceiverFolderType }
  | { intent: "hint"; folderId: string; hint: "Meetings" | null };

const SPACE_PROCESS: Record<string, Exclude<ReceiverProcessType, "Project">> = {
  core: "Core",
  hiring: "HiringCycle",
  mentorship: "Mentorship",
  lab: "Lab",
};

function slotsOf(processType: ReceiverProcessType, processId: string | null): SlotChoice[] {
  return RECEIVER_SLOTS[processType].map((folderType) => ({ processType, processId, folderType }));
}

/** The process slots a folder in this space can receive for, given who is looking. Core decides lab-wide
 *  filing; a project's members decide where its own meetings land. */
export function eligibleSlotsFor(
  scopeId: string,
  projectId: string | null,
  isCore: boolean,
  isProjectMember: boolean,
): SlotChoice[] {
  const spaceProcess = SPACE_PROCESS[scopeId];
  if (spaceProcess) return isCore ? slotsOf(spaceProcess, null) : [];
  if (projectId && (scopeId === "projects" || scopeId.startsWith("project:"))) {
    return isCore || isProjectMember ? slotsOf("Project", projectId) : [];
  }
  return [];
}

type TreeItem = { id: string; parentFolderId: string | null };

/** The project a folder belongs to: the embedded `project:<id>` scope names it, and in the Projects drive it is the
 *  synthetic top-level folder at the end of the parent chain. */
export function projectIdFor(scopeId: string, items: TreeItem[], folderId: string): string | null {
  if (scopeId.startsWith("project:")) return scopeId.slice("project:".length);
  if (scopeId !== "projects") return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  let cur = byId.get(folderId);
  while (cur && cur.parentFolderId !== null && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentFolderId);
  }
  return cur && cur.parentFolderId === null && cur.id !== folderId ? cur.id : null;
}

/** A real page folder: not a Drive root, and not the synthetic project/offering rows the Projects and Education
 *  drives list as folders. */
export function isPageFolder(item: { type: string; href: string; folderType?: string | null }): boolean {
  return item.type === "folder" && item.folderType !== "Root" && item.href.startsWith("/documents/");
}

export function slotChoice(slot: SlotChoice): Choice {
  return `slot:${slot.processType}:${slot.folderType}`;
}

export function choiceLabel(choice: Choice, slots: SlotChoice[]): string {
  if (choice === CHOICE_NONE) return "None";
  if (choice === CHOICE_HINT) return "Meeting notebooks (hint)";
  const slot = slots.find((s) => slotChoice(s) === choice);
  if (!slot) return "None";
  return slot.folderType === "Meetings" ? "Meeting notebooks (new notes file here)" : RECEIVER_LABELS[slot.folderType];
}

/** Which option reflects the folder today. A slot is the folder's own when the slot's receiver is this folder; a
 *  Meetings folder that holds no slot is a hint. */
export function currentChoice({
  folderId,
  folderType,
  slots,
  holders,
}: {
  folderId: string;
  folderType: string | null | undefined;
  slots: SlotChoice[];
  /** `folderType` -> id of the folder holding that slot, for the process the slots belong to. */
  holders: Partial<Record<ReceiverFolderType, string | null>>;
}): Choice {
  const held = slots.find((s) => holders[s.folderType] === folderId);
  if (held) return slotChoice(held);
  return folderType === "Meetings" ? CHOICE_HINT : CHOICE_NONE;
}

function slotRequest(slot: SlotChoice): { processType: ReceiverProcessType; processId?: string; folderType: ReceiverFolderType } {
  return {
    processType: slot.processType,
    ...(slot.processId ? { processId: slot.processId } : {}),
    folderType: slot.folderType,
  };
}

/** The writes that move a folder from one choice to another, in order. The API refuses to stack a hint and a slot on
 *  one folder, so the old choice is cleared first. */
export function planChoiceChange(
  folderId: string,
  from: Choice,
  to: Choice,
  slots: SlotChoice[],
): ReceiverRequest[] {
  if (from === to) return [];
  const steps: ReceiverRequest[] = [];
  const fromSlot = slots.find((s) => slotChoice(s) === from);
  if (fromSlot) steps.push({ intent: "clear", ...slotRequest(fromSlot) });
  else if (from === CHOICE_HINT) steps.push({ intent: "hint", folderId, hint: null });
  const toSlot = slots.find((s) => slotChoice(s) === to);
  if (toSlot) steps.push({ intent: "set", ...slotRequest(toSlot), folderId });
  else if (to === CHOICE_HINT) steps.push({ intent: "hint", folderId, hint: "Meetings" });
  return steps;
}

const PROCESS_DRIVE: Record<Exclude<ReceiverProcessType, "Project">, string> = {
  Core: "core",
  HiringCycle: "hiring",
  Mentorship: "mentorship",
  Lab: "lab",
};

/** Where a process's receiver can live, as the one drive the picker offers. A project is a folder inside the
 *  Projects drive, so its subtree stands in as a drive of its own. */
export function receiverPickerRows(
  rows: PickerRows,
  processType: ReceiverProcessType,
  processId: string | null,
): PickerRows {
  if (processType !== "Project") return pickDrives(rows, (id) => id === PROCESS_DRIVE[processType]);
  const projectFolder = rows.folders.find((f) => f.driveId === "projects" && f.id === processId);
  if (!projectFolder) return { drives: [], folders: [] };
  const inProject = new Set<string>([projectFolder.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of rows.folders) {
      if (f.driveId === "projects" && f.parentId !== null && inProject.has(f.parentId) && !inProject.has(f.id)) {
        inProject.add(f.id);
        grew = true;
      }
    }
  }
  return {
    drives: [{ id: "projects", label: projectFolder.title }],
    folders: rows.folders
      .filter((f) => inProject.has(f.id) && f.id !== projectFolder.id)
      .map((f) => (f.parentId === projectFolder.id ? { ...f, parentId: null } : f)),
  };
}

/** The picker destination for "nothing chosen": a drive's top level is not a folder, so it can't be a receiver. */
export function topLevelOf(rows: PickerRows): { driveId: string; folderId: null } | null {
  const drive = rows.drives[0];
  return drive ? { driveId: drive.id, folderId: null } : null;
}

export function spaceNoun(processType: ReceiverProcessType): string {
  switch (processType) {
    case "Core":
      return "Core";
    case "HiringCycle":
      return "Hiring";
    case "Mentorship":
      return "Mentorship";
    case "Lab":
      return "General";
    case "Project":
      return "project";
  }
}

/** What a folder receives, for the details pane; null for plain folders, roots and types this build doesn't know. */
export function receivesLabel(folderType: string | null | undefined): string | null {
  if (!folderType || !Object.prototype.hasOwnProperty.call(RECEIVER_LABELS, folderType)) return null;
  return RECEIVER_LABELS[folderType as ReceiverFolderType];
}
