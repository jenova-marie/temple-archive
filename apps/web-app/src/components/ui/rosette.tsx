import type { SVGProps } from "react";

/**
 * 8-pointed star — the cuneiform glyph for the goddess Inanna/Ishtar
 * (𒀭, dingir, sky/divinity), used as the brand mark for the Temple
 * of Inanna's Light.
 *
 * Two overlaid 4-point stars rotated 45° produce eight rays. Inherits
 * `currentColor` so it matches the surrounding text color.
 */
export function Rosette(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 1 L14.2 9.8 L23 12 L14.2 14.2 L12 23 L9.8 14.2 L1 12 L9.8 9.8 Z" />
      <path
        d="M12 1 L14.2 9.8 L23 12 L14.2 14.2 L12 23 L9.8 14.2 L1 12 L9.8 9.8 Z"
        transform="rotate(45 12 12)"
        opacity="0.55"
      />
    </svg>
  );
}
