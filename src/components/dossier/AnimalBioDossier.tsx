import { useEffect, useState } from 'react';
import {
  BatteryCharging,
  BookOpen,
  Compass,
  Crosshair,
  ExternalLink,
  FileText,
  Globe2,
  MapPin,
  Moon,
  Navigation,
  Radio,
  Scale,
  Sun,
  Sunrise,
  Thermometer,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import { useTelemetryStore } from '../../store/telemetryStore';
import type { AnimalDossier, SolarPhase } from '../../types/telemetry';
import { AltitudeDepthChart } from '../charts/AltitudeDepthChart';
import { DailyDistanceChart } from '../charts/DailyDistanceChart';
import { SpeedTimeChart } from '../charts/SpeedTimeChart';
import {
  FeedProvenanceBadge,
  GUILD_META,
  GuildSilhouetteSvg,
  IucnBadge,
  PingFreshnessBadge,
  formatDms,
  formatNumber,
} from '../hud/telemetryBadges';

function SolarPhaseIcon({ phase }: { phase: SolarPhase }) {
  switch (phase) {
    case 'Daylight':
      return <Sun className="h-3.5 w-3.5 text-amber-300" />;
    case 'Civil Twilight':
    case 'Nautical Twilight':
      return <Sunrise className="h-3.5 w-3.5 text-orange-300" />;
    case 'Night':
      return <Moon className="h-3.5 w-3.5 text-indigo-300" />;
  }
}

function formatDeploymentDate(iso: string): string {
  if (!iso) return 'Unknown';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso.slice(0, 10);
  return new Date(parsed).toISOString().slice(0, 10);
}

function buildCitationText(animal: AnimalDossier): string {
  const year = formatDeploymentDate(animal.deploymentStartIso).slice(0, 4) || '2026';
  return `${animal.attribution.principalInvestigators} (${year}). ${animal.attribution.studyTitle}. ${animal.attribution.institution}. ${animal.sourceProvider} Study #${animal.studyId}. ${animal.attribution.studyUrl}`;
}

export function AnimalBioDossier() {
  const animals = useTelemetryStore((s) => s.animals);
  const selectedAnimalId = useTelemetryStore((s) => s.selectedAnimalId);
  const rightDrawerOpen = useTelemetryStore((s) => s.rightDrawerOpen);
  const setRightDrawerOpen = useTelemetryStore((s) => s.setRightDrawerOpen);
  const triggerFlyTo = useTelemetryStore((s) => s.triggerFlyTo);

  const animal = animals.find((a) => a.id === selectedAnimalId) ?? null;
  const [photoError, setPhotoError] = useState<boolean>(false);

  useEffect(() => {
    setPhotoError(false);
  }, [animal?.id, animal?.ecology.photoUrl]);

  if (!animal) {
    return null;
  }

  if (!rightDrawerOpen) {
    return (
      <button
        type="button"
        data-testid="reopen-dossier-btn"
        onClick={() => setRightDrawerOpen(true)}
        title="Reopen Animal Bio-Dossier (Key ])"
        className="pointer-events-auto fixed top-[66px] right-2.5 z-20 hud-glass rounded-xl px-3 py-2 flex items-center gap-2 text-xs font-mono font-semibold text-cyan-200 hover:border-cyan-400/55 transition-colors"
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: animal.colorHex }}
        />
        <span>DOSSIER: {animal.nickname}</span>
      </button>
    );
  }

  const guildMeta = GUILD_META[animal.guild];
  const showPhoto = Boolean(animal.ecology.photoUrl) && !photoError;
  const taxonomyCrumbs = [
    animal.ecology.taxonomy.kingdom,
    animal.ecology.taxonomy.phylum,
    animal.ecology.taxonomy.class,
    animal.ecology.taxonomy.order,
    animal.ecology.taxonomy.family,
    animal.ecology.taxonomy.genus,
    animal.ecology.taxonomy.species,
  ].filter((part) => Boolean(part && part.trim().length > 0));

  const zoomLevel =
    animal.guild === 'TERRESTRIAL' || animal.guild === 'REPTILE' ? 6.5 : 4.2;

  const hasMarineMetrics =
    animal.environment.seaSurfaceTempC !== null ||
    animal.environment.waveHeightMeters !== null ||
    animal.environment.oceanCurrentKmh !== null;

  return (
    <aside
      data-testid="animal-bio-dossier"
      aria-label={`Bio-Dossier for ${animal.nickname}`}
      className="pointer-events-auto fixed top-[66px] bottom-[118px] right-2.5 z-20 w-[392px] max-w-[calc(100vw-20px)] hud-glass rounded-xl flex flex-col overflow-hidden"
    >
      {/* Top Hero Banner */}
      <div className="relative shrink-0 h-40 overflow-hidden border-b hud-hairline bg-obsidian-950">
        {showPhoto ? (
          <img
            src={animal.ecology.photoUrl ?? undefined}
            alt={`${animal.commonName} (${animal.scientificName})`}
            onError={() => setPhotoError(true)}
            className="h-full w-full object-cover opacity-75"
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-obsidian-900 via-obsidian-950 to-slate-950 relative">
            <div
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 50% 45%, rgba(34,211,238,0.28), transparent 65%)',
              }}
            />
            <GuildSilhouetteSvg
              guild={animal.guild}
              colorHex={animal.colorHex}
              className="w-40 h-24 opacity-90"
            />
            <span className="font-mono text-[9.5px] uppercase tracking-widest text-slate-500">
              {guildMeta.label} Taxonomic Silhouette
            </span>
          </div>
        )}

        {/* Dark Gradient Scrim for Legible Typography */}
        <div className="absolute inset-0 bg-gradient-to-t from-obsidian-950 via-obsidian-950/55 to-obsidian-950/30" />

        {/* Top-Right Action Buttons */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              triggerFlyTo(animal.latestFix.lat, animal.latestFix.lon, zoomLevel)
            }
            title={`Center map on ${animal.nickname}`}
            className="rounded-lg border border-slate-600/60 bg-obsidian-950/80 p-1.5 text-slate-200 hover:border-cyan-400/60 hover:text-cyan-200 backdrop-blur-md transition-colors"
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="close-dossier-btn"
            onClick={() => setRightDrawerOpen(false)}
            title="Close Bio-Dossier Drawer (Key ])"
            aria-label="Close Bio-Dossier"
            className="rounded-lg border border-slate-600/60 bg-obsidian-950/80 p-1.5 text-slate-200 hover:border-rose-400/60 hover:text-rose-200 backdrop-blur-md transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Top-Left Guild & Photo Credit */}
        <div className="absolute top-2.5 left-3 flex items-center gap-1.5">
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase backdrop-blur-md bg-obsidian-950/75 ${guildMeta.accentBorder} ${guildMeta.accentText}`}
          >
            {guildMeta.label}
          </span>
        </div>

        {showPhoto && animal.ecology.photoAttribution && (
          <div className="absolute top-2.5 right-20 max-w-[160px] truncate rounded bg-obsidian-950/70 px-1.5 py-0.5 text-[9px] text-slate-400 backdrop-blur-sm">
            {animal.ecology.photoAttribution}
          </div>
        )}

        {/* Bottom Hero Identity */}
        <div className="absolute bottom-2.5 left-3 right-3 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/25"
                  style={{ backgroundColor: animal.colorHex }}
                />
                <h2 className="truncate text-base font-bold text-white tracking-tight">
                  {animal.nickname}
                </h2>
                <span className="select-text shrink-0 rounded border border-slate-600/60 bg-obsidian-950/80 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-300">
                  TAG {animal.localIdentifier}
                </span>
              </div>
              <div className="truncate text-xs text-slate-200">
                <span className="font-medium">{animal.commonName}</span>{' '}
                <span className="italic text-slate-400">({animal.scientificName})</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <IucnBadge status={animal.ecology.iucnStatus} showFullLabel />
            <FeedProvenanceBadge feedStatus={animal.feedStatus} compact />
            <PingFreshnessBadge
              freshnessMs={animal.kinematics.pingFreshnessMs}
              label={animal.kinematics.pingFreshnessLabel}
            />
          </div>
        </div>
      </div>

      {/* Scrollable Telemetry & Dossier Content */}
      <div className="flex-1 min-h-0 overflow-y-auto hud-scrollbar p-3 space-y-3">
        {/* Biometrics & Sensor Hardware Grid */}
        <section aria-label="Biometrics and Sensor Hardware" className="space-y-1.5">
          <div className="hud-section-label flex items-center gap-1.5">
            <Radio className="h-3 w-3 text-cyan-300" />
            <span>Biometrics &amp; Sensor Hardware</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 tabular-telemetry">
            <div className="hud-card rounded-lg px-2 py-1.5">
              <div className="text-[9px] uppercase text-slate-500">Sex / Stage</div>
              <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-100">
                {animal.sex || 'Unknown'} • {animal.lifeStage || 'Adult'}
              </div>
            </div>

            <div className="hud-card rounded-lg px-2 py-1.5">
              <div className="flex items-center gap-1 text-[9px] uppercase text-slate-500">
                <Scale className="h-2.5 w-2.5" />
                <span>Mass</span>
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-slate-100">
                {animal.massKg !== null && Number.isFinite(animal.massKg)
                  ? `${animal.massKg.toLocaleString('en-US')} kg`
                  : 'N/A'}
              </div>
            </div>

            <div className="hud-card rounded-lg px-2 py-1.5">
              <div className="text-[9px] uppercase text-slate-500">Tag Tech</div>
              <div className="mt-0.5 truncate text-[10.5px] font-semibold text-cyan-200" title={animal.latestFix.sensorType}>
                {animal.latestFix.sensorType}
              </div>
            </div>

            <div className="hud-card rounded-lg px-2 py-1.5">
              <div className="flex items-center gap-1 text-[9px] uppercase text-slate-500">
                <BatteryCharging className="h-2.5 w-2.5 text-emerald-400" />
                <span>Battery</span>
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-emerald-300">
                {animal.latestFix.tagVoltage !== null &&
                Number.isFinite(animal.latestFix.tagVoltage)
                  ? `${animal.latestFix.tagVoltage.toFixed(2)} V`
                  : 'N/A'}
              </div>
            </div>

            <div className="hud-card rounded-lg px-2 py-1.5">
              <div className="flex items-center gap-1 text-[9px] uppercase text-slate-500">
                <Thermometer className="h-2.5 w-2.5 text-amber-300" />
                <span>Tag Temp</span>
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-slate-100">
                {animal.latestFix.externalTempC !== null &&
                Number.isFinite(animal.latestFix.externalTempC)
                  ? `${animal.latestFix.externalTempC.toFixed(1)} °C`
                  : 'N/A'}
              </div>
            </div>

            <div className="hud-card rounded-lg px-2 py-1.5">
              <div className="text-[9px] uppercase text-slate-500">Argos LC</div>
              <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-100">
                {animal.latestFix.argosLc
                  ? `LC ${animal.latestFix.argosLc}`
                  : 'GPS / N/A'}
                {animal.latestFix.accuracyRadiusMeters
                  ? ` (±${animal.latestFix.accuracyRadiusMeters}m)`
                  : ''}
              </div>
            </div>

            <div className="hud-card rounded-lg px-2 py-1.5">
              <div className="text-[9px] uppercase text-slate-500">Deployed</div>
              <div className="mt-0.5 text-[11px] font-semibold text-slate-200">
                {formatDeploymentDate(animal.deploymentStartIso)}
              </div>
            </div>

            <div className="hud-card rounded-lg px-2 py-1.5">
              <div className="text-[9px] uppercase text-slate-500">Days / Path</div>
              <div className="mt-0.5 text-[11px] font-semibold text-cyan-200">
                {animal.kinematics.daysTracked}d •{' '}
                {Math.round(animal.kinematics.totalDistanceKm).toLocaleString('en-US')} km
              </div>
            </div>

            <div className="hud-card rounded-lg px-2 py-1.5">
              <div className="text-[9px] uppercase text-slate-500">24h Displ.</div>
              <div
                className="mt-0.5 text-[11px] font-semibold text-emerald-200"
                title={`24h path distance: ${formatNumber(animal.kinematics.distance24hKm, 1)} km`}
              >
                {formatNumber(animal.kinematics.displacement24hKm, 1)} km
              </div>
            </div>
          </div>
        </section>

        {/* Interactive 60fps Telemetry Charts */}
        <section aria-label="Telemetry Charts" className="space-y-2">
          <SpeedTimeChart animal={animal} />
          <AltitudeDepthChart animal={animal} />
          <DailyDistanceChart animal={animal} />
        </section>

        {/* Live Habitat & Weather Context Card */}
        <section aria-label="Live Habitat and Weather Context" className="space-y-1.5">
          <div className="hud-section-label flex items-center gap-1.5">
            <Globe2 className="h-3 w-3 text-emerald-300" />
            <span>Live Habitat &amp; Weather Context</span>
          </div>

          <div className="hud-card rounded-xl p-2.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                  <MapPin className="h-3.5 w-3.5 text-cyan-300 shrink-0" />
                  <span className="truncate">
                    {animal.environment.regionLabel || 'Active Bio-Telemetry Sector'}
                  </span>
                </div>
                <div className="mt-1 select-text font-mono text-[10.5px] text-cyan-200 tabular-telemetry">
                  {animal.latestFix.lat.toFixed(4)}°, {animal.latestFix.lon.toFixed(4)}°
                </div>
                <div className="select-text font-mono text-[10px] text-slate-400 tabular-telemetry">
                  {formatDms(animal.latestFix.lat, 'lat')} •{' '}
                  {formatDms(animal.latestFix.lon, 'lon')}
                </div>
              </div>

              <div className="shrink-0 rounded-lg border border-slate-700/70 bg-obsidian-950/75 px-2 py-1 text-right">
                <div className="flex items-center justify-end gap-1 text-[10.5px] font-medium text-slate-100">
                  <SolarPhaseIcon phase={animal.environment.solarPhase} />
                  <span>{animal.environment.solarPhase}</span>
                </div>
                <div className="font-mono text-[9.5px] text-slate-400 tabular-telemetry">
                  Solar {animal.environment.solarElevationDeg.toFixed(1)}°
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 border-t border-slate-800/80 pt-2 tabular-telemetry">
              <div className="rounded-lg bg-obsidian-950/60 px-2 py-1.5 border border-slate-800/70">
                <div className="flex items-center gap-1 text-[9px] uppercase text-slate-500">
                  <Thermometer className="h-2.5 w-2.5 text-amber-300" />
                  <span>Ambient Air</span>
                </div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-100">
                  {animal.environment.airTempC !== null
                    ? `${animal.environment.airTempC.toFixed(1)} °C`
                    : 'Unavailable'}
                </div>
              </div>

              <div className="rounded-lg bg-obsidian-950/60 px-2 py-1.5 border border-slate-800/70">
                <div className="flex items-center gap-1 text-[9px] uppercase text-slate-500">
                  <Wind className="h-2.5 w-2.5 text-cyan-300" />
                  <span>Wind Vector</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-100">
                  {animal.environment.windSpeedKmh !== null ? (
                    <>
                      <span>{animal.environment.windSpeedKmh.toFixed(1)} km/h</span>
                      {animal.environment.windDirectionDeg !== null && (
                        <span className="inline-flex items-center gap-0.5 text-cyan-300 text-[10px]">
                          <Navigation
                            className="h-2.5 w-2.5"
                            style={{
                              transform: `rotate(${animal.environment.windDirectionDeg}deg)`,
                            }}
                          />
                          {Math.round(animal.environment.windDirectionDeg)}°
                        </span>
                      )}
                    </>
                  ) : (
                    'Unavailable'
                  )}
                </div>
              </div>

              {hasMarineMetrics && (
                <div className="col-span-2 rounded-lg bg-sky-950/30 px-2.5 py-1.5 border border-sky-500/25">
                  <div className="flex items-center gap-1 text-[9px] uppercase text-sky-300/80">
                    <Waves className="h-2.5 w-2.5" />
                    <span>Marine Oceanography</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
                    <span>
                      SST{' '}
                      <strong className="text-sky-200">
                        {animal.environment.seaSurfaceTempC !== null
                          ? `${animal.environment.seaSurfaceTempC.toFixed(1)} °C`
                          : '—'}
                      </strong>
                    </span>
                    <span>
                      Waves{' '}
                      <strong className="text-sky-200">
                        {animal.environment.waveHeightMeters !== null
                          ? `${animal.environment.waveHeightMeters.toFixed(2)} m`
                          : '—'}
                      </strong>
                    </span>
                    <span>
                      Current{' '}
                      <strong className="text-sky-200">
                        {animal.environment.oceanCurrentKmh !== null
                          ? `${animal.environment.oceanCurrentKmh.toFixed(2)} km/h`
                          : '—'}
                      </strong>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-[9.5px] font-mono text-slate-500 tabular-telemetry">
              <span className="inline-flex items-center gap-1">
                <Compass className="h-2.5 w-2.5" />
                Heading {Math.round(animal.kinematics.currentBearingDeg)}° (
                {animal.kinematics.currentCardinal})
              </span>
              <span>
                Avg {formatNumber(animal.kinematics.avgSpeedKmh, 1)} km/h
              </span>
            </div>
          </div>
        </section>

        {/* Ecological Intelligence */}
        <section aria-label="Ecological Intelligence" className="space-y-1.5">
          <div className="hud-section-label flex items-center gap-1.5">
            <BookOpen className="h-3 w-3 text-violet-300" />
            <span>Ecological Intelligence</span>
          </div>

          <div className="hud-card rounded-xl p-2.5 space-y-2">
            {taxonomyCrumbs.length > 0 && (
              <div className="select-text flex flex-wrap items-center gap-1 font-mono text-[9.5px] text-slate-400">
                {taxonomyCrumbs.map((taxon, idx) => (
                  <span key={`${taxon}-${idx}`} className="inline-flex items-center gap-1">
                    {idx > 0 && <span className="text-slate-600">&rsaquo;</span>}
                    <span
                      className={
                        idx >= taxonomyCrumbs.length - 2
                          ? 'italic text-cyan-200'
                          : 'text-slate-300'
                      }
                    >
                      {taxon}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <p className="select-text text-[11.5px] leading-relaxed text-slate-300">
              {animal.ecology.summaryExtract ||
                'Bio-logging telemetry profile without supplemental species abstract.'}
            </p>

            {animal.ecology.wikiUrl && (
              <a
                href={animal.ecology.wikiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
              >
                <span>Species Reference Brief</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </section>

        {/* Researcher Attribution Footer */}
        <footer
          aria-label="Researcher Attribution"
          className="hud-card rounded-xl p-2.5 space-y-1.5 border-cyan-400/20"
        >
          <div className="hud-section-label flex items-center gap-1.5 text-cyan-300/90">
            <FileText className="h-3 w-3" />
            <span>Researcher Attribution &amp; Provenance</span>
          </div>

          <div className="space-y-1 text-[11px]">
            <div className="select-text font-semibold text-slate-100">
              {animal.attribution.studyTitle}
            </div>
            <div className="text-slate-300">
              <span className="text-slate-500">PI:</span>{' '}
              <span className="select-text">{animal.attribution.principalInvestigators}</span>
            </div>
            <div className="text-slate-300">
              <span className="text-slate-500">Institution:</span>{' '}
              <span className="select-text">{animal.attribution.institution}</span>
            </div>
            <div className="text-slate-400 text-[10.5px]">
              <span className="text-slate-500">License:</span>{' '}
              <span className="select-text">{animal.attribution.licenseTerms}</span>
            </div>

            {animal.attribution.studyUrl && (
              <div className="pt-0.5">
                <a
                  href={animal.attribution.studyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan-300 hover:text-cyan-200 underline underline-offset-2 break-all"
                >
                  <span>{animal.attribution.studyUrl}</span>
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                </a>
              </div>
            )}

            <div className="mt-1.5 rounded-lg border border-slate-800 bg-obsidian-950/70 p-2">
              <div className="text-[9px] font-mono uppercase tracking-wider text-slate-500">
                Suggested Data Citation
              </div>
              <p className="mt-0.5 select-text font-mono text-[9.5px] leading-relaxed text-slate-400 break-words">
                {buildCitationText(animal)}
              </p>
            </div>
          </div>
        </footer>
      </div>
    </aside>
  );
}

export default AnimalBioDossier;
