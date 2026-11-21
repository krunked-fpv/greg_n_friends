import { useId, useMemo } from 'react';
import type { TelemetryFix } from '../../types/telemetry';

export interface SparklineSvgProps {
  fixes: TelemetryFix[];
  colorHex?: string;
  width?: number;
  height?: number;
  className?: string;
}

function downsampleNumericSeries(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const result: number[] = [];
  const step = (values.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(values.length - 1, Math.round(i * step));
    result.push(values[idx]);
  }
  return result;
}

export function SparklineSvg({
  fixes,
  colorHex = '#22d3ee',
  width = 88,
  height = 24,
  className = '',
}: SparklineSvgProps) {
  const rawId = useId();
  const gradId = `spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const geometry = useMemo(() => {
    const validSpeeds: number[] = [];
    for (const fix of fixes) {
      if (
        !fix.isOutlierSpike &&
        fix.groundSpeedKmh !== null &&
        Number.isFinite(fix.groundSpeedKmh) &&
        fix.groundSpeedKmh >= 0
      ) {
        validSpeeds.push(fix.groundSpeedKmh);
      }
    }

    if (validSpeeds.length < 2) {
      return null;
    }

    const sampled = downsampleNumericSeries(validSpeeds, 40);
    const padX = 2;
    const padY = 3;
    const innerW = Math.max(1, width - padX * 2);
    const innerH = Math.max(1, height - padY * 2);

    const minVal = Math.min(...sampled);
    const maxVal = Math.max(...sampled);
    const range = maxVal - minVal;

    const points = sampled.map((val, idx) => {
      const x = padX + (idx / (sampled.length - 1)) * innerW;
      const normalized = range > 1e-6 ? (val - minVal) / range : 0.5;
      const y = padY + (1 - normalized) * innerH;
      return { x, y };
    });

    const linePath = points
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
      .join(' ');

    const last = points[points.length - 1];
    const first = points[0];
    const areaPath = `${linePath} L${last.x.toFixed(1)},${(height - 1).toFixed(1)} L${first.x.toFixed(1)},${(height - 1).toFixed(1)} Z`;

    return { linePath, areaPath, last };
  }, [fixes, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`shrink-0 overflow-visible ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorHex} stopOpacity="0.34" />
          <stop offset="100%" stopColor={colorHex} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {geometry ? (
        <>
          <path d={geometry.areaPath} fill={`url(#${gradId})`} />
          <path
            d={geometry.linePath}
            fill="none"
            stroke={colorHex}
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx={geometry.last.x}
            cy={geometry.last.y}
            r="2.1"
            fill={colorHex}
            stroke="#04070d"
            strokeWidth="0.9"
          />
        </>
      ) : (
        <line
          x1="2"
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke={colorHex}
          strokeOpacity="0.38"
          strokeWidth="1.2"
          strokeDasharray="2.5 2.5"
        />
      )}
    </svg>
  );
}

export default SparklineSvg;
