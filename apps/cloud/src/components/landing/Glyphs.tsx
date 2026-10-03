// Small authored glyphs, one stroke weight (1.5) on a 16px grid. Decorative only.
type P = { className?: string };

export function LockGlyph({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.75" />
      <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

export function CheckGlyph({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function CursorGlyph({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 20 24" aria-hidden="true">
      <path d="M3 2.5v16.2l4.3-4.1 2.9 6.6 2.8-1.2-2.9-6.5h6z" fill="currentColor" stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowGlyph({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8h9M8.5 4l4 4-4 4" />
    </svg>
  );
}
