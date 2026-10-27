type RailEdgeHandleProps = {
  onToggle: () => void
}

// The rail's whole right edge hides the rail; tabIndex -1 because the header
// button is the keyboard path to the same action.
export function RailEdgeHandle({ onToggle }: RailEdgeHandleProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onToggle}
      aria-label="Hide sidebar"
      title="Click to hide"
      className="group absolute inset-y-0 -right-1.5 z-10 w-3 cursor-w-resize"
    >
      <span
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 scale-y-90 bg-os-accent opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover:scale-y-100 group-hover:opacity-100"
        aria-hidden
      />
    </button>
  )
}
