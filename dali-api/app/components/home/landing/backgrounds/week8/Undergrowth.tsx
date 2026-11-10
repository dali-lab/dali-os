import butterflyMarkup from '~/assets/landing/week8/butterfly.fragment.svg?raw'
import { Ant, Spider } from './critters'
import {
  ANT_COUNT,
  ANT_LEAF,
  ANT_TRAIL,
  DAPPLE_LIGHT,
  DAPPLE_SHADE,
  DEW,
  POLLEN_BANDS,
  SPIDER_ANCHOR,
  moteAt,
} from './critterPlaces'

/**
 * The layer added on top of the week 8 export: overhead light, pollen, dew, an ant column and a
 * spider.
 *
 * One <svg> carrying the export's own viewBox and preserveAspectRatio, so it covers and crops
 * exactly as the foliage does and a coordinate written in critterPlaces.ts lands where the art
 * puts it. week8.css sizes both with the same rule, and the re-framing shift is read from the same
 * container, so the two can never drift out of register.
 *
 * It sits between the foliage and the scrim, which is deliberate: this is part of the scene, so
 * the frosted glass over the copy frosts it too rather than leaving it sharp over a blurred
 * picture.
 *
 * Everything that sits on a leaf is wrapped in that leaf's ride. prep-week8-art.py derives one
 * `w8-ride-<leaf>` animation per animated leaf, being the motion that leaf performs in frame
 * coordinates, and anything inside a group carrying it moves exactly as the leaf does. Without
 * that, an ant walks over a leaf that is tipping underneath it, which is the single thing that
 * most gives the scene away.
 */
export default function Undergrowth() {
  return (
    <svg
      className="w8-undergrowth"
      viewBox="0 0 4076 1545"
      preserveAspectRatio="xMinYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* A gap in the canopy: bright in the middle, gone by the edge. */}
        <radialGradient id="w8-dapple-light">
          <stop offset="0%" stopColor="#FFFBE4" stopOpacity="0.34" />
          <stop offset="32%" stopColor="#FFF7D8" stopOpacity="0.21" />
          <stop offset="72%" stopColor="#FFF7D8" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#FFF7D8" stopOpacity="0" />
        </radialGradient>
        {/* And the leaf above it. Cool rather than black: a daylight shadow is sky-lit. */}
        <radialGradient id="w8-dapple-shade">
          <stop offset="0%" stopColor="#0B2A24" stopOpacity="0.54" />
          <stop offset="38%" stopColor="#102E26" stopOpacity="0.34" />
          <stop offset="76%" stopColor="#102E26" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#102E26" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="w8-dew">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="55%" stopColor="#E8F6E0" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#CFE4C6" stopOpacity="0.08" />
        </radialGradient>
      </defs>

      {/*
       * Shade first, then light, so a bright patch can sit on top of a dark one and read as a gap
       * in the canopy rather than as two washes fighting.
       *
       * The two groups blend differently and so cannot be one group: multiply for the shade, which
       * can only darken, and screen for the light, which can only brighten. Over foliage that
       * distinction matters -- a normal-blended pale blob greys the leaves out and reads as fog.
       */}
      <g className="w8-dapple-shade">
        {DAPPLE_SHADE.map((blob, i) => (
          <ellipse
            key={blob.id}
            className={`w8-blob w8-blob-${i % 4}`}
            cx={blob.x}
            cy={blob.y}
            rx={blob.rx}
            ry={blob.ry}
            transform={`rotate(${blob.angle} ${blob.x} ${blob.y})`}
            fill="url(#w8-dapple-shade)"
          />
        ))}
      </g>

      <g className="w8-dapple-light">
        {DAPPLE_LIGHT.map((blob, i) => (
          <ellipse
            key={blob.id}
            className={`w8-blob w8-blob-${i % 4}`}
            cx={blob.x}
            cy={blob.y}
            rx={blob.rx}
            ry={blob.ry}
            transform={`rotate(${blob.angle} ${blob.x} ${blob.y})`}
            fill="url(#w8-dapple-light)"
          />
        ))}
      </g>

      {/* Dew, each drop inside its own leaf's ride. */}
      {DEW.map((drop, i) => (
        <g key={drop.id} className={`w8-ride w8-ride-${drop.leaf}`}>
          <g className={`w8-drop w8-drop-${i % 3}`} transform={`translate(${drop.x} ${drop.y})`}>
            <circle className="w8-drop-body" r={drop.r} fill="url(#w8-dew)" />
            <circle
              className="w8-drop-glint"
              cx={-drop.r * 0.3}
              cy={-drop.r * 0.35}
              r={drop.r * 0.28}
              fill="#FFFFFF"
            />
          </g>
        </g>
      ))}

      {/*
       * The ant column, riding the leaf it walks on.
       *
       * Every ant follows the same offset-path -- ANT_TRAIL, fed in from critterPlaces.ts so the
       * trail is declared once -- and takes its place in the column from its own negative delay, so
       * the spacing is a function of the count rather than seven hand-tuned numbers. The trail
       * starts and ends off the left edge of the frame, so the loop has no seam to hide.
       */}
      <g className={`w8-ride w8-ride-${ANT_LEAF}`}>
        <g className="w8-ants">
          {Array.from({ length: ANT_COUNT }, (_, i) => (
            <g
              key={i}
              className="w8-ant-walker"
              style={{
                offsetPath: `path("${ANT_TRAIL}")`,
                animationDelay: `${((-i * 13.6) / ANT_COUNT).toFixed(2)}s`,
              }}
            >
              <Ant />
            </g>
          ))}
        </g>
      </g>

      {/*
       * The spider, tied to the underside of the ladybird's leaf and riding it.
       *
       * The thread is drawn here rather than in the Spider component, as a one-unit line scaled in
       * Y, so it can stretch with the descent instead of travelling with the body. Its stroke is
       * non-scaling, or a scale of 560 would be a scale of 560 on the stroke as well.
       */}
      <g className={`w8-ride w8-ride-${SPIDER_ANCHOR.leaf}`}>
        <g transform={`translate(${SPIDER_ANCHOR.x} ${SPIDER_ANCHOR.y})`}>
          <g className="w8-spider-swing">
            <line
              className="w8-spider-thread"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
              stroke="#D8E6CF"
              strokeWidth="2"
              opacity="0.34"
              vectorEffect="non-scaling-stroke"
            />
            <g className="w8-spider-drop">
              {/* 1.5x: at its drawn size the spider is a fifth of the ladybird and reads as a speck. */}
              <g transform="scale(1.5)">
                <Spider />
              </g>
            </g>
          </g>
        </g>
      </g>

      {/*
       * The export's butterfly, lifted out of it by prep-week8-art.py so it sits above the ants
       * walking its leaf rather than under them. Its shadow stays in the export, on the leaf.
       */}
      <g
        // The markup is a build-time import of a file in this repo, not anything user-supplied.
        dangerouslySetInnerHTML={{ __html: butterflyMarkup }}
      />

      {/*
       * Pollen last, so it drifts in front of everything -- which is what sells it as being between
       * you and the undergrowth rather than stuck to a leaf. It is the one thing here that does not
       * ride a leaf, because it is not resting on one.
       *
       * Three bands at different sizes and speeds. Positions come from a deterministic hash, not
       * Math.random, so two renders of the same frame are identical and a diff still means
       * something.
       */}
      <g className="w8-pollen">
        {POLLEN_BANDS.map((band, b) => (
          <g key={band.id} className={`w8-pollen-band w8-pollen-${band.id}`}>
            {Array.from({ length: band.count }, (_, i) => {
              const at = moteAt(b, i)
              return (
                <circle
                  key={i}
                  className={`w8-mote w8-mote-${i % 4}`}
                  cx={at.x}
                  cy={at.y}
                  r={band.radius}
                  fill="#FFF8DC"
                />
              )
            })}
          </g>
        ))}
      </g>
    </svg>
  )
}
