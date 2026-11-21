import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Compass,
  Layers,
  Palette,
  Radio,
  Route,
  Wifi,
} from 'lucide-react';
import { useTelemetryStore } from '../../store/telemetryStore';
import type { BasemapId, ConnectionMode, TrackColorMode } from '../../types/telemetry';
import { getRecencyTier } from './telemetryBadges';

const BASEMAP_OPTIONS: Array<{
  id: BasemapId;
  label: string;
  hotkey: string;
  title: string;
}> = [
  { id: 'dark-tactical', label: 'Dark', hotkey: '1', title: 'Dark Tactical Vector/Raster (Key 1)' },
  { id: 'satellite', label: 'Satellite', hotkey: '2', title: 'High-Res Satellite Imagery (Key 2)' },
  { id: 'terrain', label: 'Terrain', hotkey: '3', title: 'Topographic Terrain Relief (Key 3)' },
  { id: 'ocean', label: 'Ocean', hotkey: '4', title: 'Ocean Bathymetry Chart (Key 4)' },
];

const TRACK_COLOR_OPTIONS: Array<{
  id: TrackColorMode;
  label: string;
  title: string;
}> = [
  { id: 'speed', label: 'Speed', title: 'Color trajectories by ground speed (km/h)' },
  { id: 'altitude', label: 'Alt / Depth', title: 'Color trajectories by altitude (+) / ocean depth (-)' },
  { id: 'recency', label: 'Recency', title: 'Color trajectories by temporal recency gradient' },
  { id: 'animal', label: 'Animal', title: 'Color trajectories by individual signature color' },
];

const CONNECTION_MODE_META: Record<
  ConnectionMode,
  { label: string; badgeClass: string; dotClass: string; description: string }
> = {
  PROXY_LIVE: {
    label: 'PROXY LIVE',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/45',
    dotClass: 'bg-emerald-400 animate-beacon-dot',
    description: 'Connected to local Express telemetry proxy with Movebank & ATN ERDDAP',
  },
  CI_SNAPSHOT: {
    label: 'CI SNAPSHOT',
    badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/45',
    dotClass: 'bg-cyan-400',
    description: 'Static bundle hydrated from scheduled CI telemetry harvest + browser CORS APIs',
  },
  STATIC_DECK: {
    label: 'STATIC DECK',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-400/40',
    dotClass: 'bg-violet-400',
    description: 'Standalone client-side command deck (browser CORS feeds + reference archive)',
  },
};

function formatUtcClock(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export interface TopCommandBarProps {
  className?: string;
}

export function TopCommandBar({ className = '' }: TopCommandBarProps) {
  const animals = useTelemetryStore((s) => s.animals);
  const connectionMode = useTelemetryStore((s) => s.connectionMode);
  const proxyHealth = useTelemetryStore((s) => s.proxyHealth);
  const basemap = useTelemetryStore((s) => s.basemap);
  const trackColorMode = useTelemetryStore((s) => s.trackColorMode);
  const setBasemap = useTelemetryStore((s) => s.setBasemap);
  const setTrackColorMode = useTelemetryStore((s) => s.setTrackColorMode);

  const [utcNow, setUtcNow] = useState<string>(() => formatUtcClock(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUtcNow(formatUtcClock(new Date()));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const fleetStats = useMemo(() => {
    let totalDistanceKm = 0;
    let active24hCount = 0;
    for (const animal of animals) {
      if (Number.isFinite(animal.kinematics.totalDistanceKm)) {
        totalDistanceKm += animal.kinematics.totalDistanceKm;
      }
      if (getRecencyTier(animal.kinematics.pingFreshnessMs) === 'ACTIVE_24H') {
        active24hCount += 1;
      }
    }
    return {
      totalIndividuals: animals.length,
      active24hCount,
      totalDistanceKm: Math.round(totalDistanceKm),
    };
  }, [animals]);

  const connMeta = CONNECTION_MODE_META[connectionMode];

  return (
    <header
      className={`pointer-events-auto fixed top-2.5 left-2.5 right-2.5 z-30 hud-glass rounded-xl px-2.5 py-1.5 ${className}`}
      role="banner"
    >
      <div className="flex flex-wrap xl:flex-nowrap items-center justify-between gap-1.5">
        {/* Brand & Operator Header */}
        <div className="flex items-center gap-2 min-w-0 flex-1 xl:flex-initial">
          <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-400/35 bg-cyan-500/10">
            <span className="absolute inset-0 rounded-lg border border-cyan-400/40 animate-radar-pulse" />
            <Radio className="h-3.5 w-3.5 text-cyan-300" />
          </div>
          <div className="flex flex-col leading-none min-w-0">
            <h1
              data-testid="operator-header"
              className="font-mono text-[10.5px] font-bold tracking-[0.04em] text-slate-100 truncate xl:whitespace-nowrap"
            >
              WILDPULSE // BIO-TELEMETRY COMMAND • OPERATOR: GREG
            </h1>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400 tabular-telemetry">
              <span className="inline-flex items-center gap-1 text-cyan-300/90">
                <Compass className="h-2.5 w-2.5 shrink-0" />
                <span data-testid="utc-live-clock">{utcNow}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Fleet Telemetry Counters & Connection Status */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className="hidden sm:flex items-center gap-1 rounded-lg border border-slate-700/60 bg-obsidian-950/60 px-2 py-1 text-[10px] tabular-telemetry"
            title="Active bio-logged individuals in current fleet"
          >
            <Activity className="h-3 w-3 text-emerald-400" />
            <span data-testid="active-individuals-count" className="font-semibold text-slate-100">
              {fleetStats.totalIndividuals}
            </span>
            <span className="text-slate-400">ACTIVE</span>
            <span className="text-emerald-400/90">({fleetStats.active24hCount} &lt;24h)</span>
          </div>

          <div
            className="hidden md:flex items-center gap-1 rounded-lg border border-slate-700/60 bg-obsidian-950/60 px-2 py-1 text-[10px] tabular-telemetry"
            title="Cumulative fleet distance across loaded trajectories"
          >
            <Route className="h-3 w-3 text-cyan-400" />
            <span data-testid="cumulative-fleet-distance" className="font-semibold text-cyan-200">
              {fleetStats.totalDistanceKm.toLocaleString('en-US')} km
            </span>
          </div>

          <div
            data-testid="connection-mode-pill"
            title={
              proxyHealth
                ? `${connMeta.description} | Cache: ${proxyHealth.cacheEntries} | Queue: ${proxyHealth.queueDepth}`
                : connMeta.description
            }
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[10px] font-semibold tracking-wider whitespace-nowrap ${connMeta.badgeClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connMeta.dotClass}`} />
            <Wifi className="h-3 w-3 opacity-80" />
            <span>{connMeta.label}</span>
          </div>
        </div>

        {/* Basemap & Track Color Controls */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
          {/* 4 Basemap Switcher Buttons */}
          <div
            className="flex items-center gap-0.5 rounded-lg border border-slate-700/70 bg-obsidian-950/70 p-0.5"
            role="group"
            aria-label="Basemap layers"
          >
            <span className="hidden 2xl:inline-flex items-center px-1.5 text-[9px] font-mono uppercase tracking-wider text-slate-400">
              <Layers className="h-3 w-3 text-slate-400" />
            </span>
            {BASEMAP_OPTIONS.map((item) => {
              const active = basemap === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`basemap-btn-${item.id}`}
                  onClick={() => setBasemap(item.id)}
                  title={item.title}
                  aria-pressed={active}
                  className={`rounded-md px-1.5 py-1 font-mono text-[10px] font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50 shadow-[0_0_12px_-4px_rgba(34,211,238,0.5)]'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 border border-transparent'
                  }`}
                >
                  <span className="mr-0.5 text-[9px] opacity-55">{item.hotkey}</span>
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* 4 Track-Color Pills */}
          <div
            className="flex items-center gap-0.5 rounded-lg border border-slate-700/70 bg-obsidian-950/70 p-0.5"
            role="group"
            aria-label="Track coloring mode"
          >
            <span className="hidden 2xl:inline-flex items-center px-1.5 text-[9px] font-mono uppercase tracking-wider text-slate-400">
              <Palette className="h-3 w-3 text-slate-400" />
            </span>
            {TRACK_COLOR_OPTIONS.map((item) => {
              const active = trackColorMode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`track-mode-btn-${item.id}`}
                  onClick={() => setTrackColorMode(item.id)}
                  title={item.title}
                  aria-pressed={active}
                  className={`rounded-md px-1.5 py-1 font-mono text-[10px] font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/50 shadow-[0_0_12px_-4px_rgba(16,185,129,0.45)]'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 border border-transparent'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}

export default TopCommandBar;
