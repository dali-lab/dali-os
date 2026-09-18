import { useId } from 'react'

// Soft light/shadow edge strokes from the favorites cards in the Figma export (Frame_198).
const EDGE = 'M93.2143 0C11.2351 0.369993 -1.95942 13.7571 0.214809 71C1.21451 78 5.71447 77.5 5.71447 71C5.71569 19.5 20.2117 5 93.2143 5C101.726 5 99.714 2.97427e-05 93.2143 0Z'

/** Blurred highlight (top-left) and shade (bottom-right) that give the glass cards depth. */
export default function CardBevel() {
  const blurId = `card-bevel-${useId().replace(/[^\w-]/g, '')}`

  return (
    <svg
      viewBox="0 0 280 183"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className="absolute inset-0 size-full pointer-events-none"
    >
      <g filter={`url(#${blurId})`} transform="translate(9.78711 11.5)">
        <path d={EDGE} stroke="white" strokeOpacity="0.28" strokeWidth="11" />
      </g>
      <g filter={`url(#${blurId})`} transform="matrix(-1 0 0 -1 266.869 172.062)">
        <path d={EDGE} stroke="black" strokeOpacity="0.28" strokeWidth="11" />
      </g>
      <defs>
        <filter id={blurId} x="-65.5" y="-65.5" width="229.883" height="207.066" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="30" />
        </filter>
      </defs>
    </svg>
  )
}
