import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  haversineDistanceKm as serverHaversineDistanceKm,
  normalizeTelemetryFixes as serverNormalizeTelemetryFixes,
} from '../../server/kinematics.ts';
import { CURATED_ATN_DATASETS } from '../../src/data/curatedAtnDatasets.ts';
import { mergeAndDedupeFleet } from '../../src/services/telemetryClient.ts';
import type { AnimalDossier, FleetResponse, TelemetryFix } from '../../src/types/telemetry.ts';
import {
  splitSegmentAtAntimeridian,
  splitTrackAtAntimeridian,
  type GeoCoord,
} from '../../src/utils/geo/antimeridian.ts';
import { createUncertaintyCircleGeometry } from '../../src/utils/geo/uncertaintyCircle.ts';
import { interpolateAnimalAtTimestamp } from '../../src/utils/kinematics/interpolator.ts';
import {
  computeAnimalKinematics,
  haversineDistanceKm,
  normalizeTelemetryFixes,
  shortestDeltaLonDeg,
} from '../../src/utils/kinematics/math.ts';

function loadFallbackFleet(): FleetResponse {
  const filePath = path.resolve(process.cwd(), 'public', 'data', 'fallback-fleet.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as FleetResponse;
}

function loadCiLiveSnapshot(): FleetResponse {
  const filePath = path.resolve(process.cwd(), 'public', 'data', 'ci-live-snapshot.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as FleetResponse;
}

describe('Challenge 3: Antimeridian (±180°) Haversine, polyline splitting & interpolation', () => {
  it('computes ~85–115 km (never ~39,900 km) for +179.6° -> -179.4° crossings on both client and server', () => {
    const clientEqDist = haversineDistanceKm(0, 179.6, 0, -179.4);
    const serverEqDist = serverHaversineDistanceKm(0, 179.6, 0, -179.4);
    expect(clientEqDist).toBeGreaterThan(85);
    expect(clientEqDist).toBeLessThan(115);
    expect(serverEqDist).toBeGreaterThan(85);
    expect(serverEqDist).toBeLessThan(115);

    // At tropical latitude (-13.65 -> -13.95, matching kalani-7)
    const clientKalaniCross = haversineDistanceKm(-13.65, 179.6, -13.95, -179.4);
    const serverKalaniCross = serverHaversineDistanceKm(-13.65, 179.6, -13.95, -179.4);
    expect(clientKalaniCross).toBeGreaterThan(85);
    expect(clientKalaniCross).toBeLessThan(115);
    expect(serverKalaniCross).toBeGreaterThan(85);
    expect(serverKalaniCross).toBeLessThan(115);

    // Reverse crossing (-179.4° -> +179.6°) must have identical shortest arc magnitude
    expect(shortestDeltaLonDeg(179.6, -179.4)).toBeCloseTo(1.0, 6);
    expect(shortestDeltaLonDeg(-179.4, 179.6)).toBeCloseTo(-1.0, 6);
    expect(haversineDistanceKm(-13.95, -179.4, -13.65, 179.6)).toBeCloseTo(
      clientKalaniCross,
      6,
    );
  });

  it('verifies kalani-7 and kuaka-e7 cross ±180° without spikes or >180° line segments', () => {
    const fleet = loadFallbackFleet();
    for (const animalId of ['kalani-7', 'kuaka-e7'] as const) {
      const animal = fleet.animals.find((a) => a.id === animalId);
      expect(animal, `Expected ${animalId} in fallback-fleet.json`).toBeDefined();

      const rawCrossings = animal!.fixes.filter(
        (fix, idx) => idx > 0 && Math.abs(fix.lon - animal!.fixes[idx - 1]!.lon) > 180,
      );
      expect(rawCrossings.length).toBeGreaterThanOrEqual(1);

      // Re-run normalization and kinematics to confirm crossing is NOT misclassified as a spike
      const normalized = normalizeTelemetryFixes(animal!.fixes, animal!.guild);
      const nonSpikeFixes = normalized.filter((f) => !f.isOutlierSpike);
      expect(nonSpikeFixes.length).toBe(animal!.fixes.length);

      for (let i = 1; i < normalized.length; i += 1) {
        expect(normalized[i]!.segmentDistanceKm).toBeLessThan(250);
      }

      const coords: GeoCoord[] = normalized.map((f) => [f.lon, f.lat]);
      const splitLines = splitTrackAtAntimeridian(coords);
      expect(splitLines.length).toBeGreaterThanOrEqual(2);

      // Every split polyline must stay inside [-180, 180] with zero segments jumping |lon2 - lon1| > 180
      let hitPositiveBoundary = false;
      let hitNegativeBoundary = false;
      for (const line of splitLines) {
        expect(line.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < line.length; i += 1) {
          const [lon, lat] = line[i]!;
          expect(lon).toBeGreaterThanOrEqual(-180);
          expect(lon).toBeLessThanOrEqual(180);
          expect(lat).toBeGreaterThanOrEqual(-90);
          expect(lat).toBeLessThanOrEqual(90);
          if (lon === 180) hitPositiveBoundary = true;
          if (lon === -180) hitNegativeBoundary = true;
          if (i > 0) {
            expect(Math.abs(lon - line[i - 1]![0])).toBeLessThanOrEqual(180);
          }
        }
      }
      expect(hitPositiveBoundary).toBe(true);
      expect(hitNegativeBoundary).toBe(true);
    }
  });

  it('verifies 35-species unified roster, NW Atlantic luna-01 coordinates, and zero-duplicate snapshot/seed merge', () => {
    const fallback = loadFallbackFleet();
    const snapshot = loadCiLiveSnapshot();

    expect(fallback.animals.length).toBeGreaterThanOrEqual(27);
    expect(fallback.animals.length).toBe(27);
    const fallbackIds = new Set(fallback.animals.map((a) => a.id));
    expect(fallbackIds.size).toBe(fallback.animals.length);

    expect(snapshot.animals).toHaveLength(8);
    const snapshotIds = new Set(snapshot.animals.map((a) => a.id));
    expect(snapshotIds.size).toBe(8);
    expect(snapshotIds.has('mb-2911040-4262-84830876')).toBe(true);
    for (const dataset of CURATED_ATN_DATASETS) {
      expect(snapshotIds.has(dataset.id)).toBe(true);
    }

    const merged = mergeAndDedupeFleet([...snapshot.animals, ...fallback.animals]);
    expect(merged).toHaveLength(35);
    expect(new Set(merged.map((a) => a.id)).size).toBe(35);

    const luna = fallback.animals.find((a) => a.id === 'luna-01');
    expect(luna).toBeDefined();
    expect(luna!.latestFix.lon).toBeLessThan(-50);
    expect(luna!.latestFix.lon).toBeGreaterThan(-80);
    for (const fix of luna!.fixes) {
      expect(fix.lon).toBeLessThan(-50);
      expect(fix.lon).toBeGreaterThan(-80);
    }

    const kuaka = fallback.animals.find((a) => a.id === 'kuaka-e7');
    expect(kuaka).toBeDefined();
    expect(kuaka!.commonName).toBe('Bar-tailed Godwit');
  });

  it('splits synthetic eastward and westward ±180° tracks cleanly without >180° jumps', () => {
    const syntheticCoords: GeoCoord[] = [
      [178.5, -12.0],
      [179.6, -13.65],
      [-179.4, -13.95], // eastward across +180 -> -180
      [-178.2, -14.1],
      [179.8, -14.4], // westward across -180 -> +180
      [178.9, -14.7],
    ];

    const pieces = splitSegmentAtAntimeridian([179.6, -13.65], [-179.4, -13.95]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]![1]![0]).toBe(180);
    expect(pieces[1]![0]![0]).toBe(-180);
    expect(pieces[0]![1]![1]).toBeCloseTo(pieces[1]![0]![1], 6);

    const lines = splitTrackAtAntimeridian(syntheticCoords);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      for (let i = 1; i < line.length; i += 1) {
        expect(Math.abs(line[i]![0] - line[i - 1]![0])).toBeLessThanOrEqual(180);
      }
    }

    // Server normalizer must also compute short antimeridian distance
    const serverNormalized = serverNormalizeTelemetryFixes(
      'syn-cross',
      [
        { timestampMs: 1_700_000_000_000, lat: -13.65, lon: 179.6 },
        { timestampMs: 1_700_021_600_000, lat: -13.95, lon: -179.4 },
      ],
      'REPTILE',
    );
    expect(serverNormalized[1]!.isOutlierSpike).toBe(false);
    expect(serverNormalized[1]!.segmentDistanceKm).toBeGreaterThan(85);
    expect(serverNormalized[1]!.segmentDistanceKm).toBeLessThan(115);

    // Argos uncertainty polygons near +179.99° must split cleanly across ±180°
    const poly = createUncertaintyCircleGeometry(-13.8, 179.98, 15000);
    expect(poly).not.toBeNull();
    expect(poly?.type).toBe('MultiPolygon');
  });

  it('interpolates animal coordinates smoothly across ±180° for t in [0, 1] without crossing 0° prime meridian', () => {
    const fleet = loadFallbackFleet();
    const kalani = fleet.animals.find((a) => a.id === 'kalani-7')!;

    // Find the exact crossing pair in kalani-7
    const crossIdx = kalani.fixes.findIndex(
      (fix, idx) => idx > 0 && Math.abs(fix.lon - kalani.fixes[idx - 1]!.lon) > 180,
    );
    expect(crossIdx).toBeGreaterThan(0);

    const fixA = kalani.fixes[crossIdx - 1]!;
    const fixB = kalani.fixes[crossIdx]!;
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      const targetMs = fixA.timestampMs + (fixB.timestampMs - fixA.timestampMs) * t;
      const frame = interpolateAnimalAtTimestamp(kalani, targetMs);
      expect(frame).not.toBeNull();
      expect(Number.isFinite(frame!.lat)).toBe(true);
      expect(Number.isFinite(frame!.lon)).toBe(true);
      expect(Math.abs(frame!.lon)).toBeGreaterThan(179);
    }

    // Synthetic minimal 2-fix crossing dossier from +179.6° to -179.4°
    const t0 = 1_730_000_000_000;
    const t1 = t0 + 3_600_000;
    const syntheticFixes: TelemetryFix[] = normalizeTelemetryFixes(
      [
        {
          id: 'syn-1',
          timestamp: new Date(t0).toISOString(),
          timestampMs: t0,
          lat: -13.65,
          lon: 179.6,
          altitudeOrDepthMeters: -120,
          groundSpeedKmh: null,
          speedIsDerived: true,
          headingDeg: null,
          externalTempC: null,
          tagVoltage: null,
          argosLc: '1',
          accuracyRadiusMeters: 1500,
          sensorType: 'Argos Doppler PTT',
          segmentDistanceKm: 0,
          isOutlierSpike: false,
        },
        {
          id: 'syn-2',
          timestamp: new Date(t1).toISOString(),
          timestampMs: t1,
          lat: -13.95,
          lon: -179.4,
          altitudeOrDepthMeters: -140,
          groundSpeedKmh: null,
          speedIsDerived: true,
          headingDeg: null,
          externalTempC: null,
          tagVoltage: null,
          argosLc: '1',
          accuracyRadiusMeters: 1500,
          sensorType: 'Argos Doppler PTT',
          segmentDistanceKm: 0,
          isOutlierSpike: false,
        },
      ],
      'REPTILE',
    );

    const syntheticDossier: AnimalDossier = {
      ...kalani,
      id: 'synthetic-antimeridian',
      fixes: syntheticFixes,
      latestFix: syntheticFixes[1]!,
      kinematics: computeAnimalKinematics(syntheticFixes, 'REPTILE', t1),
    };

    for (let step = 0; step <= 10; step += 1) {
      const t = step / 10;
      const frame = interpolateAnimalAtTimestamp(
        syntheticDossier,
        t0 + (t1 - t0) * t,
      );
      expect(frame).not.toBeNull();
      expect(Math.abs(frame!.lon)).toBeGreaterThan(179);
      expect(Math.abs(frame!.lon)).toBeLessThanOrEqual(180);
    }
  });
});
