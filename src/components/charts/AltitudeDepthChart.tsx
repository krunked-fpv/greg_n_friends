import { useEffect, useId, useMemo, useRef, type MouseEvent } from 'react';
import { Mountain, Waves } from 'lucide-react';
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

export interface AltitudeDepthChartProps {
  animal: AnimalDossier;
}

const CHART_HEIGHT = 136;
const PAD = { top: 12, right: 10, bottom: 20, left: 44 };

export function AltitudeDepthChart({ animal }: AltitudeDepthChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const playCursorRef = useRef<SVGGElement | null>(null);
  const playDotRef = useRef<SVGCircleElement | null>(null);
  const hoverCursorRef = useRef<SVGGElement | null>(null);
  const hoverDotRef = useRef<SVGCircleElement | null>(null);
  const hoverReadoutRef = useRef<HTMLSpanElement | null>(null);

  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const skyGradId = `alt-sky-${uid}`;
  const bathyalGradId = `alt-bathyal-${uid}`;
  const aboveClipId = `alt-above-clip-${uid}`;
  const belowClipId = `alt-below-clip-${uid}`;

  const width = useContainerWidth(containerRef, 344);
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = Math.max(40, CHART_HEIGHT - PAD.top - PAD.bottom);

  const model = useMemo(() => {
    const sorted = [...animal.fixes].sort((a, b) => a.timestampMs - b.timestampMs);
    const points: NumericSeriesPoint[] = [];

    for (const fix of sorted) {
      if (
        !fix.isOutlierSpike &&
        fix.altitudeOrDepthMeters !== null &&
        Number.isFinite(fix.altitudeOrDepthMeters) &&
        Number.isFinite(fix.timestampMs)
      ) {
        points.push({
          timestampMs: fix.timestampMs,
          value: fix.altitudeOrDepthMeters,
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

    const vals = points.map((p) => p.value);
    const dataMin = Math.min(...vals);
    const dataMax = Math.max(...vals);

    // Anchor 0m surface baseline cleanly inside domain
    let domainMin = Math.min(0, dataMin);
    let domainMax = Math.max(0, dataMax);

    if (domainMax > 0) domainMax = domainMax * 1.12;
    if (domainMin < 0) domainMin = domainMin * 1.12;

    if (domainMax - domainMin < 10) {
      domainMax += 10;
      domainMin -= 10;
    }

    const domainSpan = Math.max(1, domainMax - domainMin);
    const toX = (ms: number) =>
      PAD.left + clamp((ms - minMs) / spanMs, 0, 1) * plotW;
    const toY = (meters: number) =>
      PAD.top + (1 - clamp((meters - domainMin) / domainSpan, 0, 1)) * plotH;

    const zeroY = toY(0);
    const coords = points.map((p) => ({
      x: toX(p.timestampMs),
      y: toY(p.value),
    }));

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');

    const areaPath =
      coords.length >= 2
        ? `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${zeroY.toFixed(1)} L${coords[0].x.toFixed(1)},${zeroY.toFixed(1)} Z`
        : '';

    const yTicks = Array.from(
      new Set([Math.round(domainMax), 0, Math.round(domainMin)]),
    );

    return {
      sorted,
      points,
      minMs,
      maxMs,
      spanMs,
      dataMin,
      dataMax,
      zeroY,
      yTicks,
      linePath,
      areaPath,
      toX,
      toY,
    };
  }, [animal.fixes, plotW, plotH]);

  useEffect(() => {
    const updateImperativeCursors = (snap: PlaybackSnapshot) => {
      if (!model) return;

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

      if (hoverCursorRef.current && hoverDotRef.current && hoverReadoutRef.current) {
        if (
          snap.hoveredFixMs !== null &&
          snap.hoveredFixMs >= model.minMs &&
          snap.hoveredFixMs <= model.maxMs
        ) {
          const hoveredFix = findNearestFixByMs(model.sorted, snap.hoveredFixMs);
          const val =
            hoveredFix?.altitudeOrDepthMeters !== null &&
            hoveredFix?.altitudeOrDepthMeters !== undefined &&
            Number.isFinite(hoveredFix.altitudeOrDepthMeters)
              ? hoveredFix.altitudeOrDepthMeters
              : interpolateSeriesValueAtMs(model.points, snap.hoveredFixMs);
          const hx = model.toX(hoveredFix?.timestampMs ?? snap.hoveredFixMs);
          const hy = model.toY(val ?? 0);
          hoverCursorRef.current.setAttribute(
            'transform',
            `translate(${hx.toFixed(1)}, 0)`,
          );
          hoverCursorRef.current.style.opacity = '1';
          hoverDotRef.current.setAttribute('cy', hy.toFixed(1));
          const safeVal = Math.round(val ?? 0);
          const prefix = safeVal > 0 ? '+' : '';
          hoverReadoutRef.current.textContent = `${prefix}${safeVal} m • ${formatTooltipUtc(hoveredFix?.timestampMs ?? snap.hoveredFixMs)}`;
        } else {
          hoverCursorRef.current.style.opacity = '0';
          hoverReadoutRef.current.textContent = '';
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

  const hasDive = (model?.dataMin ?? 0) < 0;
  const hasAlt = (model?.dataMax ?? 0) > 0;

  return (
    <div
      ref={containerRef}
      data-testid="chart-altitude-depth"
      className="hud-card rounded-xl p-2.5 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {hasDive && !hasAlt ? (
            <Waves className="h-3.5 w-3.5 text-sky-400" />
          ) : (
            <Mountain className="h-3.5 w-3.5 text-amber-300" />
          )}
          <span className="hud-section-label text-slate-200">
            Altitude / Ocean Depth
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px] tabular-telemetry">
          <span
            ref={hoverReadoutRef}
            className="text-amber-300 font-medium truncate max-w-[135px]"
          />
          {model ? (
            <span className="text-slate-400">
              {hasAlt && (
                <span>
                  PEAK{' '}
                  <strong className="text-amber-200">
                    +{Math.round(model.dataMax).toLocaleString('en-US')}m
                  </strong>
                </span>
              )}
              {hasAlt && hasDive && <span className="mx-1 text-slate-600">/</span>}
              {hasDive && (
                <span>
                  DIVE{' '}
                  <strong className="text-sky-300">
                    {Math.round(model.dataMin).toLocaleString('en-US')}m
                  </strong>
                </span>
              )}
              {!hasAlt && !hasDive && (
                <strong className="text-cyan-200">0 m MSL</strong>
              )}
            </span>
          ) : (
            <span className="text-slate-500">2D TAG</span>
          )}
        </div>
      </div>

      {!model ? (
        <div className="relative rounded-lg border border-slate-700/60 bg-obsidian-950/60 overflow-hidden">
          <svg
            width={width}
            height={104}
            viewBox={`0 0 ${width} 104`}
            className="w-full h-auto block"
            aria-label="Barometric or depth sensor inactive surface baseline"
          >
            <rect
              x={PAD.left}
              y={10}
              width={plotW}
              height={42}
              fill="rgba(245, 158, 11, 0.04)"
            />
            <rect
              x={PAD.left}
              y={52}
              width={plotW}
              height={40}
              fill="rgba(14, 165, 233, 0.06)"
            />
            <line
              x1={PAD.left}
              y1={52}
              x2={PAD.left + plotW}
              y2={52}
              stroke="rgba(34, 211, 238, 0.45)"
              strokeWidth="1.2"
              strokeDasharray="4 3"
            />
            <text
              x={PAD.left - 5}
              y={55}
              textAnchor="end"
              fill="#64748b"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              0m
            </text>
            <text
              x={PAD.left + plotW / 2}
              y={44}
              textAnchor="middle"
              fill="#cbd5e1"
              fontSize="10"
              fontWeight="600"
              fontFamily="JetBrains Mono, monospace"
            >
              Barometric / Depth Sensor Inactive on Tag
            </text>
            <text
              x={PAD.left + plotW / 2}
              y={69}
              textAnchor="middle"
              fill="#64748b"
              fontSize="8.5"
              fontFamily="JetBrains Mono, monospace"
            >
              SURFACE BASELINE REFERENCE (0m MSL)
            </text>
          </svg>
        </div>
      ) : (
        <div className="relative">
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
              {/* Cyan-gold sky / ridge fill above 0m */}
              <linearGradient id={skyGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.62" />
                <stop offset="55%" stopColor="#22d3ee" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.06" />
              </linearGradient>

              {/* Bathyal ocean gradient below 0m */}
              <linearGradient id={bathyalGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.18" />
                <stop offset="50%" stopColor="#0284c7" stopOpacity="0.48" />
                <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0.72" />
              </linearGradient>

              <clipPath id={aboveClipId}>
                <rect
                  x={PAD.left}
                  y={PAD.top}
                  width={plotW}
                  height={Math.max(0, model.zeroY - PAD.top)}
                />
              </clipPath>

              <clipPath id={belowClipId}>
                <rect
                  x={PAD.left}
                  y={model.zeroY}
                  width={plotW}
                  height={Math.max(0, PAD.top + plotH - model.zeroY)}
                />
              </clipPath>
            </defs>

            {/* Horizontal Y ticks */}
            {model.yTicks.map((val) => {
              const y = model.toY(val);
              const isZero = val === 0;
              return (
                <g key={val}>
                  <line
                    x1={PAD.left}
                    y1={y}
                    x2={PAD.left + plotW}
                    y2={y}
                    stroke={
                      isZero
                        ? 'rgba(34, 211, 238, 0.45)'
                        : 'rgba(148, 163, 184, 0.14)'
                    }
                    strokeWidth={isZero ? '1.1' : '1'}
                    strokeDasharray={isZero ? '4 2.5' : undefined}
                  />
                  <text
                    x={PAD.left - 5}
                    y={y + 3}
                    textAnchor="end"
                    fill={isZero ? '#67e8f9' : '#64748b'}
                    fontSize="8.5"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {val > 0 ? `+${val}m` : `${val}m`}
                  </text>
                </g>
              );
            })}

            {/* Dual-clipped fills above 0m (cyan-gold) and below 0m (bathyal ocean) */}
            {model.areaPath && (
              <>
                <path
                  d={model.areaPath}
                  fill={`url(#${skyGradId})`}
                  clipPath={`url(#${aboveClipId})`}
                />
                <path
                  d={model.areaPath}
                  fill={`url(#${bathyalGradId})`}
                  clipPath={`url(#${belowClipId})`}
                />
              </>
            )}

            {/* Clipped strokes for high contrast above & below 0m */}
            <path
              d={model.linePath}
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1.65"
              strokeLinejoin="round"
              strokeLinecap="round"
              clipPath={`url(#${aboveClipId})`}
            />
            <path
              d={model.linePath}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.65"
              strokeLinejoin="round"
              strokeLinecap="round"
              clipPath={`url(#${belowClipId})`}
            />

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
              0m MSL HORIZON
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

export default AltitudeDepthChart;
