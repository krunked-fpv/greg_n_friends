import type {
  EcologicalGuild,
  FeedStatus,
  IucnStatus,
  PingRecencyFilter,
} from '../../types/telemetry';

export const FEED_STATUS_META: Record<
  FeedStatus,
  { label: string; badgeClass: string; dotClass: string; title: string }
> = {
  LIVE_API: {
    label: 'LIVE API',
    badgeClass:
      'bg-emerald-500/15 text-emerald-300 border-emerald-400/45 shadow-[0_0_12px_-4px_rgba(16,185,129,0.5)]',
    dotClass: 'bg-emerald-400 animate-beacon-dot',
    title: 'Direct live telemetry ingested from upstream provider',
  },
  CACHED: {
    label: 'CACHED',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-400/40',
    dotClass: 'bg-amber-400',
    title: 'TTL-cached telemetry snapshot from recent upstream harvest',
  },
  DEMO_FEED: {
    label: 'DEMO FEED',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-400/40',
    dotClass: 'bg-violet-400',
    title: 'Curated fallback bio-logging reference track',
  },
};

export const IUCN_STATUS_META: Record<
  IucnStatus,
  { code: IucnStatus; label: string; badgeClass: string }
> = {
  CR: {
    code: 'CR',
    label: 'Critically Endangered',
    badgeClass: 'bg-red-600/20 text-red-300 border-red-500/55',
  },
  EN: {
    code: 'EN',
    label: 'Endangered',
    badgeClass: 'bg-orange-500/20 text-orange-300 border-orange-500/55',
  },
  VU: {
    code: 'VU',
    label: 'Vulnerable',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-400/50',
  },
  NT: {
    code: 'NT',
    label: 'Near Threatened',
    badgeClass: 'bg-lime-500/20 text-lime-300 border-lime-400/45',
  },
  LC: {
    code: 'LC',
    label: 'Least Concern',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/45',
  },
  DD: {
    code: 'DD',
    label: 'Data Deficient',
    badgeClass: 'bg-slate-500/20 text-slate-300 border-slate-400/45',
  },
};

export const GUILD_META: Record<
  EcologicalGuild,
  { label: string; shortLabel: string; accentText: string; accentBorder: string }
> = {
  AVIAN: {
    label: 'Avian',
    shortLabel: 'Avian',
    accentText: 'text-sky-300',
    accentBorder: 'border-sky-400/35',
  },
  MARINE: {
    label: 'Sharks & Marine',
    shortLabel: 'Marine',
    accentText: 'text-cyan-300',
    accentBorder: 'border-cyan-400/35',
  },
  TERRESTRIAL: {
    label: 'Terrestrial Mammals',
    shortLabel: 'Terrestrial',
    accentText: 'text-amber-300',
    accentBorder: 'border-amber-400/35',
  },
  REPTILE: {
    label: 'Reptiles',
    shortLabel: 'Reptiles',
    accentText: 'text-emerald-300',
    accentBorder: 'border-emerald-400/35',
  },
};

export function getRecencyTier(freshnessMs: number): Exclude<PingRecencyFilter, 'ALL'> {
  const dayMs = 24 * 3600 * 1000;
  if (!Number.isFinite(freshnessMs) || freshnessMs <= dayMs) return 'ACTIVE_24H';
  if (freshnessMs <= 7 * dayMs) return 'LAST_7D';
  return 'HISTORICAL';
}

export function FeedProvenanceBadge({
  feedStatus,
  compact = false,
}: {
  feedStatus: FeedStatus;
  compact?: boolean;
}) {
  const meta = FEED_STATUS_META[feedStatus];
  return (
    <span
      title={meta.title}
      data-testid={`provenance-badge-${feedStatus}`}
      className={`inline-flex items-center gap-1.5 rounded border font-mono font-semibold uppercase tracking-wider ${
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'
      } ${meta.badgeClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </span>
  );
}

export function IucnBadge({
  status,
  showFullLabel = false,
}: {
  status: IucnStatus;
  showFullLabel?: boolean;
}) {
  const meta = IUCN_STATUS_META[status] ?? IUCN_STATUS_META.DD;
  return (
    <span
      title={`IUCN Red List: ${meta.label}`}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider ${meta.badgeClass}`}
    >
      <span>{meta.code}</span>
      {showFullLabel && <span className="font-sans font-medium opacity-90">• {meta.label}</span>}
    </span>
  );
}

export function PingFreshnessBadge({
  freshnessMs,
  label,
}: {
  freshnessMs: number;
  label: string;
}) {
  const tier = getRecencyTier(freshnessMs);
  const style =
    tier === 'ACTIVE_24H'
      ? {
          dot: 'bg-emerald-400 animate-beacon-dot',
          text: 'text-emerald-300',
          border: 'border-emerald-500/30 bg-emerald-500/10',
        }
      : tier === 'LAST_7D'
        ? {
            dot: 'bg-cyan-400',
            text: 'text-cyan-300',
            border: 'border-cyan-500/30 bg-cyan-500/10',
          }
        : {
            dot: 'bg-slate-400',
            text: 'text-slate-400',
            border: 'border-slate-500/30 bg-slate-500/10',
          };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] ${style.border} ${style.text}`}
      title={`Last telemetry ping: ${label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      <span>{label || 'Unknown'}</span>
    </span>
  );
}

export function GuildSilhouetteSvg({
  guild,
  colorHex = '#22d3ee',
  className = 'w-16 h-16',
}: {
  guild: EcologicalGuild;
  colorHex?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 80"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`guild-grad-${guild}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={colorHex} stopOpacity="0.88" />
          <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {guild === 'AVIAN' && (
        <path
          d="M10 38 C28 24, 45 27, 56 35 L62 28 C66 25, 71 26, 73 29 L82 30 L74 35 C72 41, 66 44, 59 44 L48 56 L42 53 L47 42 C34 39, 22 41, 10 38 Z M57 35 C68 18, 86 10, 108 12 C94 21, 82 28, 73 35"
          fill={`url(#guild-grad-${guild})`}
          stroke={colorHex}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      )}

      {guild === 'MARINE' && (
        <path
          d="M14 45 C24 39, 32 34, 44 33 L52 17 C55 24, 58 29, 62 32 C78 33, 93 38, 106 43 C97 46, 88 49, 77 50 L72 56 L66 50 C52 51, 38 49, 25 47 L13 55 L17 45 L10 36 L19 41 Z"
          fill={`url(#guild-grad-${guild})`}
          stroke={colorHex}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      )}

      {guild === 'TERRESTRIAL' && (
        <path
          d="M24 58 L27 42 L20 35 L25 32 L33 34 C44 30, 61 30, 74 33 L83 22 L87 28 L94 27 L91 33 L97 38 L92 42 L83 41 L79 58 L73 58 L74 46 L52 46 L48 58 L42 58 L44 45 L33 46 L30 58 Z"
          fill={`url(#guild-grad-${guild})`}
          stroke={colorHex}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      )}

      {guild === 'REPTILE' && (
        <path
          d="M28 42 C32 27, 46 21, 62 22 C76 23, 86 31, 88 41 C84 50, 73 54, 59 54 C44 54, 32 50, 28 42 Z M87 38 C94 35, 102 35, 106 39 C103 44, 95 46, 87 44 M74 26 C81 17, 90 15, 95 19 C90 25, 83 28, 78 29 M40 49 C34 57, 27 62, 21 60 C25 53, 30 48, 35 46 M68 52 C72 59, 78 63, 84 61 C81 55, 76 51, 72 50"
          fill={`url(#guild-grad-${guild})`}
          stroke={colorHex}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function formatDms(decimalDeg: number, axis: 'lat' | 'lon'): string {
  if (!Number.isFinite(decimalDeg)) return '—';
  const hemisphere =
    axis === 'lat' ? (decimalDeg >= 0 ? 'N' : 'S') : decimalDeg >= 0 ? 'E' : 'W';
  const abs = Math.abs(decimalDeg);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60);
  const adjustedMin = sec === 60 ? min + 1 : min;
  const adjustedSec = sec === 60 ? 0 : sec;
  const finalDeg = adjustedMin === 60 ? deg + 1 : deg;
  const finalMin = adjustedMin === 60 ? 0 : adjustedMin;
  return `${finalDeg}° ${String(finalMin).padStart(2, '0')}' ${String(adjustedSec).padStart(2, '0')}" ${hemisphere}`;
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatAltitudeOrDepth(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return 'N/A';
  }
  const rounded = Math.round(meters);
  if (rounded > 0) return `+${rounded.toLocaleString('en-US')} m alt`;
  if (rounded < 0) return `${rounded.toLocaleString('en-US')} m depth`;
  return '0 m surface';
}
