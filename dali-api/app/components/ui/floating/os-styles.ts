import { useFeatureFlag } from "~/components/FeatureFlags";
import {
  MENU_ITEM_CLASS,
  OS_MENU_ITEM_CLASS,
  OS_PANEL_CLASS,
  OS_SELECT_TRIGGER_CLASS,
  PANEL_CLASS,
  SELECT_TRIGGER_CLASS,
} from "./styles";

// One hook per surface so Select / Menu / ContextMenu / Popover all switch
// dress together. Kept out of styles.ts so that module stays importable from
// non-component code.

export function usePanelClass() {
  return useFeatureFlag("os-redesign") ? OS_PANEL_CLASS : PANEL_CLASS;
}

export function useMenuItemClass() {
  return useFeatureFlag("os-redesign") ? OS_MENU_ITEM_CLASS : MENU_ITEM_CLASS;
}

export function useSelectTriggerClass() {
  return useFeatureFlag("os-redesign") ? OS_SELECT_TRIGGER_CLASS : SELECT_TRIGGER_CLASS;
}
