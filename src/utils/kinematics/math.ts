import type {
  AnimalKinematics,
  ArgosLocationClass,
  DailyDistanceBucket,
  EcologicalGuild,
  TelemetryFix,
} from '../../types/telemetry';

export const EARTH_RADIUS_KM = 6371;
export const DAY_MS = 24 * 3600 * 1000;

export const ARGOS_UNCERTAINTY_METERS: Record<
  Exclude<ArgosLocationClass, null>,
  number
> = {
  G: 35,
  '3': 250,
  '2': 500,
  '1': 1500,
  '0': 3000,
  A: 5000,
  B: 10000,
  Z: 15000,
};

const COMPASS_16_WINDS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

const ARGOS_LOW_QUALITY_CLASSES = new Set<string>(['A', 'B', 'Z']);

const ARGOS_GUILD_MAX_SPEED_KMH: Record<EcologicalGuild, number> = {
  AVIAN: 140,
  MARINE: 65,
  TERRESTRIAL: 75,
  REPTILE: 28,
};

const EXTREME_TELEPORT_SPEED_KMH = 500;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampLat(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-90, Math.min(90, lat));
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Normalizes any longitude into [-180, 180], preserving exact +/-180 endpoints.
 */
export function normalizeLongitudeDeg(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  if (lon >= -180 && lon <= 180) {
    return lon === 0 ? 0 : lon;
  }
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * Computes shortest signed longitudinal arc in [-180, 180] from lon1 to lon2.
 * Uses `((lon2 - lon1 + 540) % 360) - 180` with positive-modulo normalization.
 */
export function shortestDeltaLonDeg(lon1: number, lon2: number): number {
  if (!Number.isFinite(lon1) || !Number.isFinite(lon2)) return 0;
  const a = normalizeLongitudeDeg(lon1);
  const b = normalizeLongitudeDeg(lon2);
  const delta = ((((b - a + 540) % 360) + 360) % 360) - 180;
  return delta === 0 ? 0 : delta;
}

/**
 * Antimeridian-safe Haversine great-circle distance in kilometers.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return 0;
  }

  const phi1 = degToRad(clampLat(lat1));
  const phi2 = degToRad(clampLat(lat2));
  const dLat = phi2 - phi1;
  const dLon = degToRad(shortestDeltaLonDeg(lon1, lon2));

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const a =
    sinDLat * sinDLat +
    Math.cos(phi1) * Math.cos(phi2) * sinDLon * sinDLon;
  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
  return finiteOrZero(EARTH_RADIUS_KM * c);
}

/**
 * Computes initial forward azimuth compass bearing in degrees [0, 360).
 */
export function computeBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return 0;
  }

  const cLat1 = clampLat(lat1);
  const cLat2 = clampLat(lat2);
  const dLonDeg = shortestDeltaLonDeg(lon1, lon2);

  if (Math.abs(cLat2 - cLat1) < 1e-12 && Math.abs(dLonDeg) < 1e-12) {
    return 0;
  }

  const phi1 = degToRad(cLat1);
  const phi2 = degToRad(cLat2);
  const dLon = degToRad(dLonDeg);

  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const rawDeg = radToDeg(Math.atan2(y, x));
  const normalized = ((rawDeg % 360) + 360) % 360;
  if (!Number.isFinite(normalized) || normalized >= 360) return 0;
  return normalized === 0 ? 0 : normalized;
}

/**
 * Converts compass bearing [0, 360) to 16-wind cardinal label (e.g. 'NNE', 'WSW').
 */
export function bearingToCardinal16(bearingDeg: number): string {
  if (!Number.isFinite(bearingDeg)) return 'N';
  const normalized = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.round(normalized / 22.5) % 16;
  return COMPASS_16_WINDS[idx] ?? 'N';
}

/**
 * Normalizes raw location class strings into canonical ArgosLocationClass.
 */
export function normalizeArgosLocationClass(
  raw: string | number | null | undefined,
): ArgosLocationClass {
  if (raw === null || raw === undefined) return null;
  const token = String(raw).trim().toUpperCase();
  if (token in ARGOS_UNCERTAINTY_METERS) {
    return token as Exclude<ArgosLocationClass, null>;
  }
  return null;
}

/**
 * Maps an Argos location class to horizontal uncertainty radius in meters.
 */
export function getArgosUncertaintyMeters(
  argosLc: ArgosLocationClass | string | null | undefined,
): number | null {
  const normalized = normalizeArgosLocationClass(argosLc);
  if (!normalized) return null;
  return ARGOS_UNCERTAINTY_METERS[normalized];
}

/**
 * Formats elapsed milliseconds into a concise human-readable ping freshness badge label.
 */
export function formatPingFreshnessLabel(
  freshnessMs: number,
  hasFixes = true,
): string {
  if (!hasFixes) return 'No pings';
  if (!Number.isFinite(freshnessMs) || freshnessMs < 60_000) {
    return 'Just now';
  }
  const minutes = Math.floor(freshnessMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(freshnessMs / 3_600_000);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(freshnessMs / DAY_MS);
  return `${days}d ago`;
}

function isTeleportSpikeSegment(
  distKm: number,
  dtHours: number,
  argosLc: ArgosLocationClass,
  guild: EcologicalGuild,
): boolean {
  if (!Number.isFinite(distKm)) return true;

  const isLowQualityArgos =
    argosLc !== null && ARGOS_LOW_QUALITY_CLASSES.has(argosLc);

  if (dtHours <= 0) {
    return isLowQualityArgos ? distKm > 10 : distKm > 50;
  }

  const speedKmh = distKm / dtHours;
  if (!Number.isFinite(speedKmh)) return false;

  if (isLowQualityArgos) {
    const guildLimit = ARGOS_GUILD_MAX_SPEED_KMH[guild] ?? 100;
    return distKm > 2 && speedKmh > guildLimit;
  }

  return distKm > 25 && speedKmh > EXTREME_TELEPORT_SPEED_KMH;
}

/**
 * Chronologically sorts, sanitizes, detects Argos A/B/Z teleport spikes,
 * and fills derived segment distances, speeds, bearings, and Argos uncertainty radii.
 */
export function normalizeTelemetryFixes(
  rawFixes: readonly TelemetryFix[],
  guild: EcologicalGuild,
): TelemetryFix[] {
  if (!Array.isArray(rawFixes) || rawFixes.length === 0) {
    return [];
  }

  const validCoords = rawFixes
    .filter(
      (fix) =>
        fix &&
        Number.isFinite(fix.lat) &&
        Number.isFinite(fix.lon) &&
        (Number.isFinite(fix.timestampMs) || Boolean(fix.timestamp)),
    )
    .map((fix) => {
      const parsedMs = Number.isFinite(fix.timestampMs)
        ? fix.timestampMs
        : Date.parse(fix.timestamp);
      const safeMs = Number.isFinite(parsedMs) ? parsedMs : 0;
      const safeIso =
        typeof fix.timestamp === 'string' && fix.timestamp.length > 0
          ? fix.timestamp
          : new Date(safeMs).toISOString();
      const argosLc = normalizeArgosLocationClass(fix.argosLc);
      const accuracyRadiusMeters =
        fix.accuracyRadiusMeters !== null &&
        Number.isFinite(fix.accuracyRadiusMeters) &&
        fix.accuracyRadiusMeters > 0
          ? fix.accuracyRadiusMeters
          : getArgosUncertaintyMeters(argosLc);

      return {
        ...fix,
        timestamp: safeIso,
        timestampMs: safeMs,
        lat: clampLat(fix.lat),
        lon: normalizeLongitudeDeg(fix.lon),
        altitudeOrDepthMeters:
          fix.altitudeOrDepthMeters !== null &&
          Number.isFinite(fix.altitudeOrDepthMeters)
            ? fix.altitudeOrDepthMeters
            : null,
        groundSpeedKmh:
          fix.groundSpeedKmh !== null &&
          Number.isFinite(fix.groundSpeedKmh) &&
          fix.groundSpeedKmh >= 0
            ? fix.groundSpeedKmh
            : null,
        headingDeg:
          fix.headingDeg !== null && Number.isFinite(fix.headingDeg)
            ? ((fix.headingDeg % 360) + 360) % 360
            : null,
        externalTempC:
          fix.externalTempC !== null && Number.isFinite(fix.externalTempC)
            ? fix.externalTempC
            : null,
        tagVoltage:
          fix.tagVoltage !== null && Number.isFinite(fix.tagVoltage)
            ? fix.tagVoltage
            : null,
        argosLc,
        accuracyRadiusMeters,
      };
    });

  validCoords.sort((a, b) => a.timestampMs - b.timestampMs);

  const normalized: TelemetryFix[] = [];
  let prevValid: TelemetryFix | null = null;

  for (const fix of validCoords) {
    if (!prevValid) {
      const initialFix: TelemetryFix = {
        ...fix,
        segmentDistanceKm: 0,
        isOutlierSpike: false,
        speedIsDerived: fix.groundSpeedKmh === null ? false : fix.speedIsDerived,
        headingDeg: fix.headingDeg,
      };
      normalized.push(initialFix);
      prevValid = initialFix;
      continue;
    }

    const dtMs = Math.max(0, fix.timestampMs - prevValid.timestampMs);
    const dtHours = dtMs / 3_600_000;
    const distKm = haversineDistanceKm(
      prevValid.lat,
      prevValid.lon,
      fix.lat,
      fix.lon,
    );

    const spike =
      fix.isOutlierSpike ||
      isTeleportSpikeSegment(distKm, dtHours, fix.argosLc, guild);

    if (spike) {
      normalized.push({
        ...fix,
        segmentDistanceKm: 0,
        isOutlierSpike: true,
        groundSpeedKmh: fix.speedIsDerived ? null : fix.groundSpeedKmh,
      });
      // Preserve prevValid so subsequent real pings do not inherit the spike anchor.
      continue;
    }

    const hasHardwareSpeed =
      fix.groundSpeedKmh !== null &&
      Number.isFinite(fix.groundSpeedKmh) &&
      !fix.speedIsDerived;
    const derivedSpeed =
      dtHours > 0 ? finiteOrZero(distKm / dtHours) : 0;
    const groundSpeedKmh = hasHardwareSpeed
      ? fix.groundSpeedKmh
      : roundTo(derivedSpeed, 2);
    const speedIsDerived = !hasHardwareSpeed;

    const computedHeading =
      distKm > 0.001
        ? roundTo(
            computeBearingDeg(prevValid.lat, prevValid.lon, fix.lat, fix.lon),
            2,
          )
        : prevValid.headingDeg ?? 0;

    const nextFix: TelemetryFix = {
      ...fix,
      segmentDistanceKm: roundTo(distKm, 4),
      isOutlierSpike: false,
      groundSpeedKmh,
      speedIsDerived,
      headingDeg: fix.headingDeg ?? computedHeading,
    };

    normalized.push(nextFix);
    prevValid = nextFix;
  }

  return normalized;
}

/**
 * Computes full bio-kinematics metrics for an animal track.
 * Guaranteed never to emit NaN or Infinity across 0-fix, 1-fix,
 * duplicate-timestamp, or all-null sensor tracks.
 */
export function computeAnimalKinematics(
  fixes: readonly TelemetryFix[],
  guild: EcologicalGuild,
  referenceNowMs: number = Date.now(),
): AnimalKinematics {
  const safeNowMs = Number.isFinite(referenceNowMs)
    ? referenceNowMs
    : Date.now();
  const normalized = normalizeTelemetryFixes(fixes, guild);

  if (normalized.length === 0) {
    return {
      totalDistanceKm: 0,
      displacement24hKm: 0,
      distance24hKm: 0,
      avgSpeedKmh: 0,
      maxSpeedKmh: 0,
      currentSpeedKmh: 0,
      currentBearingDeg: 0,
      currentCardinal: 'N',
      pingFreshnessMs: 365 * DAY_MS,
      pingFreshnessLabel: formatPingFreshnessLabel(365 * DAY_MS, false),
      daysTracked: 0,
      dailyDistanceSeries: [],
      hasAltitudeOrDepth: false,
    };
  }

  const validFixes = normalized.filter((fix) => !fix.isOutlierSpike);
  const activeSeries = validFixes.length > 0 ? validFixes : normalized;
  const firstFix = activeSeries[0]!;
  const latestFix = activeSeries[activeSeries.length - 1]!;

  let totalDistanceKm = 0;
  let speedSum = 0;
  let speedCount = 0;
  let maxSpeedKmh = 0;
  let hasAltitudeOrDepth = false;

  const dailyBuckets = new Map<
    string,
    { distanceKm: number; fixCount: number; speedSum: number; speedCount: number }
  >();

  for (let i = 0; i < normalized.length; i += 1) {
    const fix = normalized[i]!;
    if (
      fix.altitudeOrDepthMeters !== null &&
      Number.isFinite(fix.altitudeOrDepthMeters)
    ) {
      hasAltitudeOrDepth = true;
    }

    if (fix.isOutlierSpike) continue;

    const segDist = finiteOrZero(fix.segmentDistanceKm);
    totalDistanceKm += segDist;

    const speed =
      fix.groundSpeedKmh !== null && Number.isFinite(fix.groundSpeedKmh)
        ? fix.groundSpeedKmh
        : null;
    if (speed !== null) {
      speedSum += speed;
      speedCount += 1;
      if (speed > maxSpeedKmh) maxSpeedKmh = speed;
    }

    const dateIso = new Date(fix.timestampMs).toISOString().slice(0, 10);
    let bucket = dailyBuckets.get(dateIso);
    if (!bucket) {
      bucket = { distanceKm: 0, fixCount: 0, speedSum: 0, speedCount: 0 };
      dailyBuckets.set(dateIso, bucket);
    }
    bucket.distanceKm += segDist;
    bucket.fixCount += 1;
    if (speed !== null) {
      bucket.speedSum += speed;
      bucket.speedCount += 1;
    }
  }

  // Trailing 24h window relative to the animal's latest valid fix
  const cutoff24hMs = latestFix.timestampMs - DAY_MS;
  const fixes24h = activeSeries.filter((f) => f.timestampMs >= cutoff24hMs);
  let displacement24hKm = 0;
  let distance24hKm = 0;

  if (fixes24h.length >= 2) {
    const start24h = fixes24h[0]!;
    const end24h = fixes24h[fixes24h.length - 1]!;
    displacement24hKm = haversineDistanceKm(
      start24h.lat,
      start24h.lon,
      end24h.lat,
      end24h.lon,
    );
    for (let i = 1; i < fixes24h.length; i += 1) {
      distance24hKm += finiteOrZero(fixes24h[i]!.segmentDistanceKm);
    }
    if (displacement24hKm > distance24hKm) {
      displacement24hKm = distance24hKm;
    }
  }

  let currentBearingDeg = latestFix.headingDeg ?? 0;
  for (let i = activeSeries.length - 2; i >= 0; i -= 1) {
    const candidate = activeSeries[i]!;
    const dist = haversineDistanceKm(
      candidate.lat,
      candidate.lon,
      latestFix.lat,
      latestFix.lon,
    );
    if (dist > 0.001) {
      currentBearingDeg = computeBearingDeg(
        candidate.lat,
        candidate.lon,
        latestFix.lat,
        latestFix.lon,
      );
      break;
    }
  }
  currentBearingDeg = roundTo(finiteOrZero(currentBearingDeg), 1);
  const currentCardinal = bearingToCardinal16(currentBearingDeg);

  const latestOverallFix = normalized[normalized.length - 1]!;
  const pingFreshnessMs = Math.max(0, safeNowMs - latestOverallFix.timestampMs);
  const pingFreshnessLabel = formatPingFreshnessLabel(pingFreshnessMs, true);

  const spanMs = Math.max(0, latestFix.timestampMs - firstFix.timestampMs);
  const daysTracked = Math.max(1, roundTo(spanMs / DAY_MS, 1));

  const dailyDistanceSeries: DailyDistanceBucket[] = Array.from(
    dailyBuckets.entries(),
  )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dateIso, bucket]) => ({
      dateIso,
      distanceKm: roundTo(bucket.distanceKm, 2),
      fixCount: bucket.fixCount,
      avgSpeedKmh:
        bucket.speedCount > 0
          ? roundTo(bucket.speedSum / bucket.speedCount, 2)
          : 0,
    }));

  const avgSpeedKmh = speedCount > 0 ? speedSum / speedCount : 0;
  const currentSpeedKmh =
    latestFix.groundSpeedKmh !== null &&
    Number.isFinite(latestFix.groundSpeedKmh)
      ? latestFix.groundSpeedKmh
      : 0;

  return {
    totalDistanceKm: roundTo(totalDistanceKm, 2),
    displacement24hKm: roundTo(displacement24hKm, 2),
    distance24hKm: roundTo(distance24hKm, 2),
    avgSpeedKmh: roundTo(avgSpeedKmh, 2),
    maxSpeedKmh: roundTo(maxSpeedKmh, 2),
    currentSpeedKmh: roundTo(currentSpeedKmh, 2),
    currentBearingDeg,
    currentCardinal,
    pingFreshnessMs: finiteOrZero(pingFreshnessMs),
    pingFreshnessLabel,
    daysTracked,
    dailyDistanceSeries,
    hasAltitudeOrDepth,
  };
}
