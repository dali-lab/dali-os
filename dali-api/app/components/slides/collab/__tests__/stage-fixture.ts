import type { StageFreeform } from "../SlideStage";

const noop = () => {};

export function stageFreeform(selection: string[] = [], over: Partial<StageFreeform> = {}): StageFreeform {
  return {
    selection,
    onSelect: noop,
    editingId: null,
    onEdit: noop,
    cropId: null,
    prefs: { items: true, margins: true, grid: false },
    armed: null,
    onPlace: noop,
    onCommit: noop,
    peerDrags: new Map(),
    onPublishDrag: noop,
    onActivate: noop,
    editPoint: { current: null },
    onEscape: noop,
    onGrow: noop,
    onContext: (target) => (target ? [target] : []),
    handlers: new Proxy({}, { get: () => noop }) as StageFreeform["handlers"],
    stageHandlers: () => new Proxy({}, { get: () => noop }) as ReturnType<StageFreeform["stageHandlers"]>,
    barHandlers: new Proxy({}, { get: () => noop }) as StageFreeform["barHandlers"],
    canPaste: true,
    styleKind: null,
    onDropFiles: noop,
    ...over,
  };
}
