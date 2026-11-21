import { useEffect, useId, useMemo, useRef, type MouseEvent } from 'react';
import { BarChart3 } from 'lucide-react';
import { playbackClock, type PlaybackSnapshot } from '../../store/playbackClock';
import type { AnimalDossier, DailyDistanceBucket } from '../../types/telemetry';
import { clamp, useContainerWidth } from './chartUtils';

export interface DailyDistanceChartProps {
  animal: AnimalDossier;
}

const CHART_HEIGHT = 122;
const PAD = { top: 12, right: 10, bottom: 20, left: 38 };

export function DailyDistanceChart({ animal }: DailyDistanceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const playCursorRef = useRef<SVGGElement | null>(null);
  const hoverCursorRef = useRef<SVGGElement | null>(null);
  const hoverReadoutRef = useRef<HTMLSpanElement | null>(null);

  const rawId = useId();
  const barGradId = `daily-bar-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const width = useContainerWidth(containerRef, 344);
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = Math.max(36, CHART_HEIGHT - PAD.top - PAD.bottom);

  const model = useMemo(() => {
    const series: DailyDistanceBucket[] = [...animal.kinematics.dailyDistanceSeries].sort(
      (a, b) => a.dateIso.localeCompare(b.dateIso),
    );
    if (series.length === 0) return null;

    const maxKm = Math.max(
      1,
      ...series.map((b) => (Number.isFinite(b.distanceKm) ? b.distanceKm : 0)),
    );
    const totalKm = series.reduce(
      (acc, b) => acc + (Number.isFinite(b.distanceKm) ? b.distanceKm : 0),
      0,
    );
    const avgKm = totalKm / Math.max(1, series.length);

    const slotW = plotW / Math.max(1, series.length);
    const barW = clamp(slotW * 0.68, Math.min(3, slotW * 0.85), 24);

    const bars = series.map((bucket, idx) => {
      const safeDist = Number.isFinite(bucket.distanceKm)
        ? Math.max(0, bucket.distanceKm)
        : 0;
      const barH = (safeDist / maxKm) * plotH;
      const clampedBarH = Math.max(1.5, barH);
      const centerX = PAD.left + (idx + 0.5) * slotW;
      const x = centerX - barW / 2;
      const y = PAD.top + plotH - clampedBarH;
      return {
        bucket,
        idx,
        centerX,
        x,
        y,
        width: barW,
        height: clampedBarH,
      };
    });

    const dayIndexByIso = new Map<string, number>();
    series.forEach((b, idx) => dayIndexByIso.set(b.dateIso.slice(0, 10), idx));

    const firstDayMidMsByIso = new Map<string, number>();
    for (const fix of animal.fixes) {
      const day = new Date(fix.timestampMs).toISOString().slice(0, 10);
      if (!firstDayMidMsByIso.has(day)) {
        firstDayMidMsByIso.set(day, fix.timestampMs);
      }
    }

    return {
      series,
      bars,
      maxKm,
      avgKm,
      slotW,
      dayIndexByIso,
      firstDayMidMsByIso,
    };
  }, [animal.kinematics.dailyDistanceSeries, animal.fixes, plotW, plotH]);

  useEffect(() => {
    const updateCursors = (snap: PlaybackSnapshot) => {
      if (!model) return;

      if (playCursorRef.current) {
        const currentDay = new Date(snap.currentMs).toISOString().slice(0, 10);
        const exactIdx = model.dayIndexByIso.get(currentDay);
        let xPos = PAD.left + plotW;
        let inside = false;

        if (exactIdx !== undefined) {
          xPos = model.bars[exactIdx].centerX;
          inside = true;
        } else if (model.bars.length > 0) {
          const firstIso = model.series[0].dateIso.slice(0, 10);
          xPos =
            currentDay < firstIso
              ? model.bars[0].centerX
              : model.bars[model.bars.length - 1].centerX;
        }

        playCursorRef.current.setAttribute(
          'transform',
          `translate(${xPos.toFixed(1)}, 0)`,
        );
        playCursorRef.current.style.opacity = inside ? '1' : '0.28';
      }

      if (hoverCursorRef.current && hoverReadoutRef.current) {
        if (snap.hoveredFixMs !== null) {
          const hoveredDay = new Date(snap.hoveredFixMs).toISOString().slice(0, 10);
          const idx = model.dayIndexByIso.get(hoveredDay);
          if (idx !== undefined) {
            const bar = model.bars[idx];
            hoverCursorRef.current.setAttribute(
              'transform',
              `translate(${bar.centerX.toFixed(1)}, 0)`,
            );
            hoverCursorRef.current.style.opacity = '1';
            hoverReadoutRef.current.textContent = `${bar.bucket.dateIso.slice(5, 10)}: ${bar.bucket.distanceKm.toFixed(1)} km`;
            hoverReadoutRef.current.style.opacity = '1';
            return;
          }
        }
        hoverCursorRef.current.style.opacity = '0';
        hoverReadoutRef.current.textContent = '';
        hoverReadoutRef.current.style.opacity = '0';
      }
    };

    updateCursors(playbackClock.getSnapshot());
    const unsub = playbackClock.subscribeTick((snap) => {
      updateCursors(snap);
    });
    return () => {
      unsub();
    };
  }, [model, plotW]);

  const resolveBarFromPointer = (e: MouseEvent<SVGSVGElement>) => {
    if (!model || !svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const localX = ((e.clientX - rect.left) / rect.width) * width;
    const idx = clamp(
      Math.floor((localX - PAD.left) / Math.max(1, model.slotW)),
      0,
      model.bars.length - 1,
    );
    return model.bars[idx];
  };

  return (
    <div
      ref={containerRef}
      data-testid="chart-daily-distance"
      className="hud-card rounded-xl p-2.5 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <BarChart3 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span className="hud-section-label text-slate-200 truncate">
            Daily Travel Distance
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] tabular-telemetry whitespace-nowrap">
          {model && (
            <span className="text-slate-400">
              AVG <strong className="text-emerald-300">{model.avgKm.toFixed(1)}</strong> km/d
            </span>
          )}
        </div>
      </div>

      {!model ? (
        <div className="flex h-[96px] items-center justify-center rounded-lg border border-dashed border-slate-700/70 bg-obsidian-950/50 text-center px-3">
          <span className="font-mono text-[10.5px] text-slate-400">
            Insufficient Temporal Buckets for Daily Distance
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
              const bar = resolveBarFromPointer(e);
              if (!bar) return;
              const dayMs = model.firstDayMidMsByIso.get(
                bar.bucket.dateIso.slice(0, 10),
              );
              if (dayMs !== undefined) {
                playbackClock.setHoveredFixMs(dayMs);
              }
            }}
            onPointerLeave={() => {
              playbackClock.setHoveredFixMs(null);
            }}
            onClick={(e) => {
              const bar = resolveBarFromPointer(e);
              if (!bar) return;
              const dayMs = model.firstDayMidMsByIso.get(
                bar.bucket.dateIso.slice(0, 10),
              );
              if (dayMs !== undefined) {
                playbackClock.setScrubMs(dayMs);
              }
            }}
          >
            <defs>
              <linearGradient id={barGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.92" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.35" />
              </linearGradient>
            </defs>

            {/* Horizontal Gridlines */}
            {[0, 0.5, 1].map((frac) => {
              const val = model.maxKm * frac;
              const y = PAD.top + (1 - frac) * plotH;
              const label =
                val === 0 ? '0' : model.maxKm < 5 ? val.toFixed(1) : String(Math.round(val));
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
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Bars */}
            {model.bars.map((bar) => (
              <rect
                key={bar.bucket.dateIso}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx="1.5"
                fill={`url(#${barGradId})`}
                stroke="rgba(16, 185, 129, 0.45)"
                strokeWidth="0.6"
              >
                <title>
                  {`${bar.bucket.dateIso}: ${bar.bucket.distanceKm.toFixed(1)} km (${bar.bucket.fixCount} fixes, avg ${bar.bucket.avgSpeedKmh.toFixed(1)} km/h)`}
                </title>
              </rect>
            ))}

            {/* X-Axis Labels */}
            <text
              x={PAD.left}
              y={CHART_HEIGHT - 4}
              textAnchor="start"
              fill="#64748b"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              {model.series[0].dateIso.slice(5, 10)}
            </text>
            <text
              x={PAD.left + plotW / 2}
              y={CHART_HEIGHT - 4}
              textAnchor="middle"
              fill="#475569"
              fontSize="8.5"
              fontFamily="JetBrains Mono, monospace"
            >
              {model.series.length} ACTIVE {model.series.length === 1 ? 'DAY' : 'DAYS'}
            </text>
            <text
              x={PAD.left + plotW}
              y={CHART_HEIGHT - 4}
              textAnchor="end"
              fill="#64748b"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              {model.series[model.series.length - 1].dateIso.slice(5, 10)}
            </text>

            {/* Imperative Hover Crosshair */}
            <g ref={hoverCursorRef} style={{ opacity: 0, pointerEvents: 'none' }}>
              <line
                x1="0"
                y1={PAD.top}
                x2="0"
                y2={PAD.top + plotH}
                stroke="#f59e0b"
                strokeWidth="1.2"
              />
            </g>

            {/* Imperative 60fps Playback Day Cursor */}
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
                strokeWidth="1.2"
                strokeDasharray="3 2"
              />
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}

export default DailyDistanceChart;
