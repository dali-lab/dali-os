// Self-contained sparkle/AI icon — three 4-pointed stars (one large, two small).
// currentColor fill so it inherits from text-* classes.

import React from "react";

interface AiSparkleIconProps {
  size?: number;
  className?: string;
}

export function AiSparkleIcon({ size = 16, className }: AiSparkleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      {/* Large 4-pointed star, center */}
      <path d="M12 2 L13.5 9.5 L21 11 L13.5 12.5 L12 20 L10.5 12.5 L3 11 L10.5 9.5 Z" />
      {/* Small 4-pointed star, top-right */}
      <path d="M19 2 L19.8 5.2 L23 6 L19.8 6.8 L19 10 L18.2 6.8 L15 6 L18.2 5.2 Z" />
      {/* Tiny 4-pointed star, bottom-right */}
      <path d="M20 15 L20.5 17 L22.5 17.5 L20.5 18 L20 20 L19.5 18 L17.5 17.5 L19.5 17 Z" />
    </svg>
  );
}
