import { Compass, Layers, Radio } from 'lucide-react';
import { selectFilteredAnimals, useTelemetryStore } from '../../store/telemetryStore';
import { BASEMAPS } from '../../utils/geo/basemaps';
import { TRACK_LEGEND_SPECS } from '../../utils/geo/trackGeoJson';

export function MapLegendOverlay() {
  const trackColorMode = useTelemetryStore((s) => s.trackColorMode);
  const basemap = useTelemetryStore((s) => s.basemap);
  const leftDrawerOpen = useTelemetryStore((s) => s.leftDrawerOpen);
  const selectedAnimalId = useTelemetryStore((s) => s.selectedAnimalId);
  const animals = useTelemetryStore(selectFilteredAnimals);

  const spec = TRACK_LEGEND_SPECS[trackColorMode];
  const basemapDef = BASEMAPS[basemap];

  return (
    <aside
      data-testid="map-legend-overlay"
      style={{ left: leftDrawerOpen ? '340px' : '16px' }}
      className="pointer-events-auto fixed bottom-[132px] z-20 hidden w-[236px] rounded-xl border border-slate-700/60 bg-obsidian-950/82 p-2.5 text-[11px] text-slate-200 shadow-xl shadow-black/50 backdrop-blur-xl transition-all duration-300 md:block"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
          <Layers className="h-3 w-3 text-cyan-400" />
          <span>{spec.title}</span>
        </div>
        <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[9px] uppercase text-slate-400">
          {basemapDef.shortLabel}
        </span>
      </div>

      {trackColorMode === 'animal' ? (
        <div className="mb-2 max-h-24 space-y-1 overflow-y-auto pr-1">
          {animals.slice(0, 6).map((animal) => {
            const active = selectedAnimalId === animal.id;
            return (
              <div
                key={animal.id}
                className={`flex items-center justify-between gap-2 text-[10px] ${
                  active ? 'font-semibold text-white' : 'text-slate-300'
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/30"
                    style={{ backgroundColor: animal.colorHex }}
                  />
                  <span className="truncate">{animal.nickname}</span>
                </div>
                <span className="shrink-0 font-mono text-[9px] text-slate-500">
                  {animal.guild.slice(0, 3)}
                </span>
              </div>
            );
          })}
          {animals.length > 6 && (
            <div className="font-mono text-[9px] text-slate-500">
              +{animals.length - 6} more individuals
            </div>
          )}
        </div>
      ) : (
        <div className="mb-2">
          <div
            className="h-2 w-full rounded-full border border-white/10"
            style={{ background: spec.gradientCss }}
          />
          <div className="mt-1 flex items-center justify-between font-mono text-[9px] tabular-nums text-slate-400">
            {spec.stops.map((stop) => (
              <span key={stop.label}>{stop.label}</span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-800/80 pt-1.5 text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Compass className="h-3 w-3 text-cyan-400" />
          <span>Heading</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Radio className="h-3 w-3 text-emerald-400" />
          <span>Argos Radius</span>
        </span>
      </div>
    </aside>
  );
}
