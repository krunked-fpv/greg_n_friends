import type { ArgosLocationClass } from '../../types/telemetry';
import { clampLat, normalizeLon, type GeoCoord } from './antimeridian';

const EARTH_RADIUS_METERS = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export const DEFAULT_UNCERTAINTY_STEPS = 36;

export const ARGOS_UNCERTAINTY_RADII_METERS: Record<
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

/**
 * Resolves the nominal horizontal error radius in meters for an Argos location class
 * or explicit sensor accuracy radius.
 */
export function getArgosUncertaintyRadiusMeters(
  argosLc: ArgosLocationClass,
  accuracyRadiusMeters?: number | null,
): number | null {
  if (argosLc !== null && argosLc in ARGOS_UNCERTAINTY_RADII_METERS) {
    return ARGOS_UNCERTAINTY_RADII_METERS[argosLc];
  }
  if (
    typeof accuracyRadiusMeters === 'number' &&
    Number.isFinite(accuracyRadiusMeters) &&
    accuracyRadiusMeters > 0
  ) {
    return accuracyRadiusMeters;
  }
  return null;
}

function signedArea(ring: readonly GeoCoord[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area * 0.5;
}

function ensureCounterClockwiseClosedRing(vertices: readonly GeoCoord[]): GeoCoord[] {
  const deduped: GeoCoord[] = [];
  for (const pt of vertices) {
    const prev = deduped[deduped.length - 1];
    if (
      !prev ||
      Math.abs(prev[0] - pt[0]) > 1e-11 ||
      Math.abs(prev[1] - pt[1]) > 1e-11
    ) {
      deduped.push([pt[0], pt[1]]);
    }
  }
  if (deduped.length > 1) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (Math.abs(first[0] - last[0]) <= 1e-11 && Math.abs(first[1] - last[1]) <= 1e-11) {
      deduped.pop();
    }
  }
  if (deduped.length < 3) {
    return [];
  }
  if (signedArea(deduped) < 0) {
    deduped.reverse();
  }
  deduped.push([deduped[0][0], deduped[0][1]]);
  return deduped;
}

function clipRingAtVerticalLine(
  vertices: readonly GeoCoord[],
  clipX: number,
  side: 'le' | 'ge',
): GeoCoord[] {
  if (vertices.length < 3) return [];
  const isInside = (pt: GeoCoord): boolean =>
    side === 'le' ? pt[0] <= clipX + 1e-12 : pt[0] >= clipX - 1e-12;

  const intersect = (a: GeoCoord, b: GeoCoord): GeoCoord => {
    const dx = b[0] - a[0];
    if (Math.abs(dx) < 1e-12) {
      return [clipX, clampLat(a[1])];
    }
    const t = Math.max(0, Math.min(1, (clipX - a[0]) / dx));
    return [clipX, clampLat(a[1] + t * (b[1] - a[1]))];
  };

  const output: GeoCoord[] = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const s = vertices[i];
    const e = vertices[(i + 1) % vertices.length];
    const sIn = isInside(s);
    const eIn = isInside(e);

    if (eIn) {
      if (!sIn) {
        output.push(intersect(s, e));
      }
      output.push([e[0], e[1]]);
    } else if (sIn) {
      output.push(intersect(s, e));
    }
  }
  return output;
}

/**
 * Generates an unwrapped geodesic circle (default 36 vertices) around (lat, lon)
 * in counter-clockwise order with longitudes continuous around centerLon.
 */
export function generateUnwrappedGeodesicVertices(
  lat: number,
  lon: number,
  radiusMeters: number,
  steps = DEFAULT_UNCERTAINTY_STEPS,
): GeoCoord[] {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters <= 0
  ) {
    return [];
  }

  const count = Math.max(8, Math.floor(steps));
  const centerLat = Math.max(-89.9, Math.min(89.9, clampLat(lat)));
  const centerLon = normalizeLon(lon);
  const angularDist = Math.min(Math.PI / 4, radiusMeters / EARTH_RADIUS_METERS);

  const lat1 = centerLat * DEG_TO_RAD;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinD = Math.sin(angularDist);
  const cosD = Math.cos(angularDist);

  const vertices: GeoCoord[] = [];
  for (let i = 0; i < count; i += 1) {
    // Negative angle proceeds counter-clockwise (East -> North -> West -> South)
    const bearing = -(2 * Math.PI * i) / count;
    const sinLat2 = Math.max(
      -1,
      Math.min(1, sinLat1 * cosD + cosLat1 * sinD * Math.cos(bearing)),
    );
    const lat2 = Math.asin(sinLat2);
    const deltaLonRad = Math.atan2(
      Math.sin(bearing) * sinD * cosLat1,
      cosD - sinLat1 * sinLat2,
    );
    const unwrappedLon = centerLon + deltaLonRad * RAD_TO_DEG;
    const safeLat = Math.max(-89.999, Math.min(89.999, lat2 * RAD_TO_DEG));
    vertices.push([unwrappedLon, safeLat]);
  }

  return vertices;
}

/**
 * Builds an antimeridian-safe GeoJSON Polygon or MultiPolygon for a geodesic uncertainty ring.
 * Any circle crossing +/-180 is cleanly clipped into separate closed polygons inside [-180, 180].
 */
export function createUncertaintyCircleGeometry(
  lat: number,
  lon: number,
  radiusMeters: number,
  steps = DEFAULT_UNCERTAINTY_STEPS,
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const vertices = generateUnwrappedGeodesicVertices(lat, lon, radiusMeters, steps);
  if (vertices.length < 3) return null;

  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [x] of vertices) {
    if (x < minLon) minLon = x;
    if (x > maxLon) maxLon = x;
  }

  if (minLon >= -180 && maxLon <= 180) {
    const ring = ensureCounterClockwiseClosedRing(vertices);
    if (ring.length < 4) return null;
    return {
      type: 'Polygon',
      coordinates: [ring],
    };
  }

  const rings: GeoCoord[][] = [];

  if (maxLon > 180) {
    const westOf180 = ensureCounterClockwiseClosedRing(
      clipRingAtVerticalLine(vertices, 180, 'le'),
    );
    if (westOf180.length >= 4) {
      rings.push(westOf180);
    }

    const eastOf180Shifted = ensureCounterClockwiseClosedRing(
      clipRingAtVerticalLine(vertices, 180, 'ge').map(
        ([x, y]): GeoCoord => [normalizeLon(x - 360), y],
      ),
    );
    if (eastOf180Shifted.length >= 4) {
      rings.push(eastOf180Shifted);
    }
  } else if (minLon < -180) {
    const eastOfNeg180 = ensureCounterClockwiseClosedRing(
      clipRingAtVerticalLine(vertices, -180, 'ge'),
    );
    if (eastOfNeg180.length >= 4) {
      rings.push(eastOfNeg180);
    }

    const westOfNeg180Shifted = ensureCounterClockwiseClosedRing(
      clipRingAtVerticalLine(vertices, -180, 'le').map(
        ([x, y]): GeoCoord => [normalizeLon(x + 360), y],
      ),
    );
    if (westOfNeg180Shifted.length >= 4) {
      rings.push(westOfNeg180Shifted);
    }
  }

  if (rings.length === 0) return null;
  if (rings.length === 1) {
    return {
      type: 'Polygon',
      coordinates: [rings[0]],
    };
  }
  return {
    type: 'MultiPolygon',
    coordinates: rings.map((r) => [r]),
  };
}

/**
 * Convenience wrapper building a geodesic uncertainty polygon directly from an Argos location class.
 */
export function createArgosUncertaintyGeometry(
  lat: number,
  lon: number,
  argosLc: ArgosLocationClass,
  accuracyRadiusMeters?: number | null,
  steps = DEFAULT_UNCERTAINTY_STEPS,
): { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; radiusMeters: number } | null {
  const radiusMeters = getArgosUncertaintyRadiusMeters(argosLc, accuracyRadiusMeters);
  if (radiusMeters === null) return null;
  const geometry = createUncertaintyCircleGeometry(lat, lon, radiusMeters, steps);
  if (!geometry) return null;
  return { geometry, radiusMeters };
}
