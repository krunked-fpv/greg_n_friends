import type {
  AnimalDossier,
  InterpolatedAnimalFrame,
  TelemetryFix,
} from '../../types/telemetry';
import {
  computeBearingDeg,
  haversineDistanceKm,
  normalizeLongitudeDeg,
  shortestDeltaLonDeg,
} from './math';

interface IndexedFix {
  fix: TelemetryFix;
  rawIndex: number;
}

function interpolateNullable(
  a: number | null,
  b: number | null,
  alpha: number,
): number | null {
  const aValid = a !== null && Number.isFinite(a);
  const bValid = b !== null && Number.isFinite(b);
  if (aValid && bValid) {
    return a + (b - a) * alpha;
  }
  if (aValid) return a;
  if (bValid) return b;
  return null;
}

/**
 * Circular spherical linear interpolation (shortest angular arc) between two compass bearings [0, 360).
 */
export function slerpBearingDeg(
  bearingA: number,
  bearingB: number,
  alpha: number,
): number {
  if (!Number.isFinite(bearingA) || !Number.isFinite(bearingB)) {
    return Number.isFinite(bearingA)
      ? ((bearingA % 360) + 360) % 360
      : Number.isFinite(bearingB)
        ? ((bearingB % 360) + 360) % 360
        : 0;
  }
  const t = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0));
  const a = ((bearingA % 360) + 360) % 360;
  const b = ((bearingB % 360) + 360) % 360;
  const delta = ((((b - a + 540) % 360) + 360) % 360) - 180;
  const result = (((a + delta * t) % 360) + 360) % 360;
  return result >= 360 || result === 0 ? 0 : result;
}

function resolveSegmentBearing(lo: TelemetryFix, hi: TelemetryFix): number {
  const dist = haversineDistanceKm(lo.lat, lo.lon, hi.lat, hi.lon);
  if (dist > 0.001) {
    return computeBearingDeg(lo.lat, lo.lon, hi.lat, hi.lon);
  }
  if (hi.headingDeg !== null && Number.isFinite(hi.headingDeg)) {
    return hi.headingDeg;
  }
  if (lo.headingDeg !== null && Number.isFinite(lo.headingDeg)) {
    return lo.headingDeg;
  }
  return 0;
}

function buildValidIndexedTrack(fixes: readonly TelemetryFix[]): IndexedFix[] {
  const nonSpikes: IndexedFix[] = [];
  for (let i = 0; i < fixes.length; i += 1) {
    const fix = fixes[i]!;
    if (
      !fix.isOutlierSpike &&
      Number.isFinite(fix.timestampMs) &&
      Number.isFinite(fix.lat) &&
      Number.isFinite(fix.lon)
    ) {
      nonSpikes.push({ fix, rawIndex: i });
    }
  }
  if (nonSpikes.length > 0) return nonSpikes;

  const fallback: IndexedFix[] = [];
  for (let i = 0; i < fixes.length; i += 1) {
    const fix = fixes[i]!;
    if (
      Number.isFinite(fix.timestampMs) &&
      Number.isFinite(fix.lat) &&
      Number.isFinite(fix.lon)
    ) {
      fallback.push({ fix, rawIndex: i });
    }
  }
  return fallback;
}

function frameFromSingleFix(
  animal: AnimalDossier,
  entry: IndexedFix,
  targetMs: number,
): InterpolatedAnimalFrame {
  const { fix, rawIndex } = entry;
  return {
    animalId: animal.id,
    nickname: animal.nickname,
    commonName: animal.commonName,
    scientificName: animal.scientificName,
    guild: animal.guild,
    feedStatus: animal.feedStatus,
    colorHex: animal.colorHex,
    lat: fix.lat,
    lon: normalizeLongitudeDeg(fix.lon),
    bearingDeg:
      fix.headingDeg !== null && Number.isFinite(fix.headingDeg)
        ? ((fix.headingDeg % 360) + 360) % 360
        : animal.kinematics.currentBearingDeg,
    speedKmh:
      fix.groundSpeedKmh !== null && Number.isFinite(fix.groundSpeedKmh)
        ? fix.groundSpeedKmh
        : 0,
    altitudeOrDepthMeters:
      fix.altitudeOrDepthMeters !== null &&
      Number.isFinite(fix.altitudeOrDepthMeters)
        ? fix.altitudeOrDepthMeters
        : null,
    accuracyRadiusMeters:
      fix.accuracyRadiusMeters !== null &&
      Number.isFinite(fix.accuracyRadiusMeters)
        ? fix.accuracyRadiusMeters
        : null,
    argosLc: fix.argosLc,
    timestampMs: targetMs,
    activeTrailIndex: rawIndex,
  };
}

/**
 * O(log N) binary-search temporal interpolator for a single animal track.
 * Handles ±180° antimeridian wrapping, circular bearing slerp, spike skipping,
 * and null-safe sensor interpolation.
 */
export function interpolateAnimalAtTimestamp(
  animal: AnimalDossier,
  timestampMs: number,
): InterpolatedAnimalFrame | null {
  const track = buildValidIndexedTrack(animal.fixes);
  if (track.length === 0) return null;

  const safeTargetMs = Number.isFinite(timestampMs)
    ? timestampMs
    : track[track.length - 1]!.fix.timestampMs;

  if (track.length === 1) {
    return frameFromSingleFix(animal, track[0]!, safeTargetMs);
  }

  const first = track[0]!;
  if (safeTargetMs <= first.fix.timestampMs) {
    return frameFromSingleFix(animal, first, safeTargetMs);
  }

  const last = track[track.length - 1]!;
  if (safeTargetMs >= last.fix.timestampMs) {
    return frameFromSingleFix(animal, last, safeTargetMs);
  }

  // Binary search for largest index `lo` with track[lo].fix.timestampMs <= safeTargetMs
  let left = 0;
  let right = track.length - 1;
  while (left + 1 < right) {
    const mid = (left + right) >> 1;
    if (track[mid]!.fix.timestampMs <= safeTargetMs) {
      left = mid;
    } else {
      right = mid;
    }
  }

  const loEntry = track[left]!;
  const hiEntry = track[right]!;
  const lo = loEntry.fix;
  const hi = hiEntry.fix;
  const spanMs = hi.timestampMs - lo.timestampMs;
  const alpha =
    spanMs > 0
      ? Math.max(0, Math.min(1, (safeTargetMs - lo.timestampMs) / spanMs))
      : 0;

  const lat = lo.lat + (hi.lat - lo.lat) * alpha;
  const dLon = shortestDeltaLonDeg(lo.lon, hi.lon);
  const lon = normalizeLongitudeDeg(lo.lon + dLon * alpha);

  const segBearing = resolveSegmentBearing(lo, hi);
  const b0 =
    lo.headingDeg !== null && Number.isFinite(lo.headingDeg)
      ? lo.headingDeg
      : segBearing;
  const b1 =
    hi.headingDeg !== null && Number.isFinite(hi.headingDeg)
      ? hi.headingDeg
      : segBearing;
  const bearingDeg = slerpBearingDeg(b0, b1, alpha);

  const fallbackSpeed =
    spanMs > 0
      ? haversineDistanceKm(lo.lat, lo.lon, hi.lat, hi.lon) /
        (spanMs / 3_600_000)
      : 0;
  const interpSpeed = interpolateNullable(
    lo.groundSpeedKmh,
    hi.groundSpeedKmh,
    alpha,
  );
  const speedKmh =
    interpSpeed !== null && Number.isFinite(interpSpeed)
      ? interpSpeed
      : Number.isFinite(fallbackSpeed)
        ? fallbackSpeed
        : 0;

  const altitudeOrDepthMeters = interpolateNullable(
    lo.altitudeOrDepthMeters,
    hi.altitudeOrDepthMeters,
    alpha,
  );
  const accuracyRadiusMeters = interpolateNullable(
    lo.accuracyRadiusMeters,
    hi.accuracyRadiusMeters,
    alpha,
  );

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
    bearingDeg,
    speedKmh,
    altitudeOrDepthMeters,
    accuracyRadiusMeters,
    argosLc: alpha < 0.5 ? lo.argosLc : hi.argosLc,
    timestampMs: safeTargetMs,
    activeTrailIndex: loEntry.rawIndex,
  };
}

/**
 * Batch interpolates every valid animal in the fleet at a given UTC epoch timestamp.
 */
export function interpolateFleetAtTimestamp(
  animals: readonly AnimalDossier[],
  timestampMs: number,
): InterpolatedAnimalFrame[] {
  const frames: InterpolatedAnimalFrame[] = [];
  for (let i = 0; i < animals.length; i += 1) {
    const frame = interpolateAnimalAtTimestamp(animals[i]!, timestampMs);
    if (frame) {
      frames.push(frame);
    }
  }
  return frames;
}
