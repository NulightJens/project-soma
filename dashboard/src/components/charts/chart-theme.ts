/**
 * cortextOS Dashboard - Chart theme configuration.
 * Gold/mustard palette for all Recharts components.
 */

// -- Color palette --

export const CHART_GOLD = '#D4A017';
export const CHART_GOLD_LIGHT = '#F5D76E';
export const CHART_GOLD_DARK = '#A67C00';
export const CHART_GOLD_MUTED = 'rgba(212, 160, 23, 0.15)';

export const CHART_COLORS = [
  '#D4A017', // gold (primary)
  '#2563EB', // blue
  '#7C3AED', // purple
  '#DB2777', // pink
  '#059669', // green
  '#EA580C', // orange
] as const;

// -- Model-specific colors (for cost charts) --

export const MODEL_COLORS: Record<string, string> = {
  opus: '#D4A017',
  sonnet: '#2563EB',
  haiku: '#7C3AED',
};

// -- Severity colors --

export const SEVERITY_COLORS: Record<string, string> = {
  info: '#2563EB',
  warning: '#D4A017',
  error: '#EF4444',
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

/** Get a color by index, cycling through CHART_COLORS */
export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/** Get a model color with fallback */
export function getModelColor(model: string): string {
  const key = model.toLowerCase();
  for (const [name, color] of Object.entries(MODEL_COLORS)) {
    if (key.includes(name)) return color;
  }
  return CHART_COLORS[0];
}

/** Generate a gradient ID for an area chart */
export function gradientId(prefix: string, index: number = 0): string {
  return `${prefix}-gradient-${index}`;
}
