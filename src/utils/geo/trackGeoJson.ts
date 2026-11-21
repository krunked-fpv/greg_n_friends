import type {
  AnimalDossier,
  ArgosLocationClass,
  EcologicalGuild,
  FeedStatus,
  InterpolatedAnimalFrame,
  SensorType,
  TelemetryFix,
  TrackColorMode,
} from '../../types/telemetry';
import type { PlaybackSyncMode } from '../../store/playbackClock';
import {
  clampLat,
  normalizeLon,
  shortestDeltaLon,
  splitSegmentAtAntimeridian,
} from './antimeridian';
import { createArgosUncertaintyGeometry } from './uncertaintyCircle';

export interface LegendStop {
  label: string;
  color: string;
}

export interface TrackLegendSpec {
  mode: TrackColorMode;
  title: string;
  unit: string;
  stops: LegendStop[];
  gradientCss: string;
}

export const TRACK_LEGEND_SPECS: Record<TrackColorMode, TrackLegendSpec> = {
  speed: {
    mode: 'speed',
    title: 'Ground Speed',
    unit: 'km/h',
    stops: [
      { label: '0', color: '#60a5fa' },
      { label: '5', color: '#22d3ee' },
      { label: '20', color: '#10b981' },
      { label: '45', color: '#f59e0b' },
      { label: '80+', color: '#f43f5e' },
    ],
    gradientCss:
      'linear-gradient(90deg, #60a5fa 0%, #22d3ee 25%, #10b981 50%, #f59e0b 75%, #f43f5e 100%)',
  },
  altitude: {
    mode: 'altitude',
    title: 'Altitude / Depth',
    unit: 'm',
    stops: [
      { label: '-1000m', color: '#a855f7' },
      { label: '-300m', color: '#3b82f6' },
      { label: '0m', color: '#2dd4bf' },
      { label: '+500m', color: '#f59e0b' },
      { label: '+3000m', color: '#fde047' },
    ],
    gradientCss:
      'linear-gradient(90deg, #a855f7 0%, #3b82f6 25%, #2dd4bf 50%, #f59e0b 75%, #fde047 100%)',
  },
  recency: {
    mode: 'recency',
    title: 'Ping Recency',
    unit: 'age',
    stops: [
      { label: '<6h', color: '#10b981' },
      { label: '24h', color: '#22d3ee' },
      { label: '3d', color: '#38bdf8' },
      { label: '7d', color: '#a78bfa' },
      { label: '>14d', color: '#64748b' },
    ],
    gradientCss:
      'linear-gradient(90deg, #10b981 0%, #22d3ee 25%, #38bdf8 50%, #a78bfa 75%, #64748b 100%)',
  },
  animal: {
    mode: 'animal',
    title: 'Individual Signature',
    unit: 'id',
    stops: [
      { label: 'Distinct per tagged individual', color: '#22d3ee' },
    ],
    gradientCss:
      'linear-gradient(90deg, #22d3ee 0%, #10b981 33%, #f59e0b 66%, #f43f5e 100%)',
  },
};

type RgbStop = [number, [number, number, number]];

const SPEED_STOPS: RgbStop[] = [
  [0, [96, 165, 250]],   // #60a5fa
  [5, [34, 211, 238]],   // #22d3ee
  [20, [16, 185, 129]],  // #10b981
  [45, [245, 158, 11]],  // #f59e0b
  [80, [244, 63, 94]],   // #f43f5e
];

const ALTITUDE_STOPS: RgbStop[] = [
  [-1000, [168, 85, 247]],  // #a855f7
  [-300, [59, 130, 246]],   // #3b82f6
  [-20, [56, 189, 248]],    // #38bdf8
  [0, [45, 212, 191]],      // #2dd4bf
  [500, [245, 158, 11]],    // #f59e0b
  [3000, [253, 224, 71]],   // #fde047
];

const RECENCY_HOURS_STOPS: RgbStop[] = [
  [0, [16, 185, 129]],     // #10b981 (< 6h)
  [24, [34, 211, 238]],    // #22d3ee (24h)
  [72, [56, 189, 248]],    // #38bdf8 (3d)
  [168, [167, 139, 250]],  // #a78bfa (7d)
  [336, [100, 116, 139]],  // #64748b (> 14d)
];

function toHexByte(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, '0');
}

function interpolateColorStops(value: number, stops: readonly RgbStop[]): string {
  if (!Number.isFinite(value) || stops.length === 0) return '#22d3ee';
  if (value <= stops[0][0]) {
    const [r, g, b] = stops[0][1];
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  }
  const last = stops[stops.length - 1];
  if (value >= last[0]) {
    const [r, g, b] = last[1];
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  }

  for (let i = 1; i < stops.length; i += 1) {
    const [v0, c0] = stops[i - 1];
    const [v1, c1] = stops[i];
    if (value <= v1) {
      const t = v1 > v0 ? (value - v0) / (v1 - v0) : 0;
      const r = c0[0] + t * (c1[0] - c0[0]);
      const g = c0[1] + t * (c1[1] - c0[1]);
      const b = c0[2] + t * (c1[2] - c0[2]);
      return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
    }
  }
  return '#22d3ee';
}

export function getSegmentColor(
  mode: TrackColorMode,
  fix: TelemetryFix,
  _prevFix: TelemetryFix | null,
  animal: AnimalDossier,
  referenceMs: number,
): string {
  switch (mode) {
    case 'speed': {
      if (fix.groundSpeedKmh === null || !Number.isFinite(fix.groundSpeedKmh)) {
        return '#38bdf8';
      }
      return interpolateColorStops(Math.max(0, fix.groundSpeedKmh), SPEED_STOPS);
    }
    case 'altitude': {
      if (
        fix.altitudeOrDepthMeters === null ||
        !Number.isFinite(fix.altitudeOrDepthMeters)
      ) {
        return '#64748b';
      }
      return interpolateColorStops(fix.altitudeOrDepthMeters, ALTITUDE_STOPS);
    }
    case 'recency': {
      const ageHours = Math.max(0, (referenceMs - fix.timestampMs) / 3_600_000);
      return interpolateColorStops(ageHours, RECENCY_HOURS_STOPS);
    }
    case 'animal':
    default:
      return animal.colorHex || '#22d3ee';
  }
}

export interface TrackSegmentProperties {
  animalId: string;
  nickname: string;
  color: string;
  speedKmh: number | null;
  altitudeOrDepthMeters: number | null;
  timestampMs: number;
  startMs: number;
  endMs: number;
  isSelected: boolean;
  opacity: number;
}

export interface FixMarkerProperties {
  id: string;
  animalId: string;
  nickname: string;
  commonName: string;
  scientificName: string;
  guild: EcologicalGuild;
  feedStatus: FeedStatus;
  colorHex: string;
  timestamp: string;
  timestampMs: number;
  lat: number;
  lon: number;
  altitudeOrDepthMeters: number | null;
  groundSpeedKmh: number | null;
  speedIsDerived: boolean;
  headingDeg: number | null;
  externalTempC: number | null;
  tagVoltage: number | null;
  argosLc: ArgosLocationClass;
  accuracyRadiusMeters: number | null;
  sensorType: SensorType;
  isOutlierSpike: boolean;
  isHovered: boolean;
  isSelected: boolean;
}

export interface HeadBeaconProperties {
  animalId: string;
  nickname: string;
  commonName: string;
  scientificName: string;
  guild: EcologicalGuild;
  feedStatus: FeedStatus;
  colorHex: string;
  bearingDeg: number;
  speedKmh: number;
  altitudeOrDepthMeters: number | null;
  timestamp: string;
  timestampMs: number;
  lat: number;
  lon: number;
  argosLc: ArgosLocationClass;
  accuracyRadiusMeters: number | null;
  isSelected: boolean;
  label: string;
}

export interface UncertaintyPolygonProperties {
  animalId: string;
  nickname: string;
  argosLc: ArgosLocationClass;
  radiusMeters: number;
  colorHex: string;
  isSelected: boolean;
  isHovered: boolean;
}

export interface FleetGeoJsonBundle {
  tracks: GeoJSON.FeatureCollection<GeoJSON.LineString, TrackSegmentProperties>;
  fixes: GeoJSON.FeatureCollection<GeoJSON.Point, FixMarkerProperties>;
  uncertainty: GeoJSON.FeatureCollection<
    GeoJSON.Polygon | GeoJSON.MultiPolygon,
    UncertaintyPolygonProperties
  >;
  heads: GeoJSON.FeatureCollection<GeoJSON.Point, HeadBeaconProperties>;
  renderedAnimalCount: number;
  renderedSegmentCount: number;
  renderedHeadCount: number;
}

interface PrecomputedAnimalTrack {
  animal: AnimalDossier;
  isSelected: boolean;
  opacity: number;
  nonOutliers: TelemetryFix[];
  allValidFixes: TelemetryFix[];
  segments: GeoJSON.Feature<GeoJSON.LineString, TrackSegmentProperties>[];
  fixFeatures: GeoJSON.Feature<GeoJSON.Point, FixMarkerProperties>[];
}

export interface PrecomputedTrackIndex {
  mode: TrackColorMode;
  selectedAnimalId: string | null;
  referenceMs: number;
  entries: PrecomputedAnimalTrack[];
}

export interface BuildFleetGeoJsonOptions {
  trackColorMode: TrackColorMode;
  selectedAnimalId?: string | null;
  windowStartMs?: number;
  windowEndMs?: number;
  currentMs?: number;
  syncMode?: PlaybackSyncMode;
  hoveredFixMs?: number | null;
  frames?: InterpolatedAnimalFrame[];
  referenceMs?: number;
}

function isValidCoordFix(fix: TelemetryFix): boolean {
  return (
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lon) &&
    Number.isFinite(fix.timestampMs)
  );
}

/**
 * Precomputes antimeridian-split LineString segments and Point fix markers per animal
 * so 60fps playback ticks slice trails without repeating coordinate splitting math.
 */
export function buildPrecomputedTrackIndex(
  animals: readonly AnimalDossier[],
  mode: TrackColorMode,
  selectedAnimalId: string | null,
  referenceMs: number,
): PrecomputedTrackIndex {
  const entries: PrecomputedAnimalTrack[] = [];

  for (const animal of animals) {
    const isSelected = selectedAnimalId !== null && animal.id === selectedAnimalId;
    const opacity = selectedAnimalId === null || isSelected ? 0.92 : 0.34;
    const validFixes = animal.fixes
      .filter(isValidCoordFix)
      .slice()
      .sort((a, b) => a.timestampMs - b.timestampMs);

    const cleanFixes = validFixes.filter((f) => !f.isOutlierSpike);
    const trajectoryFixes =
      cleanFixes.length >= 2 || validFixes.length < 2 ? cleanFixes : validFixes;

    const segments: GeoJSON.Feature<GeoJSON.LineString, TrackSegmentProperties>[] = [];
    for (let i = 1; i < trajectoryFixes.length; i += 1) {
      const f1 = trajectoryFixes[i - 1];
      const f2 = trajectoryFixes[i];
      const color = getSegmentColor(mode, f2, f1, animal, referenceMs);
      const splitPieces = splitSegmentAtAntimeridian(
        [f1.lon, f1.lat],
        [f2.lon, f2.lat],
      );

      for (const piece of splitPieces) {
        if (piece.length < 2) continue;
        segments.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: piece,
          },
          properties: {
            animalId: animal.id,
            nickname: animal.nickname,
            color,
            speedKmh: f2.groundSpeedKmh,
            altitudeOrDepthMeters: f2.altitudeOrDepthMeters,
            timestampMs: f2.timestampMs,
            startMs: f1.timestampMs,
            endMs: f2.timestampMs,
            isSelected,
            opacity,
          },
        });
      }
    }

    const fixFeatures: GeoJSON.Feature<GeoJSON.Point, FixMarkerProperties>[] =
      validFixes.map((fix) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [normalizeLon(fix.lon), clampLat(fix.lat)],
        },
        properties: {
          id: fix.id,
          animalId: animal.id,
          nickname: animal.nickname,
          commonName: animal.commonName,
          scientificName: animal.scientificName,
          guild: animal.guild,
          feedStatus: animal.feedStatus,
          colorHex: animal.colorHex || '#22d3ee',
          timestamp: fix.timestamp,
          timestampMs: fix.timestampMs,
          lat: clampLat(fix.lat),
          lon: normalizeLon(fix.lon),
          altitudeOrDepthMeters: fix.altitudeOrDepthMeters,
          groundSpeedKmh: fix.groundSpeedKmh,
          speedIsDerived: fix.speedIsDerived,
          headingDeg: fix.headingDeg,
          externalTempC: fix.externalTempC,
          tagVoltage: fix.tagVoltage,
          argosLc: fix.argosLc,
          accuracyRadiusMeters: fix.accuracyRadiusMeters,
          sensorType: fix.sensorType,
          isOutlierSpike: fix.isOutlierSpike,
          isHovered: false,
          isSelected,
        },
      }));

    entries.push({
      animal,
      isSelected,
      opacity,
      nonOutliers: trajectoryFixes,
      allValidFixes: validFixes,
      segments,
      fixFeatures,
    });
  }

  return {
    mode,
    selectedAnimalId,
    referenceMs,
    entries,
  };
}

function findLatestFixUpTo(
  fixes: readonly TelemetryFix[],
  windowStartMs: number,
  currentMs: number,
): TelemetryFix | null {
  let latest: TelemetryFix | null = null;
  for (let i = fixes.length - 1; i >= 0; i -= 1) {
    const f = fixes[i];
    if (f.timestampMs <= currentMs) {
      if (f.timestampMs >= windowStartMs) {
        return f;
      }
      if (!latest) latest = f;
      break;
    }
  }
  return latest;
}

function interpolateScrubFallback(
  fixes: readonly TelemetryFix[],
  currentMs: number,
  animal: AnimalDossier,
): InterpolatedAnimalFrame | null {
  if (fixes.length === 0 || !Number.isFinite(currentMs)) return null;
  if (currentMs <= fixes[0].timestampMs) {
    const f = fixes[0];
    return {
      animalId: animal.id,
      nickname: animal.nickname,
      commonName: animal.commonName,
      scientificName: animal.scientificName,
      guild: animal.guild,
      feedStatus: animal.feedStatus,
      colorHex: animal.colorHex,
      lat: f.lat,
      lon: f.lon,
      bearingDeg: f.headingDeg ?? animal.kinematics.currentBearingDeg,
      speedKmh: f.groundSpeedKmh ?? 0,
      altitudeOrDepthMeters: f.altitudeOrDepthMeters,
      accuracyRadiusMeters: f.accuracyRadiusMeters,
      argosLc: f.argosLc,
      timestampMs: f.timestampMs,
      activeTrailIndex: 0,
    };
  }
  const lastIdx = fixes.length - 1;
  if (currentMs >= fixes[lastIdx].timestampMs) {
    const f = fixes[lastIdx];
    return {
      animalId: animal.id,
      nickname: animal.nickname,
      commonName: animal.commonName,
      scientificName: animal.scientificName,
      guild: animal.guild,
      feedStatus: animal.feedStatus,
      colorHex: animal.colorHex,
      lat: f.lat,
      lon: f.lon,
      bearingDeg: f.headingDeg ?? animal.kinematics.currentBearingDeg,
      speedKmh: f.groundSpeedKmh ?? 0,
      altitudeOrDepthMeters: f.altitudeOrDepthMeters,
      accuracyRadiusMeters: f.accuracyRadiusMeters,
      argosLc: f.argosLc,
      timestampMs: f.timestampMs,
      activeTrailIndex: lastIdx,
    };
  }

  let lo = 0;
  let hi = lastIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fixes[mid].timestampMs <= currentMs) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const i0 = Math.max(0, hi);
  const i1 = Math.min(lastIdx, i0 + 1);
  const f0 = fixes[i0];
  const f1 = fixes[i1];
  const span = f1.timestampMs - f0.timestampMs;
  const t = span > 0 ? Math.max(0, Math.min(1, (currentMs - f0.timestampMs) / span)) : 0;

  const dLon = shortestDeltaLon(f0.lon, f1.lon);
  const lon = normalizeLon(f0.lon + t * dLon);
  const lat = clampLat(f0.lat + t * (f1.lat - f0.lat));
  const speed0 = f0.groundSpeedKmh ?? 0;
  const speed1 = f1.groundSpeedKmh ?? speed0;
  const alt =
    f0.altitudeOrDepthMeters !== null && f1.altitudeOrDepthMeters !== null
      ? f0.altitudeOrDepthMeters +
        t * (f1.altitudeOrDepthMeters - f0.altitudeOrDepthMeters)
      : f0.altitudeOrDepthMeters ?? f1.altitudeOrDepthMeters;

  return {
    animalId: animal.id,
    nickname: animal.nickname,
    commonName: animal.commonName,
    scientificName: animal.scientificName,
    guild: animal.guild,
    feedStatus: animal.feedStatus,
    colorHex: animal.colorHex,
    lat,
    lon,
    bearingDeg: f1.headingDeg ?? f0.headingDeg ?? animal.kinematics.currentBearingDeg,
    speedKmh: speed0 + t * (speed1 - speed0),
    altitudeOrDepthMeters: alt,
    accuracyRadiusMeters: f0.accuracyRadiusMeters ?? f1.accuracyRadiusMeters,
    argosLc: f0.argosLc ?? f1.argosLc,
    timestampMs: currentMs,
    activeTrailIndex: i0,
  };
}

/**
 * Generates sliced GeoJSON FeatureCollections for tracks, fix markers, Argos uncertainty
 * polygons, and active head beacons at the requested playback window & timestamp.
 */
export function buildFleetGeoJsonFromIndex(
  index: PrecomputedTrackIndex,
  options: BuildFleetGeoJsonOptions,
): FleetGeoJsonBundle {
  const windowStartMs = options.windowStartMs ?? -Infinity;
  const windowEndMs = options.windowEndMs ?? Infinity;
  const currentMs = options.currentMs ?? windowEndMs;
  const hoveredFixMs = options.hoveredFixMs ?? null;
  const syncMode = options.syncMode ?? 'FLEET_SYNC';
  const selectedAnimalId = options.selectedAnimalId ?? index.selectedAnimalId;
  const soloAnimalId =
    syncMode === 'SOLO_ANIMAL' && selectedAnimalId ? selectedAnimalId : null;

  const framesById = new Map<string, InterpolatedAnimalFrame>();
  if (options.frames) {
    for (const frame of options.frames) {
      framesById.set(frame.animalId, frame);
    }
  }

  const trackFeatures: GeoJSON.Feature<GeoJSON.LineString, TrackSegmentProperties>[] =
    [];
  const fixFeatures: GeoJSON.Feature<GeoJSON.Point, FixMarkerProperties>[] = [];
  const uncertaintyFeatures: GeoJSON.Feature<
    GeoJSON.Polygon | GeoJSON.MultiPolygon,
    UncertaintyPolygonProperties
  >[] = [];
  const headFeatures: GeoJSON.Feature<GeoJSON.Point, HeadBeaconProperties>[] = [];

  let renderedAnimalCount = 0;

  for (const entry of index.entries) {
    const { animal, nonOutliers, allValidFixes, segments } = entry;
    const isSelected =
      selectedAnimalId !== null ? animal.id === selectedAnimalId : entry.isSelected;
    const opacity = selectedAnimalId === null || isSelected ? 0.92 : 0.34;

    if (soloAnimalId !== null && animal.id !== soloAnimalId) {
      continue;
    }

    if (allValidFixes.length === 0) {
      continue;
    }

    const firstFixMs = allValidFixes[0].timestampMs;
    const lastFixMs = allValidFixes[allValidFixes.length - 1].timestampMs;
    const isOutsideActiveWindow =
      lastFixMs < windowStartMs || firstFixMs > windowEndMs || firstFixMs > currentMs;

    // Exclude non-selected animals whose telemetry falls completely outside the active
    // time window or before their first fix at currentMs. Selected animals remain visible
    // with their full trajectory and latest fix/beacon even outside the active window.
    if (isOutsideActiveWindow && !isSelected) {
      continue;
    }

    const renderFullSelectedFallback = isSelected && isOutsideActiveWindow;
    let animalHasContent = false;

    for (const seg of segments) {
      if (
        renderFullSelectedFallback ||
        (seg.properties.endMs >= windowStartMs && seg.properties.endMs <= currentMs)
      ) {
        if (seg.properties.isSelected === isSelected && seg.properties.opacity === opacity) {
          trackFeatures.push(seg);
        } else {
          trackFeatures.push({
            ...seg,
            properties: {
              ...seg.properties,
              isSelected,
              opacity,
            },
          });
        }
        animalHasContent = true;
      }
    }

    let hoveredFixForAnimal: FixMarkerProperties | null = null;
    for (const fixFeat of entry.fixFeatures) {
      const ts = fixFeat.properties.timestampMs;
      if (renderFullSelectedFallback || (ts >= windowStartMs && ts <= currentMs)) {
        const isHovered = hoveredFixMs !== null && Math.abs(ts - hoveredFixMs) <= 1000;
        if (
          isHovered !== fixFeat.properties.isHovered ||
          fixFeat.properties.isSelected !== isSelected
        ) {
          fixFeatures.push({
            ...fixFeat,
            properties: {
              ...fixFeat.properties,
              isHovered,
              isSelected,
            },
          });
        } else {
          fixFeatures.push(fixFeat);
        }
        if (isHovered) {
          hoveredFixForAnimal = fixFeat.properties;
        }
        animalHasContent = true;
      }
    }

    const rawFrame = framesById.get(animal.id);
    const frameIsFresh =
      rawFrame !== undefined &&
      Number.isFinite(rawFrame.lat) &&
      Number.isFinite(rawFrame.lon) &&
      (!Number.isFinite(currentMs) ||
        Math.abs(rawFrame.timestampMs - currentMs) <= 60_000 ||
        currentMs >= lastFixMs);
    const frame = frameIsFresh
      ? rawFrame
      : Number.isFinite(currentMs)
        ? interpolateScrubFallback(nonOutliers, currentMs, animal)
        : undefined;
    const fallbackFix =
      findLatestFixUpTo(nonOutliers, windowStartMs, currentMs) ??
      findLatestFixUpTo(allValidFixes, windowStartMs, currentMs);

    // Append interpolated tip segment from last completed fix up to current interpolated head
    if (
      !renderFullSelectedFallback &&
      frame &&
      Number.isFinite(frame.lat) &&
      Number.isFinite(frame.lon) &&
      fallbackFix &&
      currentMs >= fallbackFix.timestampMs &&
      currentMs <= lastFixMs
    ) {
      const tipPieces = splitSegmentAtAntimeridian(
        [fallbackFix.lon, fallbackFix.lat],
        [frame.lon, frame.lat],
      );
      const tipColor = getSegmentColor(
        index.mode,
        {
          ...fallbackFix,
          groundSpeedKmh: frame.speedKmh,
          altitudeOrDepthMeters: frame.altitudeOrDepthMeters,
          timestampMs: frame.timestampMs,
        },
        fallbackFix,
        animal,
        index.referenceMs,
      );
      for (const piece of tipPieces) {
        if (piece.length < 2) continue;
        trackFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: piece,
          },
          properties: {
            animalId: animal.id,
            nickname: animal.nickname,
            color: tipColor,
            speedKmh: frame.speedKmh,
            altitudeOrDepthMeters: frame.altitudeOrDepthMeters,
            timestampMs: frame.timestampMs,
            startMs: fallbackFix.timestampMs,
            endMs: frame.timestampMs,
            isSelected,
            opacity,
          },
        });
        animalHasContent = true;
      }
    }

    // Active head beacon at currentMs (clamped to latestFix if currentMs > lastFixMs or out-of-window selected)
    const latestSelectedFix = renderFullSelectedFallback
      ? nonOutliers[nonOutliers.length - 1] ??
        allValidFixes[allValidFixes.length - 1] ??
        animal.latestFix
      : null;

    const activeFrame =
      !renderFullSelectedFallback &&
      frame &&
      Number.isFinite(frame.lat) &&
      Number.isFinite(frame.lon) &&
      currentMs <= lastFixMs
        ? frame
        : null;

    const anchorFix = latestSelectedFix ?? fallbackFix ?? animal.latestFix;

    const headLat = activeFrame
      ? clampLat(activeFrame.lat)
      : clampLat(anchorFix.lat);
    const headLon = activeFrame
      ? normalizeLon(activeFrame.lon)
      : normalizeLon(anchorFix.lon);
    const headBearing = activeFrame
      ? activeFrame.bearingDeg
      : anchorFix.headingDeg ?? animal.kinematics.currentBearingDeg;
    const headSpeed = activeFrame
      ? activeFrame.speedKmh
      : anchorFix.groundSpeedKmh ?? animal.kinematics.currentSpeedKmh;
    const headAlt = activeFrame
      ? activeFrame.altitudeOrDepthMeters
      : anchorFix.altitudeOrDepthMeters ?? null;
    const headArgos = activeFrame
      ? activeFrame.argosLc
      : anchorFix.argosLc ?? animal.latestFix.argosLc;
    const headAccuracy = activeFrame
      ? activeFrame.accuracyRadiusMeters
      : anchorFix.accuracyRadiusMeters ?? animal.latestFix.accuracyRadiusMeters;
    const headTimestampMs = activeFrame
      ? activeFrame.timestampMs
      : anchorFix.timestampMs ?? animal.latestFix.timestampMs;
    const headTimestampIso = activeFrame
      ? new Date(activeFrame.timestampMs).toISOString()
      : anchorFix.timestamp ?? animal.latestFix.timestamp;

    if (Number.isFinite(headLat) && Number.isFinite(headLon)) {
      headFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [headLon, headLat],
        },
        properties: {
          animalId: animal.id,
          nickname: animal.nickname,
          commonName: animal.commonName,
          scientificName: animal.scientificName,
          guild: animal.guild,
          feedStatus: animal.feedStatus,
          colorHex: animal.colorHex || '#22d3ee',
          bearingDeg: Number.isFinite(headBearing) ? headBearing : 0,
          speedKmh: Number.isFinite(headSpeed) ? headSpeed : 0,
          altitudeOrDepthMeters: headAlt,
          timestamp: headTimestampIso,
          timestampMs: headTimestampMs,
          lat: headLat,
          lon: headLon,
          argosLc: headArgos,
          accuracyRadiusMeters: headAccuracy,
          isSelected,
          label: animal.nickname,
        },
      });
      animalHasContent = true;

      const headUncertainty = createArgosUncertaintyGeometry(
        headLat,
        headLon,
        headArgos,
        headAccuracy,
      );
      if (headUncertainty) {
        uncertaintyFeatures.push({
          type: 'Feature',
          geometry: headUncertainty.geometry,
          properties: {
            animalId: animal.id,
            nickname: animal.nickname,
            argosLc: headArgos,
            radiusMeters: headUncertainty.radiusMeters,
            colorHex: animal.colorHex || '#22d3ee',
            isSelected,
            isHovered: false,
          },
        });
      }
    }

    if (hoveredFixForAnimal) {
      const hoveredUncertainty = createArgosUncertaintyGeometry(
        hoveredFixForAnimal.lat,
        hoveredFixForAnimal.lon,
        hoveredFixForAnimal.argosLc,
        hoveredFixForAnimal.accuracyRadiusMeters,
      );
      if (hoveredUncertainty) {
        uncertaintyFeatures.push({
          type: 'Feature',
          geometry: hoveredUncertainty.geometry,
          properties: {
            animalId: animal.id,
            nickname: animal.nickname,
            argosLc: hoveredFixForAnimal.argosLc,
            radiusMeters: hoveredUncertainty.radiusMeters,
            colorHex: animal.colorHex || '#22d3ee',
            isSelected,
            isHovered: true,
          },
        });
      }
    }

    if (animalHasContent) {
      renderedAnimalCount += 1;
    }
  }

  return {
    tracks: {
      type: 'FeatureCollection',
      features: trackFeatures,
    },
    fixes: {
      type: 'FeatureCollection',
      features: fixFeatures,
    },
    uncertainty: {
      type: 'FeatureCollection',
      features: uncertaintyFeatures,
    },
    heads: {
      type: 'FeatureCollection',
      features: headFeatures,
    },
    renderedAnimalCount,
    renderedSegmentCount: trackFeatures.length,
    renderedHeadCount: headFeatures.length,
  };
}

/**
 * Convenience single-call builder used by tests and static snapshots.
 */
export function buildFleetGeoJson(
  animals: readonly AnimalDossier[],
  options: BuildFleetGeoJsonOptions,
): FleetGeoJsonBundle {
  const index = buildPrecomputedTrackIndex(
    animals,
    options.trackColorMode,
    options.selectedAnimalId ?? null,
    options.referenceMs ?? Date.now(),
  );
  return buildFleetGeoJsonFromIndex(index, options);
}
