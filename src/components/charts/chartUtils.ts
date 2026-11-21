import { useEffect, useState, type RefObject } from 'react';
import type { TelemetryFix } from '../../types/telemetry';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function useContainerWidth(
  ref: RefObject<HTMLDivElement | null>,
  fallbackWidth = 340,
): number {
  const [width, setWidth] = useState<number>(fallbackWidth);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const next = Math.round(el.clientWidth);
      if (next >= 180) {
        setWidth(next);
      }
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w >= 180) {
          setWidth(w);
        }
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return width;
}

export function findNearestFixByMs(
  fixes: TelemetryFix[],
  targetMs: number,
): TelemetryFix | null {
  if (fixes.length === 0 || !Number.isFinite(targetMs)) return null;
  let lo = 0;
  let hi = fixes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fixes[mid].timestampMs < targetMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const candidate = fixes[lo];
  if (lo > 0) {
    const prev = fixes[lo - 1];
    if (
      Math.abs(prev.timestampMs - targetMs) <
      Math.abs(candidate.timestampMs - targetMs)
    ) {
      return prev;
    }
  }
  return candidate;
}

export interface NumericSeriesPoint {
  timestampMs: number;
  value: number;
  fix: TelemetryFix;
}

export function interpolateSeriesValueAtMs(
  points: NumericSeriesPoint[],
  targetMs: number,
): number | null {
  if (points.length === 0 || !Number.isFinite(targetMs)) return null;
  if (points.length === 1) return points[0].value;
  if (targetMs <= points[0].timestampMs) return points[0].value;
  if (targetMs >= points[points.length - 1].timestampMs) {
    return points[points.length - 1].value;
  }

  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midMs = points[mid].timestampMs;
    if (midMs === targetMs) return points[mid].value;
    if (midMs < targetMs) lo = mid + 1;
    else hi = mid - 1;
  }

  const right = points[clamp(lo, 0, points.length - 1)];
  const left = points[clamp(lo - 1, 0, points.length - 1)];
  const span = right.timestampMs - left.timestampMs;
  if (span <= 0) return left.value;
  const ratio = (targetMs - left.timestampMs) / span;
  return left.value + ratio * (right.value - left.value);
}

export function formatShortUtcAxis(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return '—';
  const d = new Date(epochMs);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${month} ${day}`;
}

export function formatTooltipUtc(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return '—';
  const iso = new Date(epochMs).toISOString();
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z`;
}
