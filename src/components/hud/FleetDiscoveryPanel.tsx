import { useEffect, useMemo, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Database,
  DownloadCloud,
  Filter,
  Search,
  X,
} from 'lucide-react';
import { selectFilteredAnimals, useTelemetryStore } from '../../store/telemetryStore';
import type {
  EcologicalGuild,
  FeedStatus,
  PingRecencyFilter,
} from '../../types/telemetry';
import { SparklineSvg } from './SparklineSvg';
import {
  FeedProvenanceBadge,
  GUILD_META,
  IucnBadge,
  PingFreshnessBadge,
  formatAltitudeOrDepth,
  formatNumber,
} from './telemetryBadges';

const GUILD_PILLS: Array<{ id: EcologicalGuild | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'AVIAN', label: 'Avian' },
  { id: 'MARINE', label: 'Sharks & Marine' },
  { id: 'TERRESTRIAL', label: 'Terrestrial Mammals' },
  { id: 'REPTILE', label: 'Reptiles' },
];

const RECENCY_PILLS: Array<{ id: PingRecencyFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'ACTIVE_24H', label: '< 24h' },
  { id: 'LAST_7D', label: '2–7d' },
  { id: 'HISTORICAL', label: 'Historical' },
];

const FEED_PILLS: Array<{ id: FeedStatus | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'ALL' },
  { id: 'LIVE_API', label: 'LIVE API' },
  { id: 'CACHED', label: 'CACHED' },
  { id: 'DEMO_FEED', label: 'DEMO FEED' },
];

export interface FleetDiscoveryPanelProps {
  onOpenStudyImporter?: () => void;
}

export function FleetDiscoveryPanel({ onOpenStudyImporter }: FleetDiscoveryPanelProps) {
  const animals = useTelemetryStore((s) => s.animals);
  const isLoading = useTelemetryStore((s) => s.isLoading);
  const selectedAnimalId = useTelemetryStore((s) => s.selectedAnimalId);
  const guildFilter = useTelemetryStore((s) => s.guildFilter);
  const recencyFilter = useTelemetryStore((s) => s.recencyFilter);
  const feedFilter = useTelemetryStore((s) => s.feedFilter);
  const featuredStudyFilter = useTelemetryStore((s) => s.featuredStudyFilter);
  const searchQuery = useTelemetryStore((s) => s.searchQuery);
  const leftDrawerOpen = useTelemetryStore((s) => s.leftDrawerOpen);
  const selectAnimal = useTelemetryStore((s) => s.selectAnimal);
  const setGuildFilter = useTelemetryStore((s) => s.setGuildFilter);
  const setRecencyFilter = useTelemetryStore((s) => s.setRecencyFilter);
  const setFeedFilter = useTelemetryStore((s) => s.setFeedFilter);
  const setFeaturedStudyFilter = useTelemetryStore((s) => s.setFeaturedStudyFilter);
  const setSearchQuery = useTelemetryStore((s) => s.setSearchQuery);
  const toggleLeftDrawer = useTelemetryStore((s) => s.toggleLeftDrawer);
  const setStudyImporterOpen = useTelemetryStore((s) => s.setStudyImporterOpen);
  const triggerFlyTo = useTelemetryStore((s) => s.triggerFlyTo);

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const nonGuildFilteredAnimals = useMemo(
    () =>
      selectFilteredAnimals({
        ...useTelemetryStore.getState(),
        animals,
        guildFilter: 'ALL',
        recencyFilter,
        feedFilter,
        featuredStudyFilter,
        searchQuery,
      }),
    [animals, recencyFilter, feedFilter, featuredStudyFilter, searchQuery],
  );

  const guildCounts = useMemo(() => {
    const counts: Record<EcologicalGuild | 'ALL', number> = {
      ALL: nonGuildFilteredAnimals.length,
      AVIAN: 0,
      MARINE: 0,
      TERRESTRIAL: 0,
      REPTILE: 0,
    };
    for (const animal of nonGuildFilteredAnimals) {
      counts[animal.guild] += 1;
    }
    return counts;
  }, [nonGuildFilteredAnimals]);

  const filteredAnimals = useMemo(
    () =>
      selectFilteredAnimals({
        ...useTelemetryStore.getState(),
        animals,
        guildFilter,
        recencyFilter,
        feedFilter,
        featuredStudyFilter,
        searchQuery,
      }),
    [
      animals,
      guildFilter,
      recencyFilter,
      feedFilter,
      featuredStudyFilter,
      searchQuery,
    ],
  );

  useEffect(() => {
    if (!selectedAnimalId || !leftDrawerOpen) return;
    const cardEl = cardRefs.current.get(selectedAnimalId);
    if (!cardEl || typeof cardEl.scrollIntoView !== 'function') return;
    cardEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedAnimalId, leftDrawerOpen]);

  const featuredStudies = useMemo(() => {
    const map = new Map<string, string>();
    for (const animal of animals) {
      if (!map.has(animal.studyId)) {
        map.set(animal.studyId, animal.attribution.studyTitle || `Study ${animal.studyId}`);
      }
    }
    return Array.from(map.entries()).map(([studyId, title]) => ({
      studyId,
      title,
    }));
  }, [animals]);

  const hasActiveFilters =
    guildFilter !== 'ALL' ||
    recencyFilter !== 'ALL' ||
    feedFilter !== 'ALL' ||
    featuredStudyFilter !== 'ALL' ||
    searchQuery.trim().length > 0;

  const handleResetFilters = () => {
    setGuildFilter('ALL');
    setRecencyFilter('ALL');
    setFeedFilter('ALL');
    setFeaturedStudyFilter('ALL');
    setSearchQuery('');
  };

  const handleOpenImporter = () => {
    if (onOpenStudyImporter) {
      onOpenStudyImporter();
    } else {
      setStudyImporterOpen(true);
    }
  };

  if (!leftDrawerOpen) {
    return (
      <button
        type="button"
        data-testid="toggle-left-drawer-btn"
        onClick={toggleLeftDrawer}
        aria-expanded={false}
        title="Expand Fleet Discovery Panel (Key [)"
        className="pointer-events-auto fixed top-[132px] sm:top-[102px] xl:top-[66px] left-2.5 z-20 hud-glass rounded-xl px-3 py-2 flex items-center gap-2 text-xs font-mono font-semibold text-cyan-200 hover:border-cyan-400/50 transition-colors"
      >
        <Filter className="h-3.5 w-3.5 text-cyan-300" />
        <span>FLEET</span>
        <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-300 tabular-telemetry">
          {filteredAnimals.length}/{animals.length}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
      </button>
    );
  }

  return (
    <aside
      data-testid="fleet-discovery-panel"
      aria-label="Fleet Discovery Panel"
      className="pointer-events-auto fixed top-[132px] sm:top-[102px] xl:top-[66px] bottom-[146px] lg:bottom-[118px] left-2.5 z-20 w-[336px] max-w-[calc(100vw-20px)] hud-glass rounded-xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-2 border-b hud-hairline px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Filter className="h-3.5 w-3.5 text-cyan-300 shrink-0" />
          <h2 className="font-mono text-[11px] font-bold tracking-[0.1em] uppercase text-slate-100 truncate">
            Fleet Discovery
          </h2>
          <span className="shrink-0 rounded bg-cyan-500/15 border border-cyan-400/30 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300 tabular-telemetry">
            {filteredAnimals.length}/{animals.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="open-study-importer-btn"
            onClick={handleOpenImporter}
            aria-label="Import Movebank Study"
            title="Import live Movebank Study by ID"
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-2 py-1 font-mono text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/25 hover:border-cyan-300/60 transition-colors whitespace-nowrap"
          >
            <DownloadCloud className="h-3 w-3 shrink-0" />
            <span>Import Study</span>
          </button>

          <button
            type="button"
            data-testid="toggle-left-drawer-btn"
            onClick={toggleLeftDrawer}
            aria-expanded={true}
            title="Collapse Fleet Discovery Panel (Key [)"
            className="rounded-lg border border-slate-700/70 bg-obsidian-950/60 p-1 text-slate-400 hover:text-slate-100 hover:border-cyan-400/40 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="shrink-0 space-y-2 border-b hud-hairline bg-obsidian-950/40 px-3 py-2">
        {/* Search Input */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            data-testid="fleet-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search species, tag ID, nickname, study..."
            className="select-text w-full rounded-lg border border-slate-700/75 bg-obsidian-950/85 py-1.5 pl-8 pr-7 font-sans text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Ecological Guild Pills */}
        <div className="flex flex-wrap gap-1" role="group" aria-label="Ecological guild filter">
          {GUILD_PILLS.map((pill) => {
            const active = guildFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                data-testid={`guild-filter-${pill.id}`}
                onClick={() => setGuildFilter(pill.id)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  active
                    ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                    : 'border-slate-700/60 bg-obsidian-900/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                }`}
              >
                <span>{pill.label}</span>
                <span
                  data-testid={`guild-count-${pill.id}`}
                  className={`tabular-telemetry rounded px-1 text-[9px] font-semibold leading-[1.35] ${
                    active
                      ? 'bg-cyan-400/20 text-cyan-100'
                      : 'bg-slate-800/80 text-slate-300'
                  }`}
                >
                  {guildCounts[pill.id]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Ping Recency + Feed Provenance Row */}
        <div className="grid grid-cols-1 gap-1.5">
          <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Ping recency filter">
            <span className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mr-0.5">
              PING:
            </span>
            {RECENCY_PILLS.map((pill) => {
              const active = recencyFilter === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  data-testid={`recency-filter-${pill.id}`}
                  onClick={() => setRecencyFilter(pill.id)}
                  aria-pressed={active}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] transition-colors ${
                    active
                      ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                      : 'border-slate-700/60 bg-obsidian-900/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Feed provenance filter">
            <span className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mr-0.5">
              FEED:
            </span>
            {FEED_PILLS.map((pill) => {
              const active = feedFilter === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  data-testid={`feed-filter-${pill.id}`}
                  onClick={() => setFeedFilter(pill.id)}
                  aria-pressed={active}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] transition-colors ${
                    active
                      ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                      : 'border-slate-700/60 bg-obsidian-900/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Featured Active Studies Dropdown */}
        <div className="flex items-center gap-1.5">
          <Database className="h-3 w-3 text-slate-400 shrink-0" />
          <select
            data-testid="featured-study-select"
            value={featuredStudyFilter}
            onChange={(e) => setFeaturedStudyFilter(e.target.value)}
            aria-label="Filter by featured active study"
            className="min-w-0 flex-1 rounded-md border border-slate-700/70 bg-obsidian-950/90 px-2 py-1 font-sans text-[11px] text-slate-200 focus:border-cyan-400/60 focus:outline-none truncate"
          >
            <option value="ALL">All Featured Studies ({featuredStudies.length})</option>
            {featuredStudies.map((study) => (
              <option key={study.studyId} value={study.studyId}>
                [{study.studyId}] {study.title}
              </option>
            ))}
          </select>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              title="Reset all filters"
              className="shrink-0 rounded border border-slate-700/70 bg-obsidian-900/80 px-1.5 py-1 font-mono text-[9px] uppercase text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Fleet Card List */}
      <div className="flex-1 min-h-0 overflow-y-auto hud-scrollbar p-2 space-y-2">
        {isLoading && animals.length === 0 ? (
          <div className="space-y-2 p-1">
            {[0, 1, 2, 3].map((slot) => (
              <div
                key={slot}
                className="hud-card rounded-lg p-3 animate-pulse space-y-2"
              >
                <div className="h-3 w-2/3 rounded bg-slate-800" />
                <div className="h-2.5 w-1/2 rounded bg-slate-800/80" />
                <div className="h-6 w-full rounded bg-slate-800/60" />
              </div>
            ))}
          </div>
        ) : filteredAnimals.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-700/70 bg-obsidian-950/40 px-4 py-8 text-center">
            <p className="text-xs font-medium text-slate-300">
              No bio-logged individuals match active filters.
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Adjust guild, recency, provenance, or study selection.
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-3 rounded-lg border border-cyan-400/45 bg-cyan-500/15 px-3 py-1 font-mono text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/25"
              >
                Reset All Filters
              </button>
            )}
          </div>
        ) : (
          filteredAnimals.map((animal) => {
            const isSelected = selectedAnimalId === animal.id;
            const guildMeta = GUILD_META[animal.guild];
            const zoomLevel =
              animal.guild === 'TERRESTRIAL' || animal.guild === 'REPTILE' ? 6.5 : 4.2;

            return (
              <div
                key={animal.id}
                ref={(el) => {
                  if (el) {
                    cardRefs.current.set(animal.id, el);
                  } else {
                    cardRefs.current.delete(animal.id);
                  }
                }}
                role="button"
                tabIndex={0}
                data-testid={`fleet-card-${animal.id}`}
                onClick={() => selectAnimal(animal.id, true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectAnimal(animal.id, true);
                  }
                }}
                className={`group rounded-lg p-2.5 cursor-pointer transition-all outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
                  isSelected ? 'hud-card-selected' : 'hud-card'
                }`}
              >
                {/* Top Row: Nickname, Color Swatch, Provenance & IUCN */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25"
                        style={{ backgroundColor: animal.colorHex }}
                      />
                      <span className="truncate text-xs font-semibold text-slate-100">
                        {animal.nickname}
                      </span>
                      <span className="truncate font-mono text-[9.5px] text-slate-500">
                        #{animal.localIdentifier}
                      </span>
                    </div>

                    <div className="mt-0.5 flex items-baseline gap-1.5 overflow-hidden">
                      <span className="truncate text-[11px] font-medium text-slate-300">
                        {animal.commonName}
                      </span>
                      <span className="truncate text-[10px] italic text-slate-500">
                        {animal.scientificName}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <IucnBadge status={animal.ecology.iucnStatus} />
                    <button
                      type="button"
                      data-testid={`fly-to-btn-${animal.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerFlyTo(animal.latestFix.lat, animal.latestFix.lon, zoomLevel);
                      }}
                      title={`Fly camera to ${animal.nickname}'s latest position`}
                      aria-label={`Fly camera to ${animal.nickname}`}
                      className="rounded border border-slate-700/70 bg-obsidian-950/70 p-1 text-slate-400 hover:border-cyan-400/55 hover:text-cyan-200 transition-colors"
                    >
                      <Crosshair className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Middle Row: Provenance, Ping Freshness, Guild */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <FeedProvenanceBadge feedStatus={animal.feedStatus} compact />
                  <PingFreshnessBadge
                    freshnessMs={animal.kinematics.pingFreshnessMs}
                    label={animal.kinematics.pingFreshnessLabel}
                  />
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${guildMeta.accentBorder} ${guildMeta.accentText} bg-obsidian-950/50`}
                  >
                    {guildMeta.shortLabel}
                  </span>
                </div>

                {/* Bottom Row: Sparkline + Tabular Telemetry */}
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-1.5">
                  <SparklineSvg
                    fixes={animal.fixes}
                    colorHex={animal.colorHex}
                    width={96}
                    height={22}
                  />

                  <div className="flex items-center gap-2.5 text-right tabular-telemetry">
                    <div>
                      <div className="text-[8.5px] uppercase text-slate-500">SPD</div>
                      <div className="text-[10.5px] font-semibold text-slate-200">
                        {formatNumber(animal.kinematics.currentSpeedKmh, 1)}
                        <span className="ml-0.5 text-[9px] font-normal text-slate-400">km/h</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[8.5px] uppercase text-slate-500">DIST</div>
                      <div className="text-[10.5px] font-semibold text-cyan-200">
                        {Math.round(animal.kinematics.totalDistanceKm).toLocaleString('en-US')}
                        <span className="ml-0.5 text-[9px] font-normal text-slate-400">km</span>
                      </div>
                    </div>
                    {animal.kinematics.hasAltitudeOrDepth && (
                      <div className="hidden sm:block">
                        <div className="text-[8.5px] uppercase text-slate-500">VERT</div>
                        <div className="text-[10px] font-semibold text-slate-300">
                          {formatAltitudeOrDepth(animal.latestFix.altitudeOrDepthMeters).replace(' alt', '').replace(' depth', '')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

export default FleetDiscoveryPanel;
