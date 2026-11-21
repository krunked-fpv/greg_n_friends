export type GeoCoord = [number, number];

/**
 * Normalizes a longitude value into [-180, 180], preserving exact +/-180 boundary values.
 */
export function normalizeLon(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  if (lon === 180 || lon === -180) return lon;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * Clamps a latitude value safely into [-90, 90].
 */
export function clampLat(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-90, Math.min(90, lat));
}

/**
 * Returns the shortest signed longitudinal delta from lon1 to lon2 in [-180, 180).
 */
export function shortestDeltaLon(lon1: number, lon2: number): number {
  const delta = ((((lon2 - lon1 + 540) % 360) + 360) % 360) - 180;
  return delta === 0 ? 0 : delta;
}

/**
 * Returns true if the direct Cartesian span between normalized longitudes exceeds 180 degrees.
 */
export function isAntimeridianCrossing(lon1: number, lon2: number): boolean {
  return Math.abs(normalizeLon(lon2) - normalizeLon(lon1)) > 180;
}

/**
 * Splits a single [lon, lat] segment if Math.abs(lon2 - lon1) > 180, computing the exact
 * crossing latitude at +180 / -180 via linear interpolation along the shortest longitudinal arc.
 */
export function splitSegmentAtAntimeridian(p1: GeoCoord, p2: GeoCoord): GeoCoord[][] {
  if (
    !Number.isFinite(p1[0]) ||
    !Number.isFinite(p1[1]) ||
    !Number.isFinite(p2[0]) ||
    !Number.isFinite(p2[1])
  ) {
    return [];
  }

  const lon1 = normalizeLon(p1[0]);
  const lat1 = clampLat(p1[1]);
  const lon2 = normalizeLon(p2[0]);
  const lat2 = clampLat(p2[1]);

  if (Math.abs(lon2 - lon1) <= 180) {
    return [[[lon1, lat1], [lon2, lat2]]];
  }

  // Boundary exact endpoints avoid emitting degenerate zero-length boundary stubs.
  if (lon1 === 180 && lon2 < 0) {
    return [[[-180, lat1], [lon2, lat2]]];
  }
  if (lon1 === -180 && lon2 > 0) {
    return [[[180, lat1], [lon2, lat2]]];
  }
  if (lon2 === -180 && lon1 > 0) {
    return [[[lon1, lat1], [180, lat2]]];
  }
  if (lon2 === 180 && lon1 < 0) {
    return [[[lon1, lat1], [-180, lat2]]];
  }

  if (lon1 > 0 && lon2 < 0) {
    // Eastward crossing across +180 -> -180
    const unwrappedLon2 = lon2 + 360;
    const span = unwrappedLon2 - lon1;
    const t = span > 0 ? (180 - lon1) / span : 0.5;
    const crossLat = clampLat(lat1 + t * (lat2 - lat1));
    return [
      [
        [lon1, lat1],
        [180, crossLat],
      ],
      [
        [-180, crossLat],
        [lon2, lat2],
      ],
    ];
  }

  // Westward crossing across -180 -> +180
  const unwrappedLon2 = lon2 - 360;
  const span = unwrappedLon2 - lon1;
  const t = span < 0 ? (-180 - lon1) / span : 0.5;
  const crossLat = clampLat(lat1 + t * (lat2 - lat1));
  return [
    [
      [lon1, lat1],
      [-180, crossLat],
    ],
    [
      [180, crossLat],
      [lon2, lat2],
    ],
  ];
}

/**
 * Splits a full trajectory coordinate list into continuous LineString coordinate arrays
 * whenever a segment crosses the +/-180 antimeridian.
 */
export function splitTrackAtAntimeridian(coords: readonly GeoCoord[]): GeoCoord[][] {
  const valid: GeoCoord[] = [];
  for (const pt of coords) {
    if (Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
      valid.push([normalizeLon(pt[0]), clampLat(pt[1])]);
    }
  }

  if (valid.length < 2) {
    return [];
  }

  const lines: GeoCoord[][] = [];
  let currentLine: GeoCoord[] = [valid[0]];

  for (let i = 1; i < valid.length; i += 1) {
    const prev = valid[i - 1];
    const curr = valid[i];
    const pieces = splitSegmentAtAntimeridian(prev, curr);

    if (pieces.length === 1) {
      const [startPt, endPt] = pieces[0];
      const last = currentLine[currentLine.length - 1];
      if (last[0] === startPt[0] && last[1] === startPt[1]) {
        currentLine.push(endPt);
      } else {
        if (currentLine.length >= 2) {
          lines.push(currentLine);
        }
        currentLine = [startPt, endPt];
      }
    } else if (pieces.length === 2) {
      const [firstPiece, secondPiece] = pieces;
      const last = currentLine[currentLine.length - 1];
      if (last[0] === firstPiece[0][0] && last[1] === firstPiece[0][1]) {
        currentLine.push(firstPiece[1]);
      } else {
        if (currentLine.length >= 2) {
          lines.push(currentLine);
        }
        currentLine = [firstPiece[0], firstPiece[1]];
      }
      if (currentLine.length >= 2) {
        lines.push(currentLine);
      }
      currentLine = [secondPiece[0], secondPiece[1]];
    }
  }

  if (currentLine.length >= 2) {
    lines.push(currentLine);
  }

  return lines;
}
