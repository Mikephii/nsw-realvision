export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="5"
      className={className}
      aria-hidden="true"
    >
      {/* House outline (open path, gap at bottom-right for handle) */}
      <path d="M84 65 L84 40 L50 13 L16 40 L16 86 L54 86" />
      {/* Magnifying glass circle (centered in house body) */}
      <circle cx="50" cy="58" r="14" />
      {/* Magnifying glass handle (exits through gap to lower-right) */}
      <line x1="59.9" y1="67.9" x2="74" y2="82" />
    </svg>
  )
}
