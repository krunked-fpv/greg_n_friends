import type { SolarPhase } from '../../types/telemetry';
import { normalizeLongitudeDeg } from './math';

export interface SolarPosition {
  solarDeclinationDeg: number;
  solarElevationDeg: number;
  solarPhase: SolarPhase;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function wrap360(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  return mod === 360 ? 0 : mod;
}

/**
 * Classifies solar elevation angle (in degrees) into astronomical daylight/twilight phase.
 */
export function classifySolarPhase(solarElevationDeg: number): SolarPhase {
  if (!Number.isFinite(solarElevationDeg)) return 'Night';
  if (solarElevationDeg >= 0) return 'Daylight';
  if (solarElevationDeg >= -6) return 'Civil Twilight';
  if (solarElevationDeg >= -12) return 'Nautical Twilight';
  return 'Night';
}

/**
 * Deterministic astronomical solar declination & solar elevation calculator.
 * Uses J2000 low-precision ephemeris equations accurate to <0.5° across all latitudes.
 */
export function computeSolarPosition(
  lat: number,
  lon: number,
  epochMs: number = Date.now(),
): SolarPosition {
  const safeLat = Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : 0;
  const safeLon = normalizeLongitudeDeg(lon);
  const safeMs = Number.isFinite(epochMs) ? epochMs : Date.now();

  const julianDay = safeMs / 86_400_000 + 2440587.5;
  const daysSinceJ2000 = julianDay - 2451545.0;

  const meanLongitudeDeg = wrap360(280.46 + 0.9856474 * daysSinceJ2000);
  const meanAnomalyRad = degToRad(
    wrap360(357.528 + 0.9856003 * daysSinceJ2000),
  );

  const eclipticLongitudeRad = degToRad(
    meanLongitudeDeg +
      1.915 * Math.sin(meanAnomalyRad) +
      0.02 * Math.sin(2 * meanAnomalyRad),
  );
  const obliquityRad = degToRad(23.439 - 0.0000004 * daysSinceJ2000);

  const sinDec = Math.sin(obliquityRad) * Math.sin(eclipticLongitudeRad);
  const declinationRad = Math.asin(Math.max(-1, Math.min(1, sinDec)));

  const rightAscensionRad = Math.atan2(
    Math.cos(obliquityRad) * Math.sin(eclipticLongitudeRad),
    Math.cos(eclipticLongitudeRad),
  );
  const rightAscensionDeg = wrap360(radToDeg(rightAscensionRad));

  const gmstDeg = wrap360(
    280.46061837 + 360.98564736629 * daysSinceJ2000,
  );
  const localHourAngleRad = degToRad(gmstDeg + safeLon - rightAscensionDeg);

  const latRad = degToRad(safeLat);
  const sinElevation =
    Math.sin(latRad) * Math.sin(declinationRad) +
    Math.cos(latRad) * Math.cos(declinationRad) * Math.cos(localHourAngleRad);

  const elevationDeg = radToDeg(
    Math.asin(Math.max(-1, Math.min(1, sinElevation))),
  );
  const roundedElevation =
    Math.round((Number.isFinite(elevationDeg) ? elevationDeg : 0) * 100) / 100;
  const roundedDeclination =
    Math.round(radToDeg(declinationRad) * 100) / 100;

  return {
    solarDeclinationDeg: roundedDeclination === 0 ? 0 : roundedDeclination,
    solarElevationDeg: roundedElevation === 0 ? 0 : roundedElevation,
    solarPhase: classifySolarPhase(roundedElevation),
  };
}
