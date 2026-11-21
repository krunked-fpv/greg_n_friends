import type {
  AnimalEcology,
  AnimalEnvironment,
  AnimalKinematics,
  ArgosLocationClass,
  DailyDistanceBucket,
  EcologicalGuild,
  IucnStatus,
  SensorType,
  SolarPhase,
  TelemetryFix,
} from '../src/types/telemetry.ts';

const EARTH_RADIUS_KM = 6371.0088;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const DAY_MS = 24 * 3600 * 1000;

export const ARGOS_UNCERTAINTY_RADII_METERS: Record<Exclude<ArgosLocationClass, null>, number> = {
  G: 35,
  '3': 250,
  '2': 500,
  '1': 1500,
  '0': 3000,
  A: 5000,
  B: 10000,
  Z: 15000,
};

const COMPASS_16 = [
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

export function normalizeLongitude(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  if (lon === 180 || lon === -180) return lon;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

export function shortestDeltaLonDeg(lon1: number, lon2: number): number {
  return ((((lon2 - lon1 + 540) % 360) + 360) % 360) - 180;
}

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
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dPhi = (lat2 - lat1) * DEG_TO_RAD;
  const dLambda = shortestDeltaLonDeg(lon1, lon2) * DEG_TO_RAD;

  const sinDPhi = Math.sin(dPhi / 2);
  const sinDLam = Math.sin(dLambda / 2);
  const aRaw = sinDPhi * sinDPhi + Math.cos(phi1) * Math.cos(phi2) * sinDLam * sinDLam;
  const a = Math.max(0, Math.min(1, aRaw));
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dist = EARTH_RADIUS_KM * c;
  return Number.isFinite(dist) ? dist : 0;
}

export function forwardBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (Math.abs(lat2 - lat1) < 1e-9 && Math.abs(shortestDeltaLonDeg(lon1, lon2)) < 1e-9) {
    return 0;
  }
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLambda = shortestDeltaLonDeg(lon1, lon2) * DEG_TO_RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const deg = (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
  return Number.isFinite(deg) ? deg : 0;
}

export function bearingToCardinal(deg: number): string {
  if (!Number.isFinite(deg)) return 'N';
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return COMPASS_16[index];
}

export function normalizeArgosLc(raw: unknown): ArgosLocationClass {
  if (raw === null || raw === undefined) return null;
  const val = String(raw).trim().toUpperCase();
  if (
    val === 'G' ||
    val === '3' ||
    val === '2' ||
    val === '1' ||
    val === '0' ||
    val === 'A' ||
    val === 'B' ||
    val === 'Z'
  ) {
    return val;
  }
  return null;
}

export function argosAccuracyMeters(argosLc: ArgosLocationClass): number | null {
  if (!argosLc) return null;
  return ARGOS_UNCERTAINTY_RADII_METERS[argosLc] ?? null;
}

export function formatFreshnessLabel(freshnessMs: number): string {
  if (!Number.isFinite(freshnessMs) || freshnessMs < 0) return 'Just now';
  const minutes = Math.floor(freshnessMs / 60_000);
  if (minutes < 1) return '< 1m ago';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d ago`;
  const years = Math.floor(days / 365);
  const remDays = days % 365;
  return remDays > 0 ? `${years}y ${remDays}d ago` : `${years}y ago`;
}

export interface RawFixInput {
  id?: string;
  timestampMs: number;
  lat: number;
  lon: number;
  altitudeOrDepthMeters?: number | null;
  groundSpeedKmh?: number | null;
  headingDeg?: number | null;
  externalTempC?: number | null;
  tagVoltage?: number | null;
  argosLc?: ArgosLocationClass;
  accuracyRadiusMeters?: number | null;
  sensorType?: SensorType;
}

export function normalizeTelemetryFixes(
  idPrefix: string,
  rawFixes: RawFixInput[],
  guild: EcologicalGuild,
): TelemetryFix[] {
  const valid = rawFixes
    .filter(
      (f) =>
        Number.isFinite(f.timestampMs) &&
        Number.isFinite(f.lat) &&
        Number.isFinite(f.lon) &&
        f.lat >= -90 &&
        f.lat <= 90 &&
        f.lon >= -180 &&
        f.lon <= 180,
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);

  // Deduplicate identical millisecond timestamps keeping the latest/richest point.
  const deduped: RawFixInput[] = [];
  for (const fix of valid) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.timestampMs === fix.timestampMs) {
      deduped[deduped.length - 1] = fix;
    } else {
      deduped.push(fix);
    }
  }

  const maxPlausibleSpeedKmh = guild === 'AVIAN' ? 220 : 140;
  const result: TelemetryFix[] = [];
  let lastValidAnchor: TelemetryFix | null = null;

  for (let i = 0; i < deduped.length; i++) {
    const raw = deduped[i];
    const lon = normalizeLongitude(raw.lon);
    const argosLc = normalizeArgosLc(raw.argosLc);
    const accuracy =
      raw.accuracyRadiusMeters !== undefined &&
      raw.accuracyRadiusMeters !== null &&
      Number.isFinite(raw.accuracyRadiusMeters) &&
      raw.accuracyRadiusMeters >= 0
        ? Math.round(raw.accuracyRadiusMeters)
        : argosAccuracyMeters(argosLc);

    let segmentDistanceKm = 0;
    let derivedSpeedKmh = 0;
    let derivedHeadingDeg: number | null = null;
    let isOutlierSpike = false;

    if (lastValidAnchor) {
      segmentDistanceKm = haversineDistanceKm(
        lastValidAnchor.lat,
        lastValidAnchor.lon,
        raw.lat,
        lon,
      );
      const dtHours = (raw.timestampMs - lastValidAnchor.timestampMs) / 3_600_000;
      if (dtHours > 0) {
        derivedSpeedKmh = segmentDistanceKm / dtHours;
      }
      derivedHeadingDeg = forwardBearingDeg(
        lastValidAnchor.lat,
        lastValidAnchor.lon,
        raw.lat,
        lon,
      );

      const isPoorArgosJump =
        (argosLc === 'A' || argosLc === 'B' || argosLc === 'Z') &&
        derivedSpeedKmh > maxPlausibleSpeedKmh * 0.8 &&
        segmentDistanceKm > 60;

      if (
        (dtHours > 1 / 3600 && derivedSpeedKmh > maxPlausibleSpeedKmh) ||
        isPoorArgosJump
      ) {
        isOutlierSpike = true;
      }
    }

    const hasSensorSpeed =
      raw.groundSpeedKmh !== undefined &&
      raw.groundSpeedKmh !== null &&
      Number.isFinite(raw.groundSpeedKmh) &&
      raw.groundSpeedKmh >= 0;

    const groundSpeedKmh = hasSensorSpeed
      ? Number(raw.groundSpeedKmh!.toFixed(2))
      : lastValidAnchor
        ? Number(derivedSpeedKmh.toFixed(2))
        : 0;

    const headingDeg =
      raw.headingDeg !== undefined &&
      raw.headingDeg !== null &&
      Number.isFinite(raw.headingDeg)
        ? ((raw.headingDeg % 360) + 360) % 360
        : derivedHeadingDeg !== null
          ? Number(derivedHeadingDeg.toFixed(1))
          : null;

    const fix: TelemetryFix = {
      id: raw.id ?? `${idPrefix}-fix-${String(i).padStart(4, '0')}`,
      timestamp: new Date(raw.timestampMs).toISOString(),
      timestampMs: raw.timestampMs,
      lat: Number(raw.lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      altitudeOrDepthMeters:
        raw.altitudeOrDepthMeters !== undefined &&
        raw.altitudeOrDepthMeters !== null &&
        Number.isFinite(raw.altitudeOrDepthMeters)
          ? Number(raw.altitudeOrDepthMeters.toFixed(1))
          : null,
      groundSpeedKmh,
      speedIsDerived: !hasSensorSpeed,
      headingDeg,
      externalTempC:
        raw.externalTempC !== undefined &&
        raw.externalTempC !== null &&
        Number.isFinite(raw.externalTempC)
          ? Number(raw.externalTempC.toFixed(1))
          : null,
      tagVoltage:
        raw.tagVoltage !== undefined &&
        raw.tagVoltage !== null &&
        Number.isFinite(raw.tagVoltage)
          ? Number(raw.tagVoltage.toFixed(2))
          : null,
      argosLc,
      accuracyRadiusMeters: accuracy,
      sensorType: raw.sensorType ?? 'GPS-GSM',
      segmentDistanceKm: Number(segmentDistanceKm.toFixed(3)),
      isOutlierSpike,
    };

    result.push(fix);
    if (!isOutlierSpike) {
      lastValidAnchor = fix;
    }
  }

  return result;
}

export function computeAnimalKinematics(
  fixes: TelemetryFix[],
  referenceNowMs: number = Date.now(),
): AnimalKinematics {
  if (fixes.length === 0) {
    return {
      totalDistanceKm: 0,
      displacement24hKm: 0,
      distance24hKm: 0,
      avgSpeedKmh: 0,
      maxSpeedKmh: 0,
      currentSpeedKmh: 0,
      currentBearingDeg: 0,
      currentCardinal: 'N',
      pingFreshnessMs: 0,
      pingFreshnessLabel: 'No fixes',
      daysTracked: 0,
      dailyDistanceSeries: [],
      hasAltitudeOrDepth: false,
    };
  }

  const nonSpikeFixes = fixes.filter((f) => !f.isOutlierSpike);
  const effectiveFixes = nonSpikeFixes.length > 0 ? nonSpikeFixes : fixes;
  const firstFix = effectiveFixes[0];
  const latestFix = effectiveFixes[effectiveFixes.length - 1];

  let totalDistanceKm = 0;
  let maxSpeedKmh = 0;
  let speedSum = 0;
  let speedCount = 0;
  let hasAltitudeOrDepth = false;

  const dailyMap = new Map<
    string,
    { distanceKm: number; fixCount: number; speedSum: number; speedCount: number }
  >();

  for (const fix of fixes) {
    if (fix.altitudeOrDepthMeters !== null) {
      hasAltitudeOrDepth = true;
    }
    const dateIso = fix.timestamp.slice(0, 10);
    const bucket = dailyMap.get(dateIso) ?? {
      distanceKm: 0,
      fixCount: 0,
      speedSum: 0,
      speedCount: 0,
    };
    bucket.fixCount += 1;

    if (!fix.isOutlierSpike) {
      totalDistanceKm += fix.segmentDistanceKm;
      bucket.distanceKm += fix.segmentDistanceKm;

      if (fix.groundSpeedKmh !== null && Number.isFinite(fix.groundSpeedKmh)) {
        if (fix.groundSpeedKmh > maxSpeedKmh) maxSpeedKmh = fix.groundSpeedKmh;
        speedSum += fix.groundSpeedKmh;
        speedCount += 1;
        bucket.speedSum += fix.groundSpeedKmh;
        bucket.speedCount += 1;
      }
    }
    dailyMap.set(dateIso, bucket);
  }

  const cutoff24hMs = latestFix.timestampMs - DAY_MS;
  let distance24hKm = 0;
  let anchor24h = effectiveFixes[0];
  for (const fix of effectiveFixes) {
    if (fix.timestampMs <= cutoff24hMs) {
      anchor24h = fix;
    } else {
      distance24hKm += fix.segmentDistanceKm;
    }
  }
  const displacement24hKm = haversineDistanceKm(
    anchor24h.lat,
    anchor24h.lon,
    latestFix.lat,
    latestFix.lon,
  );

  const prevValid =
    effectiveFixes.length >= 2
      ? effectiveFixes[effectiveFixes.length - 2]
      : latestFix;
  const currentBearingDeg =
    latestFix.headingDeg ??
    forwardBearingDeg(prevValid.lat, prevValid.lon, latestFix.lat, latestFix.lon);

  const pingFreshnessMs = Math.max(0, referenceNowMs - latestFix.timestampMs);
  const spanDays = Math.max(0, (latestFix.timestampMs - firstFix.timestampMs) / DAY_MS);

  const dailyDistanceSeries: DailyDistanceBucket[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateIso, stats]) => ({
      dateIso,
      distanceKm: Number(stats.distanceKm.toFixed(2)),
      fixCount: stats.fixCount,
      avgSpeedKmh:
        stats.speedCount > 0
          ? Number((stats.speedSum / stats.speedCount).toFixed(2))
          : 0,
    }));

  const avgSpeedKmh = speedCount > 0 ? speedSum / speedCount : 0;

  return {
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    displacement24hKm: Number(displacement24hKm.toFixed(2)),
    distance24hKm: Number(distance24hKm.toFixed(2)),
    avgSpeedKmh: Number(avgSpeedKmh.toFixed(2)),
    maxSpeedKmh: Number(maxSpeedKmh.toFixed(2)),
    currentSpeedKmh: Number((latestFix.groundSpeedKmh ?? 0).toFixed(2)),
    currentBearingDeg: Number(currentBearingDeg.toFixed(1)),
    currentCardinal: bearingToCardinal(currentBearingDeg),
    pingFreshnessMs,
    pingFreshnessLabel: formatFreshnessLabel(pingFreshnessMs),
    daysTracked: Number(spanDays.toFixed(1)),
    dailyDistanceSeries,
    hasAltitudeOrDepth,
  };
}

export function computeSolarEstimate(
  lat: number,
  lon: number,
  epochMs: number,
): { solarElevationDeg: number; solarPhase: SolarPhase } {
  const date = new Date(epochMs);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((epochMs - startOfYear) / DAY_MS) + 1;
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solarTimeHours = (((utcHours + lon / 15) % 24) + 24) % 24;
  const hourAngleDeg = (solarTimeHours - 12) * 15;
  const declinationDeg =
    23.44 * Math.sin(((360 / 365) * (dayOfYear - 81)) * DEG_TO_RAD);

  const latRad = lat * DEG_TO_RAD;
  const decRad = declinationDeg * DEG_TO_RAD;
  const haRad = hourAngleDeg * DEG_TO_RAD;

  const sinAlt = Math.max(
    -1,
    Math.min(
      1,
      Math.sin(latRad) * Math.sin(decRad) +
        Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad),
    ),
  );
  const solarElevationDeg = Number((Math.asin(sinAlt) * RAD_TO_DEG).toFixed(1));

  let solarPhase: SolarPhase = 'Night';
  if (solarElevationDeg >= 0) solarPhase = 'Daylight';
  else if (solarElevationDeg >= -6) solarPhase = 'Civil Twilight';
  else if (solarElevationDeg >= -12) solarPhase = 'Nautical Twilight';

  return { solarElevationDeg, solarPhase };
}

export function buildDefaultEnvironment(
  lat: number,
  lon: number,
  epochMs: number,
  regionLabel: string,
  guild: EcologicalGuild,
  altitudeOrDepthMeters: number | null,
  externalTempC: number | null,
): AnimalEnvironment {
  const { solarElevationDeg, solarPhase } = computeSolarEstimate(lat, lon, epochMs);
  const isMarine = guild === 'MARINE';
  return {
    airTempC: !isMarine ? externalTempC : null,
    windSpeedKmh: null,
    windDirectionDeg: null,
    surfacePressureHpa: null,
    elevationMeters: !isMarine ? altitudeOrDepthMeters : 0,
    seaSurfaceTempC: isMarine ? externalTempC : null,
    waveHeightMeters: null,
    oceanCurrentKmh: null,
    solarPhase,
    solarElevationDeg,
    regionLabel,
    fetchedAt: null,
  };
}

interface CuratedSpeciesProfile {
  commonName: string;
  guild: EcologicalGuild;
  iucnStatus: IucnStatus;
  class: string;
  order: string;
  family: string;
  photoUrl: string | null;
  photoAttribution: string | null;
  wikiUrl: string | null;
  summaryExtract: string;
}

const CURATED_SPECIES: Record<string, CuratedSpeciesProfile> = {
  'Phoebastria irrorata': {
    commonName: 'Waved Albatross',
    guild: 'AVIAN',
    iucnStatus: 'CR',
    class: 'Aves',
    order: 'Procellariiformes',
    family: 'Diomedeidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/22/Waved_Albatross_pair.jpg/330px-Waved_Albatross_pair.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Galápagos Archipelago',
    wikiUrl: 'https://en.wikipedia.org/wiki/Waved_albatross',
    summaryExtract:
      'Critically endangered pelagic seabird endemic to the Galápagos and Isla de la Plata, foraging across Humboldt Current upwelling waters off Peru and Ecuador.',
  },
  'Phoca largha': {
    commonName: 'Spotted Seal',
    guild: 'MARINE',
    iucnStatus: 'LC',
    class: 'Mammalia',
    order: 'Carnivora',
    family: 'Phocidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Spotted_seal_mother_and_pup_in_the_Bering_Sea.jpg/330px-Spotted_seal_mother_and_pup_in_the_Bering_Sea.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / NOAA Bering Sea',
    wikiUrl: 'https://en.wikipedia.org/wiki/Spotted_seal',
    summaryExtract:
      'Ice-associated phocid seal inhabiting seasonal pack ice and shelf waters across the Bering, Chukchi, and Okhotsk Seas.',
  },
  'Mesoplodon densirostris': {
    commonName: "Blainville's Beaked Whale",
    guild: 'MARINE',
    iucnStatus: 'LC',
    class: 'Mammalia',
    order: 'Artiodactyla',
    family: 'Ziphiidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c6/Blainville%27s_beaked_whale_size.svg/330px-Blainville%27s_beaked_whale_size.svg.png?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: "https://en.wikipedia.org/wiki/Blainville's_beaked_whale",
    summaryExtract:
      'Deep-diving pelagic odontocete frequenting steep island slopes and abyssal canyons around the Hawaiian Archipelago and tropical oceans.',
  },
  'Globicephala macrorhynchus': {
    commonName: 'Short-finned Pilot Whale',
    guild: 'MARINE',
    iucnStatus: 'LC',
    class: 'Mammalia',
    order: 'Artiodactyla',
    family: 'Delphinidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d5/Globicephala_macrorhynchus_Kurzflossen-Grindwal_DSCF8148.JPG/330px-Globicephala_macrorhynchus_Kurzflossen-Grindwal_DSCF8148.JPG?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Short-finned_pilot_whale',
    summaryExtract:
      'Matrilineal deep-diving delphinid that performs nocturnal mesopelagic foraging dives targeting squid along island escarpments.',
  },
  'Erignathus barbatus': {
    commonName: 'Bearded Seal',
    guild: 'MARINE',
    iucnStatus: 'LC',
    class: 'Mammalia',
    order: 'Carnivora',
    family: 'Phocidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/78/Bearded_Seal.jpg/330px-Bearded_Seal.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Bearded_seal',
    summaryExtract:
      'Benthic-foraging Arctic phocid tracked across seasonal sea-ice breakups between the Bering, Chukchi, and Beaufort Seas.',
  },
  'Pseudorca crassidens': {
    commonName: 'False Killer Whale',
    guild: 'MARINE',
    iucnStatus: 'NT',
    class: 'Mammalia',
    order: 'Artiodactyla',
    family: 'Delphinidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/99/Pseudoorca_Crassidens_-_False_Killer_Whale.jpg/330px-Pseudoorca_Crassidens_-_False_Killer_Whale.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/False_killer_whale',
    summaryExtract:
      'Pelagic social odontocete monitored across seamounts and marine monument reefs of the Northwestern Hawaiian Islands.',
  },
  'Phoca vitulina': {
    commonName: 'Pacific Harbor Seal',
    guild: 'MARINE',
    iucnStatus: 'LC',
    class: 'Mammalia',
    order: 'Carnivora',
    family: 'Phocidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/48/Common_seal_%28Phoca_vitulina%29_2.jpg/330px-Common_seal_%28Phoca_vitulina%29_2.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Harbor_seal',
    summaryExtract:
      'Coastal and fjord pinniped foraging along glacial tidewater passages and continental shelf eddies in the Gulf of Alaska.',
  },
  'Histriophoca fasciata': {
    commonName: 'Ribbon Seal',
    guild: 'MARINE',
    iucnStatus: 'LC',
    class: 'Mammalia',
    order: 'Carnivora',
    family: 'Phocidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a3/Ribbon-seal-male_Josh_London_NOAAedit_%2816086029928%29_%28cropped%29.jpg/330px-Ribbon-seal-male_Josh_London_NOAAedit_%2816086029928%29_%28cropped%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Josh London (NOAA)',
    wikiUrl: 'https://en.wikipedia.org/wiki/Ribbon_seal',
    summaryExtract:
      'Ice-associated pelagic seal dispersing across the deep Aleutian Basin and Bering Sea shelf break after spring molt.',
  },
};

export function inferGuildFromTaxon(scientificName: string): EcologicalGuild {
  const curated = CURATED_SPECIES[scientificName];
  if (curated) return curated.guild;
  const lower = scientificName.toLowerCase();
  if (
    lower.includes('whale') ||
    lower.includes('seal') ||
    lower.includes('shark') ||
    lower.includes('phoca') ||
    lower.includes('erignathus') ||
    lower.includes('histriophoca') ||
    lower.includes('mesoplodon') ||
    lower.includes('globicephala') ||
    lower.includes('pseudorca') ||
    lower.includes('carcharodon') ||
    lower.includes('balaen') ||
    lower.includes('megaptera')
  ) {
    return 'MARINE';
  }
  if (
    lower.includes('turtle') ||
    lower.includes('tortoise') ||
    lower.includes('dermochelys') ||
    lower.includes('chelonia') ||
    lower.includes('chelonoidis')
  ) {
    return 'REPTILE';
  }
  if (
    lower.includes('albatross') ||
    lower.includes('eagle') ||
    lower.includes('stork') ||
    lower.includes('phoebastria') ||
    lower.includes('diomedea') ||
    lower.includes('aquila') ||
    lower.includes('ciconia')
  ) {
    return 'AVIAN';
  }
  return 'AVIAN';
}

export function buildDefaultEcology(scientificName: string): AnimalEcology {
  const clean = scientificName.trim() || 'Unknown species';
  const parts = clean.split(/\s+/);
  const genus = parts[0] || 'Unknown';
  const species = parts[1] || 'sp.';
  const curated = CURATED_SPECIES[clean];

  return {
    photoUrl: curated?.photoUrl ?? null,
    photoAttribution: curated?.photoAttribution ?? null,
    iucnStatus: curated?.iucnStatus ?? 'DD',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: curated?.class ?? 'Unknown',
      order: curated?.order ?? 'Unknown',
      family: curated?.family ?? 'Unknown',
      genus,
      species,
    },
    summaryExtract:
      curated?.summaryExtract ??
      `Bio-logged movement profile for ${clean} ingested via WildPulse telemetry proxy.`,
    wikiUrl:
      curated?.wikiUrl ??
      (parts.length >= 2
        ? `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/\s+/g, '_'))}`
        : null),
    enriched: false,
  };
}
