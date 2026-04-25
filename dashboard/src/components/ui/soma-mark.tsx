/**
 * SOMA brand mark — black circle with a centered white triangle.
 *
 * Always-black design (theme-independent) because the mark functions as
 * an identity element rather than a UI element. Inline SVG (not raster)
 * so it scales cleanly anywhere it lands — sidebar (28px), login card
 * (48px), splash screen (64px), favicon (32px).
 */

interface SomaMarkProps {
  /** Pixel size — sets both width and height. Defaults to 32. */
  size?: number;
  /** Extra Tailwind classes for the outer SVG. */
  className?: string;
  /** Optional title for accessibility. */
  title?: string;
}

export function SomaMark({ size = 32, className, title }: SomaMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="16" cy="16" r="16" fill="#000" />
      <polygon points="16,8 23,22 9,22" fill="#fff" />
    </svg>
  );
}
