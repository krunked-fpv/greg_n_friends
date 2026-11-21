import type { AnimalEnvironment, EcologicalGuild } from '../types/telemetry';
import { normalizeLongitudeDeg } from '../utils/kinematics/math';
import { computeSolarPosition } from '../utils/kinematics/solar';
import type { FetchLike } from './telemetryClient';

const ENV_CACHE_PREFIX = 'wildpulse:env:v1:';
const ENV_CACHE_TTL_MS = 15 * 60 * 1000;
const ENV_TIMEOUT_MS = 4500;

interface CachedEnvPayload {
  savedAtMs: number;
  value: Omit<AnimalEnvironment, 'solarPhase' | 'solarElevationDeg'>;
}

interface OpenMeteoForecastResponse {
  elevation?: number;
  current?: {
    temperature_2m?: number;
    surface_pressure?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
}

interface OpenMeteoMarineResponse {
  current?: {
    wave_height?: number;
    ocean_current_velocity?: number;
    sea_surface_temperature?: number;
  };
}

interface BigDataCloudResponse {
  locality?: string;
  city?: string;
  principalSubdivision?: string;
  countryName?: string;
  localityInfo?: {
    informative?: Array<{
      name?: string;
      description?: string;
    }>;
  };
}

function finiteOrNull(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  return Number.isFinite(value) ? value : null;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number,
  fetchFn: FetchLike,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic ocean basin & geographic region fallback when reverse-geocoding
 * returns open ocean or is offline.
 */
export function inferOceanBasinOrRegion(lat: number, lon: number): string {
  const safeLat = Number.isFinite(lat) ? lat : 0;
  const safeLon = normalizeLongitudeDeg(lon);

  if (safeLat >= 66.5) return 'Arctic Ocean';
  if (safeLat <= -60) return 'Southern Ocean';

  if (
    safeLat >= 52 &&
    safeLat < 66.5 &&
    (safeLon <= -158 || safeLon >= 162)
  ) {
    return 'Bering Sea';
  }

  if (safeLat >= 18 && safeLat <= 31 && safeLon >= -98 && safeLon <= -80) {
    return 'Gulf of Mexico';
  }
  if (safeLat >= 9 && safeLat < 22 && safeLon >= -88 && safeLon <= -60) {
    return 'Caribbean Sea';
  }
  if (safeLat >= 30 && safeLat <= 46 && safeLon >= -6 && safeLon <= 36) {
    return 'Mediterranean Sea';
  }

  if (safeLon >= 20 && safeLon <= 146 && safeLat < 30) {
    if (safeLon <= 120) return 'Indian Ocean';
    if (safeLat <= -10 && safeLat >= -30 && safeLon <= 165) return 'Coral Sea';
    if (safeLat < -30 && safeLon >= 146 && safeLon <= 173) return 'Tasman Sea';
  }

  // Atlantic basin roughly -70 to +20 (with tropical Americas adjustment)
  const isAtlanticLon =
    (safeLon >= -75 && safeLon <= 20 && safeLat >= 0) ||
    (safeLon >= -68 && safeLon <= 20 && safeLat < 0);
  if (isAtlanticLon) {
    return safeLat >= 0 ? 'North Atlantic Ocean' : 'South Atlantic Ocean';
  }

  // Pacific basin spans ±180°
  if (safeLon > 110 || safeLon < -70) {
    if (Math.abs(safeLat) < 10) return 'Equatorial Pacific Ocean';
    return safeLat >= 0 ? 'North Pacific Ocean' : 'South Pacific Ocean';
  }

  return safeLat >= 0 ? 'Northern Hemisphere Region' : 'Southern Hemisphere Region';
}

function formatReverseGeocodeLabel(
  bdc: BigDataCloudResponse | null,
  lat: number,
  lon: number,
  fallbackLabel: string,
): string {
  if (bdc) {
    const parts: string[] = [];
    const primary = bdc.locality?.trim() || bdc.city?.trim() || '';
    const sub = bdc.principalSubdivision?.trim() || '';
    const country = bdc.countryName?.trim() || '';

    for (const piece of [primary, sub, country]) {
      if (piece && !parts.includes(piece)) {
        parts.push(piece);
      }
    }

    if (parts.length > 0) {
      return parts.join(', ');
    }

    const informative = bdc.localityInfo?.informative?.[0]?.name?.trim();
    if (informative) {
      return informative;
    }
  }

  if (
    fallbackLabel &&
    fallbackLabel.trim().length > 0 &&
    fallbackLabel !== 'Unknown' &&
    fallbackLabel !== 'Pending...'
  ) {
    return fallbackLabel;
  }

  return inferOceanBasinOrRegion(lat, lon);
}

function readCachedEnv(key: string): CachedEnvPayload | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEnvPayload;
    if (
      parsed &&
      typeof parsed.savedAtMs === 'number' &&
      Date.now() - parsed.savedAtMs < ENV_CACHE_TTL_MS &&
      parsed.value
    ) {
      return parsed;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

function writeCachedEnv(key: string, entry: CachedEnvPayload): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Ignore storage write errors
  }
}

export interface EnvironmentQueryContext {
  lat: number;
  lon: number;
  guild: EcologicalGuild;
  altitudeOrDepthMeters?: number | null;
  timestampMs?: number;
  fallback: AnimalEnvironment;
}

export class EnvironmentEnricher {
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly memoryCache = new Map<string, CachedEnvPayload>();
  private readonly inFlight = new Map<string, Promise<AnimalEnvironment>>();

  constructor(options: { fetchFn?: FetchLike; timeoutMs?: number } = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? ENV_TIMEOUT_MS;
  }

  async enrichAnimalEnvironment(
    ctx: EnvironmentQueryContext,
  ): Promise<AnimalEnvironment> {
    const safeLat = Number.isFinite(ctx.lat)
      ? Math.max(-90, Math.min(90, ctx.lat))
      : 0;
    const safeLon = normalizeLongitudeDeg(ctx.lon);
    const refMs = Number.isFinite(ctx.timestampMs)
      ? (ctx.timestampMs as number)
      : Date.now();
    const solar = computeSolarPosition(safeLat, safeLon, refMs);

    const isExplicitlyMarine =
      ctx.guild === 'MARINE' ||
      (ctx.altitudeOrDepthMeters !== null &&
        ctx.altitudeOrDepthMeters !== undefined &&
        ctx.altitudeOrDepthMeters < 0);

    const latKey = safeLat.toFixed(2);
    const lonKey = safeLon.toFixed(2);
    const cacheKey = `${latKey},${lonKey}:${ctx.guild}`;
    const storageKey = `${ENV_CACHE_PREFIX}${cacheKey}`;

    const memHit = this.memoryCache.get(cacheKey);
    if (memHit && Date.now() - memHit.savedAtMs < ENV_CACHE_TTL_MS) {
      return {
        ...memHit.value,
        solarPhase: solar.solarPhase,
        solarElevationDeg: solar.solarElevationDeg,
      };
    }

    const diskHit = readCachedEnv(storageKey);
    if (diskHit) {
      this.memoryCache.set(cacheKey, diskHit);
      return {
        ...diskHit.value,
        solarPhase: solar.solarPhase,
        solarElevationDeg: solar.solarElevationDeg,
      };
    }

    const existingPromise = this.inFlight.get(cacheKey);
    if (existingPromise) {
      const resolved = await existingPromise;
      return {
        ...resolved,
        solarPhase: solar.solarPhase,
        solarElevationDeg: solar.solarElevationDeg,
      };
    }

    const requestPromise = (async (): Promise<AnimalEnvironment> => {
      const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${safeLat.toFixed(4)}&longitude=${safeLon.toFixed(4)}&current=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m`;
      const geocodeUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${safeLat.toFixed(4)}&longitude=${safeLon.toFixed(4)}&localityLanguage=en`;
      const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${safeLat.toFixed(4)}&longitude=${safeLon.toFixed(4)}&current=wave_height,ocean_current_velocity,sea_surface_temperature`;

      const [forecastRes, geocodeRes, initialMarineRes] =
        await Promise.allSettled([
          fetchJsonWithTimeout<OpenMeteoForecastResponse>(
            forecastUrl,
            this.timeoutMs,
            this.fetchFn,
          ),
          fetchJsonWithTimeout<BigDataCloudResponse>(
            geocodeUrl,
            this.timeoutMs,
            this.fetchFn,
          ),
          isExplicitlyMarine
            ? fetchJsonWithTimeout<OpenMeteoMarineResponse>(
                marineUrl,
                this.timeoutMs,
                this.fetchFn,
              )
            : Promise.resolve(null),
        ]);

      const forecast =
        forecastRes.status === 'fulfilled' ? forecastRes.value : null;
      const geocode =
        geocodeRes.status === 'fulfilled' ? geocodeRes.value : null;

      let marine: OpenMeteoMarineResponse | null =
        initialMarineRes.status === 'fulfilled' ? initialMarineRes.value : null;

      // Pelagic check for non-MARINE guilds (e.g., Wandering Albatross or Sea Turtle over open ocean)
      const isPelagicOverOcean =
        !isExplicitlyMarine &&
        (ctx.guild === 'AVIAN' || ctx.guild === 'REPTILE') &&
        geocode !== null &&
        (!geocode.countryName || geocode.countryName.trim() === '');

      if (isPelagicOverOcean) {
        try {
          marine = await fetchJsonWithTimeout<OpenMeteoMarineResponse>(
            marineUrl,
            this.timeoutMs,
            this.fetchFn,
          );
        } catch {
          marine = null;
        }
      }

      const anySucceeded =
        forecast !== null || geocode !== null || marine !== null;

      const baseEnv: Omit<AnimalEnvironment, 'solarPhase' | 'solarElevationDeg'> =
        {
          airTempC:
            finiteOrNull(forecast?.current?.temperature_2m) ??
            ctx.fallback.airTempC,
          windSpeedKmh:
            finiteOrNull(forecast?.current?.wind_speed_10m) ??
            ctx.fallback.windSpeedKmh,
          windDirectionDeg:
            finiteOrNull(forecast?.current?.wind_direction_10m) ??
            ctx.fallback.windDirectionDeg,
          surfacePressureHpa:
            finiteOrNull(forecast?.current?.surface_pressure) ??
            ctx.fallback.surfacePressureHpa,
          elevationMeters:
            finiteOrNull(forecast?.elevation) ?? ctx.fallback.elevationMeters,
          seaSurfaceTempC:
            finiteOrNull(marine?.current?.sea_surface_temperature) ??
            ctx.fallback.seaSurfaceTempC,
          waveHeightMeters:
            finiteOrNull(marine?.current?.wave_height) ??
            ctx.fallback.waveHeightMeters,
          oceanCurrentKmh:
            finiteOrNull(marine?.current?.ocean_current_velocity) ??
            ctx.fallback.oceanCurrentKmh,
          regionLabel: formatReverseGeocodeLabel(
            geocode,
            safeLat,
            safeLon,
            ctx.fallback.regionLabel,
          ),
          fetchedAt: anySucceeded
            ? new Date().toISOString()
            : ctx.fallback.fetchedAt,
        };

      if (anySucceeded) {
        const entry: CachedEnvPayload = {
          savedAtMs: Date.now(),
          value: baseEnv,
        };
        this.memoryCache.set(cacheKey, entry);
        writeCachedEnv(storageKey, entry);
      }

      return {
        ...baseEnv,
        solarPhase: solar.solarPhase,
        solarElevationDeg: solar.solarElevationDeg,
      };
    })();

    this.inFlight.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }
}

export const environmentEnricher = new EnvironmentEnricher();
