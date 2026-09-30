"use client";

import { useId } from "react";
import Image from "next/image";

/**
 * Compact brand mark — nested crescents in the site accent colour, used
 * wherever the full logo banner (LogoBanner, below) would be too wide, e.g.
 * the persistent header nav.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  const uid = useId();
  const bands = [
    { r: 44, cutR: 37, cutOffset: 15 },
    { r: 30, cutR: 24, cutOffset: 12 },
    { r: 16, cutR: 11, cutOffset: 8 },
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        {bands.map((b, i) => (
          <mask key={i} id={`${uid}-crescent-${i}`} maskUnits="userSpaceOnUse">
            <rect x="0" y="0" width="100" height="100" fill="black" />
            <circle cx="50" cy="50" r={b.r} fill="white" />
            <circle cx={50 + b.cutOffset} cy="50" r={b.cutR} fill="black" />
          </mask>
        ))}
      </defs>
      {bands.map((b, i) => (
        <rect
          key={i}
          x="0"
          y="0"
          width="100"
          height="100"
          fill="var(--accent)"
          mask={`url(#${uid}-crescent-${i})`}
        />
      ))}
    </svg>
  );
}

/** The real logo banner (public/logo.jpeg), for prominent placements like the login hero. */
export function LogoBanner({ maxWidth = 420, priority = false }: { maxWidth?: number; priority?: boolean }) {
  return (
    <Image
      src="/logo.jpeg"
      alt="The World Game — Global Predictions League"
      width={2730}
      height={1536}
      priority={priority}
      style={{ width: "100%", maxWidth, height: "auto", display: "block", borderRadius: "var(--radius)" }}
    />
  );
}
