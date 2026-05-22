import type { MouseEvent, KeyboardEvent } from "react";
import {
  MouseSensor as LibMouseSensor,
  KeyboardSensor as LibKeyboardSensor,
} from "@dnd-kit/core";

function shouldHandleEvent(element: HTMLElement | null) {
  let cur = element;
  while (cur) {
    if (cur.dataset?.noDnd) return false;
    cur = cur.parentElement;
  }
  return true;
}

// ES2022 class fields use defineProperty which shadows the parent static rather
// than overriding it, so dnd-kit never sees the custom activators. Assign after
// the class declaration to get a plain assignment on the constructor object.

export class MouseSensor extends LibMouseSensor {}
MouseSensor.activators = [
  {
    eventName: "onMouseDown" as const,
    handler: ({ nativeEvent: event }: MouseEvent) =>
      shouldHandleEvent(event.target as HTMLElement),
  },
];

export class KeyboardSensor extends LibKeyboardSensor {}
KeyboardSensor.activators = [
  {
    eventName: "onKeyDown" as const,
    handler: ({ nativeEvent: event }: KeyboardEvent<Element>) =>
      shouldHandleEvent(event.target as HTMLElement),
  },
];
