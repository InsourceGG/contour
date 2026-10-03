/**
 * Topographic contour lines, generated deterministically (no randomness) so
 * server and client markup match. Used as the backdrop of the adaptable
 * "plate" and on the sign-in screen.
 */

type Peak = { cx: number; cy: number; base: number; step: number; rings: number; phase: number };

function ringPath(p: Peak, k: number): string {
  const n = 64;
  const pts: [number, number][] = [];
  const r0 = p.base + k * p.step;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble =
      1 +
      0.16 * Math.sin(2 * t + p.phase + k * 0.21) +
      0.08 * Math.sin(3 * t + p.phase * 1.7 - k * 0.13) +
      0.04 * Math.sin(5 * t + p.phase * 0.6 + k * 0.3);
    const r = r0 * wobble;
    pts.push([p.cx + r * Math.cos(t) * 1.35, p.cy + r * Math.sin(t)]);
  }
  // Closed Catmull-Rom → cubic Bézier.
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

function buildPaths(peaks: Peak[]): string[] {
  return peaks.flatMap((p) => Array.from({ length: p.rings }, (_, k) => ringPath(p, k)));
}

const PLATE_PATHS = buildPaths([
  { cx: 1040, cy: 90, base: 26, step: 34, rings: 11, phase: 0.6 },
  { cx: 140, cy: 560, base: 30, step: 38, rings: 7, phase: 2.1 },
]);

const HERO_PATHS = buildPaths([
  { cx: 420, cy: 360, base: 18, step: 30, rings: 14, phase: 1.2 },
  { cx: 760, cy: 120, base: 22, step: 34, rings: 6, phase: 2.6 },
]);

export function PlateLines() {
  return (
    <svg className="plate-lines" viewBox="0 0 1200 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke">
        {PLATE_PATHS.map((d, i) => (
          <path key={i} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}

export function HeroLines({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 840 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke">
        {HERO_PATHS.map((d, i) => (
          <path key={i} d={d} strokeWidth={i % 5 === 4 ? 1.6 : 0.9} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}

/** Wordmark glyph: three nested contours. */
export function ContourMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M12 2.5c5.6 0 9.5 3.6 9.5 8.6 0 5.6-4.4 10.4-9.9 10.4C6 21.5 2.5 17.4 2.5 12 2.5 6.4 6.6 2.5 12 2.5Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12.2 6.6c3.2 0 5.4 2 5.4 4.8 0 3.2-2.5 5.9-5.6 5.9-3.1 0-5.1-2.3-5.1-5.3 0-3.1 2.3-5.4 5.3-5.4Z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12.2" cy="11.8" r="1.9" fill="currentColor" />
    </svg>
  );
}
