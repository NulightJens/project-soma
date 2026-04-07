'use client';

import {
  LineChart,
  Line,
  ResponsiveContainer,
} from 'recharts';
import { CHART_GOLD } from './chart-theme';

export interface SparkLineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Tiny inline sparkline for embedding in cards / table cells.
 */
export function SparkLine({
  data,
  color = CHART_GOLD,
  width = 80,
  height = 24,
  className,
}: SparkLineProps) {
  const chartData = data.map((value, i) => ({ i, v: value }));

  return (
    <span className={className} style={{ display: 'inline-block', width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </span>
  );
}
