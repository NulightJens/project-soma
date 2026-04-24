/**
 * SOMA Dashboard — Chart theme configuration.
 * Monochrome palette for all Recharts components (Jens personal brand).
 *
 * Chromatic accents are not used for chart segments. Differentiation in
 * multi-series charts comes from a grayscale ramp, stroke style, and
 * optional dash patterns — not hue.
 *
 * `--destructive` (red) is the ONE chromatic exception, reserved for
 * error severity in SEVERITY_COLORS.
 */

// -- Color palette --
// Deprecated aliases preserved for downstream import compatibility during
// the monochrome cut-over. Callers should migrate to CHART_COLORS / the
// --chart-{n} CSS tokens over time.

export const CHART_GOLD = '#15171a'; // accent (monochrome)
export const CHART_GOLD_LIGHT = '#808286';
export const CHART_GOLD_DARK = '#0a0a0a';
export const CHART_GOLD_MUTED = 'rgba(21, 23, 26, 0.08)';

/**
 * Monochrome ramp for multi-series charts. Six steps descending in
 * weight from primary accent (near-black) to near-border.
 * Matches `--chart-1..5` tokens in globals.css, plus a sixth step.
 */
export const CHART_COLORS = [
  '#15171a', // chart-1 — accent (primary)
  '#4b4d52', // chart-2
  '#808286', // chart-3
  '#b4b5b8', // chart-4
  '#e5e7eb', // chart-5
  '#999999', // chart-6 — mid-range for 6th series
] as const;

// -- Model-specific monochrome steps (for cost charts) --
// Weight descends across model tiers, not hue. Opus = heaviest.

export const MODEL_COLORS: Record<string, string> = {
  opus: '#15171a',
  sonnet: '#4b4d52',
  haiku: '#808286',
};

// -- Severity colors --
// Info and warning are monochrome; error is the one permitted chromatic
// exception (--destructive red). Consumers should pair severity charts
// with icons or labels so meaning is not color-dependent.

export const SEVERITY_COLORS: Record<string, string> = {
  info: '#15171a',
  warning: '#808286',
  error: '#ef4444',
};

// -- Recharts default props --

export const AXIS_STYLE = {
  fontSize: 11,
  fill: 'hsl(var(--muted-foreground))',
  tickLine: false,
  axisLine: false,
} as const;

export const GRID_STYLE = {
  strokeDasharray: '3 3',
  stroke: 'hsl(var(--border))',
  strokeOpacity: 0.5,
} as const;

export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
    padding: '8px 12px',
    color: 'hsl(var(--foreground))',
  },
  labelStyle: {
    color: 'hsl(var(--foreground))',
    fontSize: 11,
    fontWeight: 500,
    marginBottom: 4,
  },
  itemStyle: {
    color: 'hsl(var(--foreground))',
  },
} as const;

// -- Helper functions --

/** Get a color by index, cycling through CHART_COLORS. */
export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/** Get a model color with fallback. */
export function getModelColor(model: string): string {
  const key = model.toLowerCase();
  for (const [name, color] of Object.entries(MODEL_COLORS)) {
    if (key.includes(name)) return color;
  }
  return CHART_COLORS[0];
}

/** Generate a gradient ID for an area chart. */
export function gradientId(prefix: string, index: number = 0): string {
  return `${prefix}-gradient-${index}`;
}
