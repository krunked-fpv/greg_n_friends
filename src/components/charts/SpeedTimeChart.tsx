import { useEffect, useId, useMemo, useRef, type MouseEvent } from 'react';
import { Gauge } from 'lucide-react';
import { playbackClock, type PlaybackSnapshot } from '../../store/playbackClock';
import type { AnimalDossier } from '../../types/telemetry';
import {
  clamp,
  findNearestFixByMs,
  formatShortUtcAxis,
  formatTooltipUtc,
  interpolateSeriesValueAtMs,
  useContainerWidth,
  type NumericSeriesPoint,
} from './chartUtils';

export interface SpeedTimeChartProps {
  animal: AnimalDossier;
}

const CHART_HEIGHT = 128;
const PAD = { top: 12, right: 10, bottom: 20, left: 38 };

export function SpeedTimeChart({ animal }: SpeedTimeChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const playCursorRef = useRef<SVGGElement | null>(null);
  const playDotRef = useRef<SVGCircleElement | null>(null);
  const hoverCursorRef = useRef<SVGGElement | null>(null);
  const hoverDotRef = useRef<SVGCircleElement | null>(null);
  const hoverReadoutRef = useRef<HTMLSpanElement | null>(null);

  const rawId = useId();
  const gradId = `speed-grad-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const width = useContainerWidth(containerRef, 344);
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = Math.max(40, CHART_HEIGHT - PAD.top - PAD.bottom);

  const model = useMemo(() => {
    const sorted = [...animal.fixes].sort((a, b) => a.timestampMs - b.timestampMs);
    const points: NumericSeriesPoint[] = [];
    for (const fix of sorted) {
      if (
        !fix.isOutlierSpike &&
        fix.groundSpeedKmh !== null &&
        Number.isFinite(fix.groundSpeedKmh) &&
        fix.groundSpeedKmh >= 0 &&
        Number.isFinite(fix.timestampMs)
      ) {
        points.push({
          timestampMs: fix.timestampMs,
          value: fix.groundSpeedKmh,
          fix,
        });
      }
    }

    if (points.length === 0) {
      return null;
    }

    const minMs = sorted[0].timestampMs;
    const maxMs = sorted[sorted.length - 1].timestampMs;
    const spanMs = Math.max(1, maxMs - minMs);

    const rawMax = Math.max(...points.map((p) => p.value));
    const maxY = Math.max(2, Math.ceil(rawMax * 1.15));
    const avgY =
      points.reduce((acc, p) => acc + p.value, 0) / Math.max(1, points.length);
    const derivedRatio =
      points.filter((p) => p.fix.speedIsDerived).length / points.length;

    const toX = (ms: number) =>
      PAD.left + clamp((ms - minMs) / spanMs, 0, 1) * plotW;
    const toY = (val: number) =>
      PAD.top + (1 - clamp(val / maxY, 0, 1)) * plotH;

    const coords = points.map((p) => ({
      x: toX(p.timestampMs),
      y: toY(p.value),
    }));

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');
    const baseLineY = PAD.top + plotH;
    const areaPath =
      coords.length >= 2
        ? `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${baseLineY.toFixed(1)} L${coords[0].x.toFixed(1)},${baseLineY.toFixed(1)} Z`
        : '';

    return {
      sorted,
      points,
      minMs,
      maxMs,
      spanMs,
      maxY,
      rawMax,
      avgY,
      avgSvgY: toY(avgY),
      derivedRatio,
      linePath,
      areaPath,
      toX,
      toY,
    };
  }, [animal.fixes, plotW, plotH]);

  useEffect(() => {
    const updateImperativeCursors = (snap: PlaybackSnapshot) => {
      if (!model) return;

      // Update 60fps vertical playback cursor
      if (playCursorRef.current && playDotRef.current) {
        const px = model.toX(snap.currentMs);
        const inside =
          snap.currentMs >= model.minMs && snap.currentMs <= model.maxMs;
        playCursorRef.current.setAttribute(
          'transform',
          `translate(${px.toFixed(1)}, 0)`,
        );
        playCursorRef.current.style.opacity = inside ? '1' : '0.28';

        const interpVal = interpolateSeriesValueAtMs(
          model.points,
          clamp(snap.currentMs, model.minMs, model.maxMs),
        );
        const py = model.toY(interpVal ?? 0);
        playDotRef.current.setAttribute('cy', py.toFixed(1));
      }

      // Update cross-chart hover crosshair
      if (hoverCursorRef.current && hoverDotRef.current && hoverReadoutRef.current) {
        if (
          snap.hoveredFixMs !== null &&
          snap.hoveredFixMs >= model.minMs &&
          snap.hoveredFixMs <= model.maxMs
        ) {
          const hoveredFix = findNearestFixByMs(model.sorted, snap.hoveredFixMs);
          const val =
            hoveredFix?.groundSpeedKmh !== null &&
            hoveredFix?.groundSpeedKmh !== undefined &&
            Number.isFinite(hoveredFix.groundSpeedKmh)
              ? hoveredFix.groundSpeedKmh
              : interpolateSeriesValueAtMs(model.points, snap.hoveredFixMs);
          const hx = model.toX(hoveredFix?.timestampMs ?? snap.hoveredFixMs);
          const hy = model.toY(val ?? 0);
          hoverCursorRef.current.setAttribute(
            'transform',
            `translate(${hx.toFixed(1)}, 0)`,
          );
          hoverCursorRef.current.style.opacity = '1';
          hoverDotRef.current.setAttribute('cy', hy.toFixed(1));
          hoverReadoutRef.current.textContent = `${(val ?? 0).toFixed(1)} km/h • ${formatTooltipUtc(hoveredFix?.timestampMs ?? snap.hoveredFixMs)}`;
          hoverReadoutRef.current.style.opacity = '1';
        } else {
          hoverCursorRef.current.style.opacity = '0';
          hoverReadoutRef.current.textContent = '';
          hoverReadoutRef.current.style.opacity = '0';
        }
      }
    };

    updateImperativeCursors(playbackClock.getSnapshot());
    const unsub = playbackClock.subscribeTick((snap) => {
      updateImperativeCursors(snap);
    });
    return () => {
      unsub();
    };
  }, [model]);

  const resolveFixFromPointer = (e: MouseEvent<SVGSVGElement>) => {
    if (!model || !svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const localX = ((e.clientX - rect.left) / rect.width) * width;
    const ratio = clamp((localX - PAD.left) / plotW, 0, 1);
    const targetMs = model.minMs + ratio * model.spanMs;
    return findNearestFixByMs(model.sorted, targetMs);
  };

  return (
    <div
      ref={containerRef}
      data-testid="chart-speed"
      className="hud-card rounded-xl p-2.5 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Gauge className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
          <span className="hud-section-label text-slate-200 truncate">
            Ground Speed Profile
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] tabular-telemetry whitespace-nowrap">
          {model && (
            <span className="text-slate-400">
              MAX <strong className="text-cyan-200">{model.rawMax.toFixed(1)}</strong> km/h
            </span>
          )}
        </div>
      </div>

      {!model ? (
        <div className="flex h-[108px] items-center justify-center rounded-lg border border-dashed border-slate-700/70 bg-obsidian-950/50 text-center px-3">
          <span className="font-mono text-[10.5px] text-slate-400">
            Ground Speed Telemetry Unavailable for Track
          </span>
        </div>
      ) : (
        <div className="relative">
          <span
            ref={hoverReadoutRef}
            style={{ opacity: 0 }}
            className="pointer-events-none absolute top-0.5 right-1 z-10 rounded border border-amber-400/40 bg-obsidian-950/90 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-amber-300 tabular-telemetry shadow-md backdrop-blur-sm whitespace-nowrap"
          />
          <svg
            ref={svgRef}
            width={width}
            height={CHART_HEIGHT}
            viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
            className="w-full h-auto cursor-crosshair select-none overflow-visible"
            onPointerMove={(e) => {
              const fix = resolveFixFromPointer(e);
              if (fix) playbackClock.setHoveredFixMs(fix.timestampMs);
            }}
            onPointerLeave={() => {
              playbackClock.setHoveredFixMs(null);
            }}
            onClick={(e) => {
              const fix = resolveFixFromPointer(e);
              if (fix) playbackClock.setScrubMs(fix.timestampMs);
            }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.42" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Horizontal Y Gridlines & Labels */}
            {[0, 0.5, 1].map((frac) => {
              const val = model.maxY * frac;
              const y = model.toY(val);
              return (
                <g key={frac}>
                  <line
                    x1={PAD.left}
                    y1={y}
                    x2={PAD.left + plotW}
                    y2={y}
                    stroke="rgba(148, 163, 184, 0.14)"
                    strokeWidth="1"
                  />
                  <text
                    x={PAD.left - 5}
                    y={y + 3}
                    textAnchor="end"
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {Math.round(val)}
                  </text>
                </g>
              );
            })}

            {/* Average Speed Reference Line */}
            <line
              x1={PAD.left}
              y1={model.avgSvgY}
              x2={PAD.left + plotW}
              y2={model.avgSvgY}
              stroke="rgba(16, 185, 129, 0.48)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />

            {/* Speed Area & Curve */}
            {model.areaPath && <path d={model.areaPath} fill={`url(#${gradId})`} />}
            {model.points.length === 1 ? (
              <circle
                cx={model.toX(model.points[0].timestampMs)}
                cy={model.toY(model.points[0].value)}
                r="3"
                fill="#22d3ee"
              />
            ) : (
              <path
                d={model.linePath}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="1.65"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {/* X-Axis Timestamps */}
            <text
              x={PAD.left}
              y={CHART_HEIGHT - 4}
              textAnchor="start"
              fill="#64748b"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              {formatShortUtcAxis(model.minMs)}
            </text>
            <text
              x={PAD.left + plotW / 2}
              y={CHART_HEIGHT - 4}
              textAnchor="middle"
              fill="#475569"
              fontSize="8.5"
              fontFamily="JetBrains Mono, monospace"
            >
              {plotW < 220
                ? model.derivedRatio > 0.5
                  ? 'DERIVED'
                  : 'GPS / DOPPLER'
                : model.derivedRatio > 0.5
                  ? 'DERIVED VELOCITY'
                  : 'DOPPLER / GPS VELOCITY'}
            </text>
            <text
              x={PAD.left + plotW}
              y={CHART_HEIGHT - 4}
              textAnchor="end"
              fill="#64748b"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              {formatShortUtcAxis(model.maxMs)}
            </text>

            {/* Imperative Hover Crosshair */}
            <g ref={hoverCursorRef} style={{ opacity: 0, pointerEvents: 'none' }}>
              <line
                x1="0"
                y1={PAD.top}
                x2="0"
                y2={PAD.top + plotH}
                stroke="#f59e0b"
                strokeWidth="1"
              />
              <circle
                ref={hoverDotRef}
                cx="0"
                cy={PAD.top}
                r="3.2"
                fill="#f59e0b"
                stroke="#04070d"
                strokeWidth="1"
              />
            </g>

            {/* Imperative 60fps Playback Cursor */}
            <g ref={playCursorRef} style={{ opacity: 0, pointerEvents: 'none' }}>
              <polygon
                points="-3.5,0 3.5,0 0,4.5"
                transform={`translate(0, ${PAD.top - 2})`}
                fill="#22d3ee"
              />
              <line
                x1="0"
                y1={PAD.top}
                x2="0"
                y2={PAD.top + plotH}
                stroke="#22d3ee"
                strokeWidth="1.25"
                strokeDasharray="3 2"
              />
              <circle
                ref={playDotRef}
                cx="0"
                cy={PAD.top}
                r="3.4"
                fill="#22d3ee"
                stroke="#04070d"
                strokeWidth="1.2"
              />
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}

export default SpeedTimeChart;
