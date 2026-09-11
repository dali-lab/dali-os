import {
  OS_MENU_ITEM_CLASS,
  OS_PANEL_CLASS,
  OS_SELECT_TRIGGER_CLASS,
} from "./styles";

// One accessor per surface so Select / Menu / ContextMenu / Popover all read
// the same os dress. Kept out of styles.ts so that module stays importable from
// non-component code.

export function usePanelClass() {
  return OS_PANEL_CLASS;
}

export function useMenuItemClass() {
  return OS_MENU_ITEM_CLASS;
}

export function useSelectTriggerClass() {
  return OS_SELECT_TRIGGER_CLASS;
}
