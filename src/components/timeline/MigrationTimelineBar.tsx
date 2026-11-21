import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react';
import {
  Crosshair,
  Pause,
  Play,
  Radio,
  Users,
  User,
} from 'lucide-react';
import {
  playbackClock,
  usePlaybackControls,
  type PlaybackSpeedMultiplier,
} from '../../store/playbackClock';
import {
  selectFilteredAnimals,
  useTelemetryStore,
} from '../../store/telemetryStore';

const SPEED_OPTIONS: readonly PlaybackSpeedMultiplier[] = [1, 10, 50, 250];
const HISTOGRAM_BUCKETS = 64;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MIN_WINDOW_SPAN_MS = 60_000;

function formatUtcReadout(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return '---- -- -- --:--:-- UTC';
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '---- -- -- --:--:-- UTC';
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatCompactUtcDate(epochMs: number, includeYear = false): string {
  if (!Number.isFinite(epochMs)) return '--';
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '--';
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  if (includeYear) {
    return `${d.getUTCFullYear()} ${month} ${day} ${hh}:${mm}Z`;
  }
  return `${month} ${day} ${hh}:${mm}Z`;
}

export function MigrationTimelineBar() {
  const controls = usePlaybackControls();
  const animals = useTelemetryStore(selectFilteredAnimals);
  const allAnimals = useTelemetryStore((s) => s.animals);
  const selectedAnimalId = useTelemetryStore((s) => s.selectedAnimalId);
  const leftDrawerOpen = useTelemetryStore((s) => s.leftDrawerOpen);
  const rightDrawerOpen = useTelemetryStore((s) => s.rightDrawerOpen);

  const scrubberTrackRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const hoverMarkerRef = useRef<HTMLDivElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);
  const isDraggingRef = useRef(false);

  const totalSpanMs = Math.max(MIN_WINDOW_SPAN_MS, controls.maxMs - controls.minMs);
  const windowSpanMs = Math.max(
    MIN_WINDOW_SPAN_MS,
    controls.windowEndMs - controls.windowStartMs,
  );

  // Sync imperative DOM refs whenever window bounds or tick updates occur
  const applyTickToDom = useCallback(
    (
      currentMs: number,
      windowStartMs: number,
      windowEndMs: number,
      hoveredFixMs: number | null,
    ) => {
      const span = Math.max(MIN_WINDOW_SPAN_MS, windowEndMs - windowStartMs);
      const pct = Math.max(
        0,
        Math.min(100, ((currentMs - windowStartMs) / span) * 100),
      );
      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${pct}%`;
      }
      if (thumbRef.current) {
        thumbRef.current.style.left = `${pct}%`;
      }
      if (timeTextRef.current) {
        timeTextRef.current.textContent = formatUtcReadout(currentMs);
      }
      if (hoverMarkerRef.current) {
        if (
          hoveredFixMs !== null &&
          hoveredFixMs >= windowStartMs &&
          hoveredFixMs <= windowEndMs
        ) {
          const hoverPct = Math.max(
            0,
            Math.min(100, ((hoveredFixMs - windowStartMs) / span) * 100),
          );
          hoverMarkerRef.current.style.left = `${hoverPct}%`;
          hoverMarkerRef.current.style.opacity = '1';
        } else {
          hoverMarkerRef.current.style.opacity = '0';
        }
      }
    },
    [],
  );

  useEffect(() => {
    const snap = playbackClock.getSnapshot();
    applyTickToDom(
      snap.currentMs,
      snap.windowStartMs,
      snap.windowEndMs,
      snap.hoveredFixMs,
    );
    return playbackClock.subscribeTick((nextSnap) => {
      applyTickToDom(
        nextSnap.currentMs,
        nextSnap.windowStartMs,
        nextSnap.windowEndMs,
        nextSnap.hoveredFixMs,
      );
    });
  }, [applyTickToDom]);

  useEffect(() => {
    const snap = playbackClock.getSnapshot();
    applyTickToDom(
      snap.currentMs,
      controls.windowStartMs,
      controls.windowEndMs,
      snap.hoveredFixMs,
    );
  }, [controls.windowStartMs, controls.windowEndMs, applyTickToDom]);

  // Compute SVG ping-density histogram bins across the active window
  const histogramBars = useMemo(() => {
    const counts = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
    const activeSet =
      controls.syncMode === 'SOLO_ANIMAL' && selectedAnimalId
        ? animals.filter((a) => a.id === selectedAnimalId)
        : animals;

    for (const animal of activeSet) {
      for (const fix of animal.fixes) {
        if (
          fix.timestampMs >= controls.windowStartMs &&
          fix.timestampMs <= controls.windowEndMs
        ) {
          const ratio =
            (fix.timestampMs - controls.windowStartMs) / windowSpanMs;
          const idx = Math.max(
            0,
            Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(ratio * HISTOGRAM_BUCKETS)),
          );
          counts[idx] += 1;
        }
      }
    }

    const maxCount = Math.max(1, ...counts);
    return counts.map((count) => ({
      count,
      heightRatio: count === 0 ? 0.08 : 0.16 + 0.84 * (count / maxCount),
    }));
  }, [
    animals,
    selectedAnimalId,
    controls.syncMode,
    controls.windowStartMs,
    controls.windowEndMs,
    windowSpanMs,
  ]);

  const scrubFromClientX = useCallback((clientX: number) => {
    const el = scrubberTrackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const snap = playbackClock.getSnapshot();
    const span = Math.max(MIN_WINDOW_SPAN_MS, snap.windowEndMs - snap.windowStartMs);
    playbackClock.setScrubMs(snap.windowStartMs + ratio * span);
  }, []);

  const handleScrubberPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubFromClientX(e.clientX);
  };

  const handleScrubberPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    scrubFromClientX(e.clientX);
  };

  const handleScrubberPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const selectedAnimal = useMemo(() => {
    if (!selectedAnimalId) return null;
    return (
      animals.find((a) => a.id === selectedAnimalId) ??
      allAnimals.find((a) => a.id === selectedAnimalId) ??
      null
    );
  }, [animals, allAnimals, selectedAnimalId]);

  const selectedTrackBounds = useMemo(() => {
    if (!selectedAnimal) return null;
    let firstFixMs = Infinity;
    let lastFixMs = -Infinity;
    for (const fix of selectedAnimal.fixes) {
      if (Number.isFinite(fix.timestampMs)) {
        if (fix.timestampMs < firstFixMs) firstFixMs = fix.timestampMs;
        if (fix.timestampMs > lastFixMs) lastFixMs = fix.timestampMs;
      }
    }
    if (!Number.isFinite(firstFixMs) || !Number.isFinite(lastFixMs)) return null;
    return { firstFixMs, lastFixMs };
  }, [selectedAnimal]);

  const startSliderVal = Math.round(
    ((controls.windowStartMs - controls.minMs) / totalSpanMs) * 1000,
  );
  const endSliderVal = Math.round(
    ((controls.windowEndMs - controls.minMs) / totalSpanMs) * 1000,
  );

  const includeYear = totalSpanMs > 180 * DAY_MS;

  const isFullSpan =
    Math.abs(controls.windowStartMs - controls.minMs) <= 60_000 &&
    Math.abs(controls.windowEndMs - controls.maxMs) <= 60_000;
  const target14d = Math.max(controls.minMs, controls.maxMs - 14 * DAY_MS);
  const is14d =
    !isFullSpan &&
    Math.abs(controls.windowEndMs - controls.maxMs) <= 120_000 &&
    Math.abs(controls.windowStartMs - target14d) <= 120_000;
  const target72h = Math.max(controls.minMs, controls.maxMs - 72 * HOUR_MS);
  const is72h =
    !isFullSpan &&
    Math.abs(controls.windowEndMs - controls.maxMs) <= 120_000 &&
    Math.abs(controls.windowStartMs - target72h) <= 120_000;
  const isSelectedTrackSpan =
    !isFullSpan &&
    selectedTrackBounds !== null &&
    Math.abs(controls.windowStartMs - selectedTrackBounds.firstFixMs) <= 120_000 &&
    Math.abs(controls.windowEndMs - selectedTrackBounds.lastFixMs) <= 120_000;

  return (
    <div
      className={`pointer-events-none fixed bottom-3 left-0 right-0 z-30 flex justify-center px-3 transition-all duration-300 ${
        leftDrawerOpen ? 'lg:pl-[336px]' : 'lg:pl-4'
      } ${rightDrawerOpen ? 'lg:pr-[400px]' : 'lg:pr-4'}`}
    >
      <section
        data-testid="migration-timeline-bar"
        className="pointer-events-auto w-full max-w-[860px] rounded-2xl hud-glass-elevated px-3.5 py-2.5 text-slate-100"
      >
        {/* Row 1: Play/Pause + SVG Histogram Scrubber + Imperative UTC Readout */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-testid="timeline-play-btn"
            onClick={() => playbackClock.togglePlay()}
            aria-label={controls.isPlaying ? 'Pause Playback' : 'Play Playback'}
            title="Play / Pause Migration Playback (Space)"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition ${
              controls.isPlaying
                ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                : 'border-cyan-400/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
            }`}
          >
            {controls.isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 translate-x-[1px]" />
            )}
          </button>

          {/* Interactive SVG Ping-Density Histogram + Imperative Scrubber */}
          <div
            ref={scrubberTrackRef}
            data-testid="timeline-scrubber"
            role="slider"
            tabIndex={0}
            aria-label="Migration Timeline Scrubber"
            aria-valuemin={controls.windowStartMs}
            aria-valuemax={controls.windowEndMs}
            aria-valuenow={controls.currentMs}
            onPointerDown={handleScrubberPointerDown}
            onPointerMove={handleScrubberPointerMove}
            onPointerUp={handleScrubberPointerUp}
            onKeyDown={(e) => {
              const step = e.shiftKey ? windowSpanMs * 0.05 : windowSpanMs * 0.01;
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                playbackClock.setScrubMs(
                  playbackClock.getSnapshot().currentMs + step,
                );
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                playbackClock.setScrubMs(
                  playbackClock.getSnapshot().currentMs - step,
                );
              }
            }}
            className="relative h-8 min-w-[140px] flex-1 cursor-pointer select-none overflow-hidden rounded-lg border border-slate-700/70 bg-obsidian-900/90 focus:outline-none focus:ring-1 focus:ring-cyan-400/60"
          >
            <svg
              data-testid="timeline-histogram"
              viewBox={`0 0 ${HISTOGRAM_BUCKETS * 10} 32`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              {histogramBars.map((bar, idx) => {
                const h = Math.max(2, bar.heightRatio * 26);
                return (
                  <rect
                    key={idx}
                    x={idx * 10 + 1.5}
                    y={32 - h}
                    width={7}
                    height={h}
                    rx={1.5}
                    fill={bar.count > 0 ? '#22d3ee' : '#1e293b'}
                    fillOpacity={bar.count > 0 ? 0.22 + bar.heightRatio * 0.35 : 0.35}
                  />
                );
              })}
            </svg>

            {/* Elapsed progress tint */}
            <div
              ref={progressBarRef}
              className="pointer-events-none absolute inset-y-0 left-0 border-r border-cyan-300/80 bg-cyan-400/12"
              style={{ width: '100%' }}
            />

            {/* Crosshair marker synced from hovered map/chart fix */}
            <div
              ref={hoverMarkerRef}
              className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.9)]"
              style={{ left: '0%', opacity: 0 }}
            />

            {/* Imperative playhead thumb */}
            <div
              ref={thumbRef}
              className="pointer-events-none absolute top-1/2 h-6 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white/90 bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.85)]"
              style={{ left: '100%' }}
            />
          </div>

          <div className="shrink-0 rounded-lg border border-slate-700/70 bg-obsidian-900/90 px-2 py-1 text-right">
            <div className="flex items-center justify-end gap-1 text-[9px] uppercase tracking-wider text-slate-400">
              <Radio className="h-2.5 w-2.5 text-cyan-400" />
              <span>Clock</span>
            </div>
            <span
              ref={timeTextRef}
              data-testid="timeline-current-time"
              className="block font-mono text-[11px] font-medium tabular-nums text-cyan-200"
            >
              {formatUtcReadout(controls.currentMs)}
            </span>
          </div>
        </div>

        {/* Row 2: Speed Multiplier + Window Presets + Sync Mode + Follow Cam */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
          <div className="flex items-center gap-1">
            {SPEED_OPTIONS.map((spd) => {
              const active = controls.speedMultiplier === spd;
              return (
                <button
                  key={spd}
                  type="button"
                  data-testid={`timeline-speed-${spd}`}
                  onClick={() => playbackClock.setSpeedMultiplier(spd)}
                  className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums transition ${
                    active
                      ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                      : 'border-slate-700/70 bg-obsidian-900/70 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                  }`}
                >
                  {spd}x
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="timeline-window-full"
              onClick={() =>
                playbackClock.setWindowRange(controls.minMs, controls.maxMs)
              }
              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                isFullSpan
                  ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-700/70 bg-obsidian-900/70 text-slate-400 hover:text-slate-200'
              }`}
            >
              Full Span
            </button>
            <button
              type="button"
              data-testid="timeline-window-14d"
              onClick={() =>
                playbackClock.setWindowRange(target14d, controls.maxMs)
              }
              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                is14d
                  ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-700/70 bg-obsidian-900/70 text-slate-400 hover:text-slate-200'
              }`}
            >
              Last 14d
            </button>
            <button
              type="button"
              data-testid="timeline-window-72h"
              onClick={() =>
                playbackClock.setWindowRange(target72h, controls.maxMs)
              }
              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                is72h
                  ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-700/70 bg-obsidian-900/70 text-slate-400 hover:text-slate-200'
              }`}
            >
              Last 72h
            </button>
            <button
              type="button"
              data-testid="timeline-window-selected"
              disabled={!selectedTrackBounds}
              onClick={() => {
                if (!selectedTrackBounds) return;
                playbackClock.setWindowRange(
                  selectedTrackBounds.firstFixMs,
                  selectedTrackBounds.lastFixMs,
                );
                playbackClock.setScrubMs(selectedTrackBounds.lastFixMs);
              }}
              title={
                selectedAnimal
                  ? `Snap timeline to ${selectedAnimal.nickname}'s deployment window`
                  : 'Select an animal to snap timeline to its deployment window'
              }
              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                isSelectedTrackSpan
                  ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-700/70 bg-obsidian-900/70 text-slate-400 hover:text-slate-200'
              }`}
            >
              Selected Track
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="timeline-sync-btn"
              onClick={() =>
                playbackClock.setSyncMode(
                  controls.syncMode === 'FLEET_SYNC'
                    ? 'SOLO_ANIMAL'
                    : 'FLEET_SYNC',
                )
              }
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                controls.syncMode === 'SOLO_ANIMAL'
                  ? 'border-violet-400/60 bg-violet-500/20 text-violet-200'
                  : 'border-slate-700/70 bg-obsidian-900/70 text-slate-300 hover:border-slate-600'
              }`}
            >
              {controls.syncMode === 'SOLO_ANIMAL' ? (
                <>
                  <User className="h-3 w-3" />
                  <span>Solo Animal</span>
                </>
              ) : (
                <>
                  <Users className="h-3 w-3" />
                  <span>Fleet Sync</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="follow-cam-btn"
              onClick={() => playbackClock.toggleFollowCam()}
              title="Toggle Follow Cam (F)"
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                controls.followCam
                  ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                  : 'border-slate-700/70 bg-obsidian-900/70 text-slate-300 hover:border-slate-600'
              }`}
            >
              <Crosshair className="h-3 w-3" />
              <span>Follow Cam</span>
            </button>
          </div>
        </div>

        {/* Row 3: Dual Date-Range Window Sliders */}
        <div className="mt-1.5 flex items-center gap-2 border-t border-slate-800/80 pt-1.5 text-[10px]">
          <span className="shrink-0 font-mono tabular-nums text-slate-400">
            {formatCompactUtcDate(controls.windowStartMs, includeYear)}
          </span>
          <div className="flex flex-1 items-center gap-2">
            <input
              data-testid="timeline-range-start"
              type="range"
              min={0}
              max={1000}
              value={startSliderVal}
              aria-label="Window Start Date"
              onChange={(e) => {
                const val = Number(e.target.value);
                const nextStart = controls.minMs + (val / 1000) * totalSpanMs;
                const safeStart = Math.min(
                  nextStart,
                  controls.windowEndMs - MIN_WINDOW_SPAN_MS,
                );
                playbackClock.setWindowRange(safeStart, controls.windowEndMs);
              }}
              className="h-1 w-full cursor-pointer accent-cyan-400"
            />
            <input
              data-testid="timeline-range-end"
              type="range"
              min={0}
              max={1000}
              value={endSliderVal}
              aria-label="Window End Date"
              onChange={(e) => {
                const val = Number(e.target.value);
                const nextEnd = controls.minMs + (val / 1000) * totalSpanMs;
                const safeEnd = Math.max(
                  nextEnd,
                  controls.windowStartMs + MIN_WINDOW_SPAN_MS,
                );
                playbackClock.setWindowRange(controls.windowStartMs, safeEnd);
              }}
              className="h-1 w-full cursor-pointer accent-emerald-400"
            />
          </div>
          <span className="shrink-0 font-mono tabular-nums text-slate-400">
            {formatCompactUtcDate(controls.windowEndMs, includeYear)}
          </span>
        </div>
      </section>
    </div>
  );
}

export default MigrationTimelineBar;
