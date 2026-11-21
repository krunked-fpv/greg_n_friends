import type { FeedStatus } from '../../types/telemetry';
import type {
  FixMarkerProperties,
  HeadBeaconProperties,
} from '../../utils/geo/trackGeoJson';
import { getArgosUncertaintyRadiusMeters } from '../../utils/geo/uncertaintyCircle';

export interface HoveredMapTarget {
  x: number;
  y: number;
  isHead: boolean;
  props: FixMarkerProperties | HeadBeaconProperties;
}

interface FixHoverTooltipProps {
  target: HoveredMapTarget | null;
}

function formatUtcTimestamp(isoOrMs: string | number): string {
  const d = new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return 'Unknown UTC';
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatAltitudeOrDepth(meters: number | null): string {
  if (meters === null || !Number.isFinite(meters)) return 'Sensor Inactive';
  if (meters < -0.5) return `${Math.round(meters).toLocaleString()} m Depth`;
  if (meters > 0.5) return `+${Math.round(meters).toLocaleString()} m ASL`;
  return '0 m Surface';
}

function formatFeedBadge(status: FeedStatus): {
  label: string;
  classes: string;
} {
  switch (status) {
    case 'LIVE_API':
      return {
        label: 'LIVE API',
        classes: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40',
      };
    case 'CACHED':
      return {
        label: 'CACHED',
        classes: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40',
      };
    case 'DEMO_FEED':
    default:
      return {
        label: 'DEMO FEED',
        classes: 'bg-amber-500/20 text-amber-300 border-amber-400/40',
      };
  }
}

export function FixHoverTooltip({ target }: FixHoverTooltipProps) {
  if (!target) return null;

  const { x, y, isHead, props } = target;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 720;

  const left = Math.max(12, Math.min(x + 16, viewportW - 296));
  const top = Math.max(12, Math.min(y + 16, viewportH - 250));

  const badge = formatFeedBadge(props.feedStatus);
  const uncertaintyMeters = getArgosUncertaintyRadiusMeters(
    props.argosLc,
    props.accuracyRadiusMeters,
  );

  const speedKmh = isHead
    ? (props as HeadBeaconProperties).speedKmh
    : (props as FixMarkerProperties).groundSpeedKmh;
  const bearingDeg = isHead
    ? (props as HeadBeaconProperties).bearingDeg
    : (props as FixMarkerProperties).headingDeg;

  const fixOnly = isHead ? null : (props as FixMarkerProperties);

  return (
    <div
      data-testid="fix-hover-tooltip"
      style={{ left, top }}
      className="pointer-events-none fixed z-50 w-[276px] rounded-xl hud-glass-elevated p-3 text-xs text-slate-100"
    >
      <div
        className="mb-2 flex items-start justify-between gap-2 border-l-2 pl-2"
        style={{ borderColor: props.colorHex }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-white">
              {props.nickname}
            </span>
            {isHead && (
              <span className="rounded bg-cyan-500/20 px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
                HEAD
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-slate-300">{props.commonName}</div>
          <div className="truncate text-[10px] italic text-slate-400">
            {props.scientificName}
          </div>
        </div>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ${badge.classes}`}
        >
          {badge.label}
        </span>
      </div>

      {fixOnly?.isOutlierSpike && (
        <div className="mb-2 rounded border border-rose-500/40 bg-rose-500/15 px-2 py-1 font-mono text-[10px] text-rose-300">
          Outlier Spike Flagged (Excluded from Track Line)
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-800/80 pt-2 font-mono text-[11px] tabular-nums">
        <div className="col-span-2 flex items-center justify-between text-slate-300">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Timestamp
          </span>
          <span>{formatUtcTimestamp(props.timestampMs)}</span>
        </div>

        <div className="col-span-2 flex items-center justify-between text-slate-300">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Position
          </span>
          <span>
            {props.lat.toFixed(4)}°, {props.lon.toFixed(4)}°
          </span>
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">
            Speed
          </div>
          <div className="text-cyan-300">
            {speedKmh !== null && Number.isFinite(speedKmh)
              ? `${speedKmh.toFixed(1)} km/h`
              : '—'}
            {fixOnly?.speedIsDerived ? (
              <span className="ml-1 text-[9px] text-slate-400">(est)</span>
            ) : null}
          </div>
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">
            Alt / Depth
          </div>
          <div className="text-emerald-300">
            {formatAltitudeOrDepth(props.altitudeOrDepthMeters)}
          </div>
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">
            Heading
          </div>
          <div className="text-slate-200">
            {bearingDeg !== null && Number.isFinite(bearingDeg)
              ? `${Math.round(((bearingDeg % 360) + 360) % 360)}°`
              : '—'}
          </div>
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">
            Uncertainty
          </div>
          <div className="text-slate-200">
            {uncertaintyMeters !== null
              ? `${props.argosLc ? `LC ${props.argosLc} · ` : ''}±${
                  uncertaintyMeters >= 1000
                    ? `${(uncertaintyMeters / 1000).toFixed(1)}km`
                    : `${Math.round(uncertaintyMeters)}m`
                }`
              : '—'}
          </div>
        </div>

        {fixOnly && (fixOnly.tagVoltage !== null || fixOnly.externalTempC !== null) && (
          <>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-slate-500">
                Battery
              </div>
              <div className="text-slate-200">
                {fixOnly.tagVoltage !== null
                  ? `${fixOnly.tagVoltage.toFixed(2)} V`
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-slate-500">
                Tag Temp
              </div>
              <div className="text-slate-200">
                {fixOnly.externalTempC !== null
                  ? `${fixOnly.externalTempC.toFixed(1)} °C`
                  : '—'}
              </div>
            </div>
          </>
        )}
      </div>

      {fixOnly && (
        <div className="mt-2 flex items-center justify-between border-t border-slate-800/80 pt-1.5 text-[10px] text-slate-400">
          <span>{fixOnly.sensorType}</span>
          <span className="text-cyan-400/80">Click to inspect dossier</span>
        </div>
      )}
    </div>
  );
}
