import { motion, useScroll, useTransform, MotionValue, useInView } from 'framer-motion';
import { useRef, useMemo } from 'react';

interface AnimatedBlocksProps {
  className?: string;
  variant?: 'hero' | 'corner' | 'code' | 'bottom' | 'whoweare';
  delay?: number;
}

export default function AnimatedBlocks({
  className = '',
  variant = 'corner',
  delay = 0
}: AnimatedBlocksProps) {
  const svgRef = useRef(null);
  const isInView = useInView(svgRef, { once: true, amount: 0.3 });

  const blockVariants = {
    hidden: {
      opacity: 0,
      y: -80,
    },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: delay + i * 0.08,
        duration: 0.7,
        ease: [0.34, 1.56, 0.64, 1], // bounce effect
      },
    }),
  };

  // Dynamic fly-in animations from different directions for whoweare
  const flyInDirections = [
    { x: -200, y: -100, rotate: -45, scale: 0.5 },   // top-left
    { x: 200, y: -150, rotate: 30, scale: 0.3 },    // top-right
    { x: -250, y: 50, rotate: -20, scale: 0.4 },    // left
    { x: 0, y: -200, rotate: 15, scale: 0.6 },      // top
    { x: 250, y: 0, rotate: 45, scale: 0.5 },       // right
    { x: -150, y: 200, rotate: -35, scale: 0.3 },   // bottom-left
    { x: 150, y: 180, rotate: 25, scale: 0.4 },     // bottom-right
    { x: -180, y: -80, rotate: -15, scale: 0.5 },   // top-left diagonal
    { x: 220, y: 100, rotate: 40, scale: 0.6 },     // right diagonal
    { x: 0, y: 220, rotate: -10, scale: 0.4 },      // bottom
    { x: -200, y: 120, rotate: 20, scale: 0.5 },    // left-bottom
    { x: 180, y: -120, rotate: -25, scale: 0.3 },   // top-right diagonal
    { x: -120, y: -180, rotate: 35, scale: 0.4 },   // top-left
    { x: 200, y: 150, rotate: -40, scale: 0.5 },    // bottom-right
    { x: -80, y: 200, rotate: 15, scale: 0.6 },     // bottom
    { x: 250, y: -50, rotate: -30, scale: 0.4 },    // right-top
    { x: -220, y: -30, rotate: 25, scale: 0.5 },    // left
    { x: 100, y: -200, rotate: -20, scale: 0.3 },   // top
    { x: -160, y: 160, rotate: 45, scale: 0.4 },    // bottom-left diagonal
    { x: 180, y: 80, rotate: -15, scale: 0.5 },     // right
    { x: 0, y: -180, rotate: 30, scale: 0.6 },      // top center
  ];

  const flyInVariants = {
    hidden: (i: number) => {
      const dir = flyInDirections[i % flyInDirections.length];
      return {
        opacity: 0,
        x: dir.x,
        y: dir.y,
        rotate: dir.rotate,
        scale: dir.scale,
      };
    },
    visible: (i: number) => ({
      opacity: 1,
      x: 0,
      y: 0,
      rotate: 0,
      scale: 1,
      transition: {
        delay: delay + i * 0.06,
        duration: 0.8,
        ease: [0.25, 0.46, 0.45, 0.94], // smooth ease-out
      },
    }),
  };

  // Explode then reassemble animation - blocks start visible, scatter, then come back
  const explodeReassembleVariants = {
    initial: {
      opacity: 1,
      x: 0,
      y: 0,
      rotate: 0,
      scale: 1,
    },
    animate: (i: number) => {
      const dir = flyInDirections[i % flyInDirections.length];
      return {
        opacity: [1, 0, 0, 1],
        x: [0, dir.x * 1.5, dir.x * 1.5, 0],
        y: [0, dir.y * 1.5, dir.y * 1.5, 0],
        rotate: [0, dir.rotate * 2, dir.rotate * 2, 0],
        scale: [1, dir.scale, dir.scale, 1],
        transition: {
          delay: i * 0.03,
          duration: 1.8,
          times: [0, 0.3, 0.5, 1],
          ease: [0.25, 0.46, 0.45, 0.94],
        },
      };
    },
  };

  // Container variants for staggered children animation
  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.05,
        delayChildren: delay,
      },
    },
  };

  if (variant === 'code') {
    // Code blocks from Figma SVG
    return (
      <svg
        ref={svgRef}
        className={className}
        viewBox="0 0 287 381"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: 'visible' }}
      >
        {/* Sparkle/star shape */}
        <motion.g custom={0} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <path d="M128.29 270.463L128.29 263.151L104.214 263.151L121.239 246.127L116.069 240.957L99.0444 257.981L99.0444 233.906L91.733 233.906L91.733 257.981L74.7088 240.957L69.5388 246.127L86.563 263.151L62.4871 263.151L62.4871 270.463L86.563 270.463L69.5388 287.487L74.7087 292.657L91.733 275.633L91.733 299.709L99.0444 299.709L99.0444 275.633L116.069 292.657L121.239 287.487L104.214 270.463L128.29 270.463Z" fill="#FFF3B5"/>
        </motion.g>

        {/* Dark blue rectangle */}
        <motion.g custom={1} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <rect x="286.439" y="228.929" width="76.3096" height="76.3096" transform="rotate(90 286.439 228.929)" fill="#0C4B78"/>
        </motion.g>

        {/* Light yellow rectangle */}
        <motion.g custom={2} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <rect x="210.129" y="152.619" width="76.3096" height="76.3096" transform="rotate(90 210.129 152.619)" fill="#FFF3B5"/>
        </motion.g>

        {/* Green rectangle */}
        <motion.g custom={3} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <rect x="210.129" y="228.929" width="76.3096" height="76.3096" transform="rotate(90 210.129 228.929)" fill="#64B598"/>
        </motion.g>

        {/* Orange/yellow rectangle */}
        <motion.g custom={4} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <rect x="133.819" y="152.988" width="76.3096" height="76.3096" transform="rotate(90 133.819 152.988)" fill="#F9C679"/>
        </motion.g>

        {/* Pink rectangle */}
        <motion.g custom={5} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <rect x="133.819" y="304.685" width="76.3096" height="76.3096" transform="rotate(90 133.819 304.685)" fill="#E68FBE"/>
        </motion.g>

        {/* Dark blue circle bottom */}
        <motion.g custom={6} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="95.8504" cy="342.657" r="19.0774" transform="rotate(90 95.8504 342.657)" fill="#0C4B78"/>
        </motion.g>

        {/* Teal circle */}
        <motion.g custom={7} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="248.471" cy="190.589" r="19.0774" transform="rotate(90 248.471 190.589)" fill="#4CD5C5"/>
        </motion.g>

        {/* Peach circle */}
        <motion.g custom={8} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="171.789" cy="266.898" r="19.0774" transform="rotate(90 171.789 266.898)" fill="#FFA89C"/>
        </motion.g>

        {/* Purple circle right */}
        <motion.g custom={9} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="248.562" cy="267.361" r="19.0774" transform="rotate(90 248.562 267.361)" fill="#CA60AC"/>
        </motion.g>

        {/* Purple circle left */}
        <motion.g custom={10} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="95.8504" cy="190.589" r="19.0774" transform="rotate(90 95.8504 190.589)" fill="#CA60AC"/>
        </motion.g>

        {/* Red circle */}
        <motion.g custom={11} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="19.0774" cy="190.498" r="19.0774" transform="rotate(90 19.0774 190.498)" fill="#E45768"/>
        </motion.g>

        {/* Flower/pinwheel shape */}
        <motion.g custom={12} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <g clipPath="url(#clip0_4622_3276)">
            <mask id="mask0_4622_3276" maskUnits="userSpaceOnUse" x="148" y="166" width="48" height="49">
              <path d="M195.752 214.552L195.752 166.997L148.196 166.997L148.196 214.552L195.752 214.552Z" fill="white"/>
            </mask>
            <g mask="url(#mask0_4622_3276)">
              <path fillRule="evenodd" clipRule="evenodd" d="M171.975 181.579C151.649 153.987 135.175 170.46 162.773 190.779C135.175 211.086 151.649 227.559 171.975 199.979C192.297 227.572 208.774 211.098 181.173 190.779C208.765 170.448 192.297 153.974 171.975 181.579ZM166.029 190.775C166.029 194.058 168.691 196.719 171.974 196.719C175.257 196.719 177.918 194.058 177.918 190.775C177.918 187.492 175.257 184.83 171.974 184.83C168.691 184.83 166.029 187.492 166.029 190.775Z" fill="#24B1B1"/>
            </g>
          </g>
        </motion.g>

        <defs>
          <clipPath id="clip0_4622_3276">
            <rect width="47.5553" height="47.5553" fill="white" transform="translate(195.752 166.997) rotate(90)"/>
          </clipPath>
        </defs>
      </svg>
    );
  }

  if (variant === 'bottom') {
    // Bottom blocks from Figma SVG (below "code, laugh, love" text)
    return (
      <svg
        ref={svgRef}
        className={className}
        viewBox="0 0 307 195"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: 'visible' }}
      >
        {/* Teal rectangle */}
        <motion.g custom={0} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <rect x="48.1055" y="65.1663" width="64.6972" height="64.6972" transform="rotate(-90 48.1055 65.1663)" fill="#8CE0D6"/>
        </motion.g>

        {/* Orange rectangle */}
        <motion.g custom={1} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <rect x="112.805" y="194.092" width="64.6972" height="64.6972" transform="rotate(-90 112.805 194.092)" fill="#F9C679"/>
        </motion.g>

        {/* Red quarter circle */}
        <motion.g custom={2} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <path d="M177.502 65.2503C141.771 65.2503 112.805 35.7313 112.805 7.62939e-06L177.502 7.62939e-06V65.2503Z" fill="#E45768"/>
        </motion.g>

        {/* Light yellow rectangle */}
        <motion.g custom={3} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <rect x="112.805" y="130.5" width="65.2503" height="64.6973" transform="rotate(-90 112.805 130.5)" fill="#FFF3B5"/>
        </motion.g>

        {/* Green quarter circle */}
        <motion.g custom={4} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <path d="M177.5 128.842V64.6977C212.926 64.6977 241.644 93.4161 241.644 128.842H177.5Z" fill="#64B598"/>
        </motion.g>

        {/* Green rectangle */}
        <motion.g custom={5} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <rect x="242.199" y="194.092" width="64.6972" height="64.6972" transform="rotate(-90 242.199 194.092)" fill="#64B598"/>
        </motion.g>

        {/* Gray circle */}
        <motion.g custom={6} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="80.3071" cy="97.2029" r="16.1743" transform="rotate(-90 80.3071 97.2029)" fill="#D2DBE1"/>
        </motion.g>

        {/* Red circle */}
        <motion.g custom={7} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="210.264" cy="32.5057" r="16.1743" transform="rotate(-90 210.264 32.5057)" fill="#F97979"/>
        </motion.g>

        {/* Dark blue circle */}
        <motion.g custom={8} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="80.2251" cy="32.1141" r="16.1743" transform="rotate(-90 80.2251 32.1141)" fill="#0C4B78"/>
        </motion.g>

        {/* Pink circle */}
        <motion.g custom={9} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="16.1743" cy="32.1141" r="16.1743" transform="rotate(-90 16.1743 32.1141)" fill="#E68FBE"/>
        </motion.g>

        {/* Teal circle 1 */}
        <motion.g custom={10} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="145.307" cy="161.586" r="16.1743" transform="rotate(-90 145.307 161.586)" fill="#2DC0C0"/>
        </motion.g>

        {/* Teal circle 2 */}
        <motion.g custom={11} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="209.698" cy="161.586" r="16.1743" transform="rotate(-90 209.698 161.586)" fill="#24B1B1"/>
        </motion.g>

        {/* Peach circle */}
        <motion.g custom={12} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="145.014" cy="97.4607" r="16.1743" transform="rotate(-90 145.014 97.4607)" fill="#FFA89C"/>
        </motion.g>

        {/* Light yellow circle */}
        <motion.g custom={13} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <circle cx="274.78" cy="97.2801" r="16.1743" transform="rotate(-90 274.78 97.2801)" fill="#FFF3B5"/>
        </motion.g>

        {/* Flower/leaf shape */}
        <motion.g custom={14} variants={blockVariants} initial="hidden" animate={isInView ? "visible" : "hidden"}>
          <path fillRule="evenodd" clipRule="evenodd" d="M268.108 148.202C269.29 154.5 274.55 161.649 274.55 161.649C274.55 161.649 280.381 153.723 281.143 147.21C281.251 146.685 281.308 146.138 281.308 145.577C281.308 141.474 278.255 138.149 274.489 138.149C270.723 138.149 267.67 141.474 267.67 145.577C267.67 146.501 267.825 147.386 268.108 148.202ZM274.559 161.666C275.261 161.159 281.98 156.391 287.939 155.27C288.757 154.985 289.644 154.829 290.571 154.829C294.673 154.829 297.999 157.882 297.999 161.648C297.999 165.414 294.673 168.467 290.571 168.467C290.013 168.467 289.469 168.411 288.946 168.304C282.983 167.61 275.829 162.659 274.663 161.828C275.476 162.97 279.905 169.385 280.976 175.099C281.259 175.915 281.414 176.799 281.414 177.723C281.414 181.826 278.361 185.151 274.595 185.151C270.829 185.151 267.776 181.826 267.776 177.723C267.776 177.162 267.833 176.616 267.941 176.091C268.622 170.264 273.362 163.304 274.353 161.903C272.918 162.916 265.981 167.629 260.174 168.305C259.651 168.412 259.107 168.469 258.549 168.469C254.447 168.469 251.121 165.416 251.121 161.649C251.121 157.883 254.447 154.83 258.549 154.83C259.476 154.83 260.363 154.986 261.181 155.271C267.136 156.391 273.848 161.153 274.559 161.666Z" fill="#A2D483"/>
        </motion.g>
      </svg>
    );
  }

  if (variant === 'whoweare') {
    // Who We Are blocks - scroll-linked animation, blocks start visible
    return <WhoWeAreBlocks className={className} flyInDirections={flyInDirections} />;
  }

  // Keep other variants as placeholders for now
  if (variant === 'corner' || variant === 'hero') {
    return null;
  }

  return null;
}

// Helper hook to create transform values for a single block
function useBlockTransforms(
  scrollYProgress: MotionValue<number>,
  direction: { x: number; y: number; rotate: number; scale: number },
  index: number,
  flyMultiplier: number
) {
  const opacityDelay = 0.3 + index * 0.02;
  const x = useTransform(scrollYProgress, [0, 0.1, 0.15, 1], [0, 0, direction.x * flyMultiplier, 0]);
  const y = useTransform(scrollYProgress, [0, 0.1, 0.15, 1], [0, 0, direction.y * flyMultiplier, 0]);
  const rotate = useTransform(scrollYProgress, [0, 0.1, 0.15, 1], [0, 0, direction.rotate * 1.5, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.1, 0.15, opacityDelay, 1], [1, 0, 0, 1, 1]);
  return { x, y, rotate, opacity };
}

// Block data for rendering - defined outside component to avoid recreation
const BLOCK_DATA = [
  // Rectangles
  { type: 'rect', x: 76.6781, y: 0, width: 76.3096, height: 76.3096, fill: '#E68FBE' },
  { type: 'rect', x: 152.62, y: 76.3093, width: 76.3096, height: 76.3096, fill: '#E45768' },
  { type: 'rect', x: 228.931, y: 76.3093, width: 76.3096, height: 76.3096, fill: '#A2D483' },
  { type: 'rect', x: 76.3102, y: 152.619, width: 76.3096, height: 76.3096, fill: '#24B1B1' },
  { type: 'rect', x: 152.62, y: 152.619, width: 76.3096, height: 76.3096, fill: '#FFF3B5' },
  { type: 'path', d: 'M228.931 152.619H305.24V228.929H228.931V152.619Z', fill: '#0C4B78' },
  { type: 'rect', x: 152.988, y: 228.929, width: 76.3096, height: 76.3096, fill: '#CA60AC' },
  { type: 'rect', x: 76.6781, y: 305.239, width: 76.3096, height: 76.3096, fill: '#8CE0D6' },
  // Circles
  { type: 'circle', cx: 114.65, cy: 37.9692, r: 19.0774, fill: '#0C4B78' },
  { type: 'circle', cx: 266.899, cy: 37.9692, r: 19.0774, fill: '#CA60AC' },
  { type: 'circle', cx: 114.65, cy: 114.279, r: 19.0774, fill: '#64B598' },
  { type: 'circle', cx: 190.589, cy: 114.279, r: 19.0774, fill: '#FFA89C' },
  { type: 'circle', cx: 266.899, cy: 114.279, r: 19.0774, fill: '#404040' },
  { type: 'circle', cx: 343.209, cy: 114.279, r: 19.0774, fill: '#FFF3B5' },
  { type: 'circle', cx: 37.9683, cy: 190.959, r: 19.0774, fill: '#FAC27D' },
  { type: 'circle', cx: 114.65, cy: 190.959, r: 19.0774, fill: '#092940' },
  { type: 'circle', cx: 190.589, cy: 190.959, r: 19.0774, fill: '#E45768' },
  { type: 'circle', cx: 266.899, cy: 190.959, r: 19.0774, fill: '#A2D483' },
  { type: 'circle', cx: 114.65, cy: 266.899, r: 19.0774, fill: '#E45768' },
  { type: 'circle', cx: 267.27, cy: 266.899, r: 19.0774, fill: '#0C4B78' },
  { type: 'circle', cx: 114.65, cy: 343.579, r: 19.0774, fill: '#F5F9FF' },
] as const;

// Individual animated block component
function AnimatedBlock({
  scrollYProgress,
  direction,
  index,
  flyMultiplier,
  block
}: {
  scrollYProgress: MotionValue<number>;
  direction: { x: number; y: number; rotate: number; scale: number };
  index: number;
  flyMultiplier: number;
  block: typeof BLOCK_DATA[number];
}) {
  const transforms = useBlockTransforms(scrollYProgress, direction, index, flyMultiplier);

  return (
    <motion.g style={transforms}>
      {block.type === 'rect' && (
        <rect x={block.x} y={block.y} width={block.width} height={block.height} fill={block.fill} />
      )}
      {block.type === 'circle' && (
        <circle cx={block.cx} cy={block.cy} r={block.r} fill={block.fill} />
      )}
      {block.type === 'path' && (
        <path d={block.d} fill={block.fill} />
      )}
    </motion.g>
  );
}

// Scroll-linked Who We Are animation - blocks start assembled, scatter, then reassemble
function WhoWeAreBlocks({
  className,
  flyInDirections
}: {
  className: string;
  flyInDirections: Array<{ x: number; y: number; rotate: number; scale: number }>;
}) {
  const containerRef = useRef<SVGSVGElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "center center"]
  });

  const flyMultiplier = 1.5;

  return (
    <svg
      ref={containerRef}
      className={className}
      viewBox="0 0 382 382"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: 'visible' }}
    >
      {BLOCK_DATA.map((block, index) => (
        <AnimatedBlock
          key={index}
          scrollYProgress={scrollYProgress}
          direction={flyInDirections[index % flyInDirections.length]}
          index={index}
          flyMultiplier={flyMultiplier}
          block={block}
        />
      ))}
    </svg>
  );
}

