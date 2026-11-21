import { describe, expect, it } from 'vitest';
import {
  computeAnimalKinematics as serverComputeAnimalKinematics,
  normalizeTelemetryFixes as serverNormalizeTelemetryFixes,
} from '../../server/kinematics.ts';
import { EcologyEnricher } from '../../src/services/ecologyEnricher.ts';
import { EnvironmentEnricher } from '../../src/services/environmentEnricher.ts';
import { TelemetryClient } from '../../src/services/telemetryClient.ts';
import type {
  AnimalDossier,
  AnimalEcology,
  AnimalEnvironment,
  TelemetryFix,
} from '../../src/types/telemetry.ts';
import {
  buildFleetGeoJsonFromIndex,
  buildPrecomputedTrackIndex,
} from '../../src/utils/geo/trackGeoJson.ts';
import { interpolateAnimalAtTimestamp } from '../../src/utils/kinematics/interpolator.ts';
import {
  computeAnimalKinematics,
  normalizeTelemetryFixes,
} from '../../src/utils/kinematics/math.ts';
import { normalizeAnimalDossier } from '../../src/workers/kinematics.worker.ts';

function assertNoNonFiniteNumbers(value: unknown, trail = 'root'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `Non-finite number at ${trail}: ${value}`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertNoNonFiniteNumbers(item, `${trail}[${idx}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNoNonFiniteNumbers(v, `${trail}.${k}`);
    }
  }
}

function makeSparseFix(overrides: Partial<TelemetryFix> = {}): TelemetryFix {
  const ts = overrides.timestampMs ?? 1_730_000_000_000;
  return {
    id: overrides.id ?? 'sparse-fix-1',
    timestamp: overrides.timestamp ?? new Date(ts).toISOString(),
    timestampMs: ts,
    lat: overrides.lat ?? 12.34,
    lon: overrides.lon ?? -45.67,
    altitudeOrDepthMeters: null,
    groundSpeedKmh: null,
    speedIsDerived: true,
    headingDeg: null,
    externalTempC: null,
    tagVoltage: null,
    argosLc: null,
    accuracyRadiusMeters: null,
    sensorType: 'GPS-GSM',
    segmentDistanceKm: 0,
    isOutlierSpike: false,
    ...overrides,
  };
}

function makeSparseDossier(fixes: TelemetryFix[]): AnimalDossier {
  const latestFix = fixes[fixes.length - 1] ?? makeSparseFix();
  const kinematics = computeAnimalKinematics(fixes, 'AVIAN', 1_730_100_000_000);
  return {
    id: 'sparse-animal',
    localIdentifier: 'sparse-01',
    nickname: 'Sparse Tag',
    scientificName: 'Ciconia ciconia',
    commonName: 'White Stork',
    guild: 'AVIAN',
    sex: 'Unknown',
    lifeStage: 'Adult',
    massKg: null,
    deploymentStartIso: fixes[0]?.timestamp ?? new Date(1_730_000_000_000).toISOString(),
    feedStatus: 'LIVE_API',
    sourceProvider: 'MOVEBANK_PUBLIC',
    studyId: '999999',
    diagnosticStatus: 'OK',
    colorHex: '#22d3ee',
    latestFix,
    fixes,
    kinematics,
    ecology: {
      photoUrl: null,
      photoAttribution: null,
      iucnStatus: 'DD',
      taxonomy: {
        kingdom: 'Animalia',
        phylum: 'Chordata',
        class: 'Aves',
        order: 'Ciconiiformes',
        family: 'Ciconiidae',
        genus: 'Ciconia',
        species: 'Ciconia ciconia',
      },
      summaryExtract: 'Sparse fallback summary.',
      wikiUrl: null,
      enriched: false,
    },
    environment: {
      airTempC: null,
      windSpeedKmh: null,
      windDirectionDeg: null,
      surfacePressureHpa: null,
      elevationMeters: null,
      seaSurfaceTempC: null,
      waveHeightMeters: null,
      oceanCurrentKmh: null,
      solarPhase: 'Daylight',
      solarElevationDeg: 0,
      regionLabel: 'North Atlantic Ocean',
      fetchedAt: null,
    },
    attribution: {
      studyTitle: 'Sparse Study',
      principalInvestigators: 'Unknown PI',
      institution: 'Field Station',
      studyUrl: 'https://www.movebank.org',
      licenseTerms: 'CC0',
      licenseMd5Required: false,
    },
  };
}

describe('Challenge 4: Sparse telemetry, 0/1-fix, duplicate timestamps & offline timeout resilience', () => {
  it('handles 0-fix and 1-fix tracks with all optional sensor fields null without NaN or Infinity', () => {
    // 0-fix track (client + server)
    const clientZeroFixes = normalizeTelemetryFixes([], 'MARINE');
    expect(clientZeroFixes).toEqual([]);
    const clientZeroKin = computeAnimalKinematics([], 'MARINE', 1_730_000_000_000);
    assertNoNonFiniteNumbers(clientZeroKin, 'clientZeroKin');

    const serverZeroFixes = serverNormalizeTelemetryFixes('zero', [], 'MARINE');
    expect(serverZeroFixes).toEqual([]);
    const serverZeroKin = serverComputeAnimalKinematics([], 1_730_000_000_000);
    assertNoNonFiniteNumbers(serverZeroKin, 'serverZeroKin');

    const zeroDossier = makeSparseDossier([]);
    expect(interpolateAnimalAtTimestamp(zeroDossier, 1_730_000_000_000)).toBeNull();
    const zeroNormalized = normalizeAnimalDossier(zeroDossier, 1_730_000_000_000);
    assertNoNonFiniteNumbers(zeroNormalized, 'zeroNormalized');

    // 1-fix track missing groundSpeedKmh, altitudeOrDepthMeters, externalTempC, tagVoltage, argosLc
    const oneFix = makeSparseFix({ id: 'one-1' });
    const clientOneFixes = normalizeTelemetryFixes([oneFix], 'TERRESTRIAL');
    expect(clientOneFixes).toHaveLength(1);
    const clientOneKin = computeAnimalKinematics(clientOneFixes, 'TERRESTRIAL', 1_730_050_000_000);
    assertNoNonFiniteNumbers(clientOneKin, 'clientOneKin');
    expect(clientOneKin.hasAltitudeOrDepth).toBe(false);

    const serverOneFixes = serverNormalizeTelemetryFixes(
      'one',
      [{ timestampMs: oneFix.timestampMs, lat: oneFix.lat, lon: oneFix.lon }],
      'TERRESTRIAL',
    );
    const serverOneKin = serverComputeAnimalKinematics(serverOneFixes, 1_730_050_000_000);
    assertNoNonFiniteNumbers(serverOneKin, 'serverOneKin');

    const oneDossier = makeSparseDossier(clientOneFixes);
    const frame = interpolateAnimalAtTimestamp(oneDossier, oneFix.timestampMs + 5000);
    expect(frame).not.toBeNull();
    assertNoNonFiniteNumbers(frame, 'oneFixFrame');

    const index = buildPrecomputedTrackIndex([oneDossier], 'speed', oneDossier.id, 1_730_050_000_000);
    const bundle = buildFleetGeoJsonFromIndex(index, {
      trackColorMode: 'altitude',
      selectedAnimalId: oneDossier.id,
      windowStartMs: oneFix.timestampMs,
      windowEndMs: oneFix.timestampMs + 10_000,
      currentMs: oneFix.timestampMs,
      referenceMs: 1_730_050_000_000,
    });
    assertNoNonFiniteNumbers(bundle, 'oneFixGeoJson');
  });

  it('handles duplicate timestamps and missing optional sensors cleanly across kinematics, worker & GeoJSON', () => {
    const tDup = 1_730_000_000_000;
    const dupFixes: TelemetryFix[] = [
      makeSparseFix({ id: 'dup-1', timestampMs: tDup, lat: 40.0, lon: -10.0 }),
      makeSparseFix({ id: 'dup-2', timestampMs: tDup, lat: 40.02, lon: -10.02 }),
      makeSparseFix({ id: 'dup-3', timestampMs: tDup, lat: 40.02, lon: -10.02 }),
      makeSparseFix({ id: 'dup-4', timestampMs: tDup + 3_600_000, lat: 40.2, lon: -10.15 }),
    ];

    const normalized = normalizeTelemetryFixes(dupFixes, 'AVIAN');
    assertNoNonFiniteNumbers(normalized, 'dupNormalizedFixes');

    const kinematics = computeAnimalKinematics(normalized, 'AVIAN', tDup + 7_200_000);
    assertNoNonFiniteNumbers(kinematics, 'dupKinematics');

    const serverDup = serverNormalizeTelemetryFixes(
      'dup',
      dupFixes.map((f) => ({ timestampMs: f.timestampMs, lat: f.lat, lon: f.lon })),
      'AVIAN',
    );
    const serverDupKin = serverComputeAnimalKinematics(serverDup, tDup + 7_200_000);
    assertNoNonFiniteNumbers(serverDupKin, 'serverDupKinematics');

    const dossier = normalizeAnimalDossier(makeSparseDossier(normalized), tDup + 7_200_000);
    assertNoNonFiniteNumbers(dossier, 'dupDossier');

    const frameAtDup = interpolateAnimalAtTimestamp(dossier, tDup);
    const frameMid = interpolateAnimalAtTimestamp(dossier, tDup + 1_800_000);
    assertNoNonFiniteNumbers(frameAtDup, 'frameAtDup');
    assertNoNonFiniteNumbers(frameMid, 'frameMid');

    const index = buildPrecomputedTrackIndex([dossier], 'speed', dossier.id, tDup + 7_200_000);
    const bundle = buildFleetGeoJsonFromIndex(index, {
      trackColorMode: 'speed',
      selectedAnimalId: dossier.id,
      windowStartMs: tDup,
      windowEndMs: tDup + 3_600_000,
      currentMs: tDup + 1_800_000,
      referenceMs: tDup + 7_200_000,
    });
    assertNoNonFiniteNumbers(bundle, 'dupGeoJsonBundle');
  });

  it('survives simulated offline timeouts and network errors in EcologyEnricher, EnvironmentEnricher & TelemetryClient', async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const abortingTimeoutFetch: typeof fetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'AbortError')),
            { once: true },
          );
        });

      const ecologyFallback: AnimalEcology = {
        photoUrl: null,
        photoAttribution: null,
        iucnStatus: 'VU',
        taxonomy: {
          kingdom: 'Animalia',
          phylum: 'Chordata',
          class: 'Reptilia',
          order: 'Testudines',
          family: 'Dermochelyidae',
          genus: 'Dermochelys',
          species: 'Dermochelys coriacea',
        },
        summaryExtract: 'Offline fallback summary.',
        wikiUrl: null,
        enriched: false,
      };

      const envFallback: AnimalEnvironment = {
        airTempC: null,
        windSpeedKmh: null,
        windDirectionDeg: null,
        surfacePressureHpa: null,
        elevationMeters: null,
        seaSurfaceTempC: null,
        waveHeightMeters: null,
        oceanCurrentKmh: null,
        solarPhase: 'Daylight',
        solarElevationDeg: 15,
        regionLabel: 'Unknown',
        fetchedAt: null,
      };

      const ecologyEnricher = new EcologyEnricher({
        fetchFn: abortingTimeoutFetch,
        timeoutMs: 40,
      });
      const envEnricher = new EnvironmentEnricher({
        fetchFn: abortingTimeoutFetch,
        timeoutMs: 40,
      });

      const [ecoTimeout, envTimeout] = await Promise.all([
        ecologyEnricher.enrichAnimalEcology('Dermochelys coriacea', ecologyFallback),
        envEnricher.enrichAnimalEnvironment({
          lat: -13.65,
          lon: 179.6,
          guild: 'REPTILE',
          altitudeOrDepthMeters: -400,
          timestampMs: 1_730_000_000_000,
          fallback: envFallback,
        }),
      ]);

      expect(ecoTimeout).toEqual(ecologyFallback);
      expect(envTimeout.regionLabel).toBe('South Pacific Ocean');
      assertNoNonFiniteNumbers(envTimeout, 'envTimeout');

      // Also test immediate network failures + HTTP 500s
      const failingFetch: typeof fetch = async () => {
        throw new TypeError('Failed to fetch (simulated offline)');
      };

      const ecologyOffline = new EcologyEnricher({
        fetchFn: failingFetch,
        timeoutMs: 50,
      });
      const envOffline = new EnvironmentEnricher({
        fetchFn: failingFetch,
        timeoutMs: 50,
      });

      const [ecoErr, envErr] = await Promise.all([
        ecologyOffline.enrichAnimalEcology('Carcharodon carcharias', ecologyFallback),
        envOffline.enrichAnimalEnvironment({
          lat: 36.8,
          lon: -122.1,
          guild: 'MARINE',
          timestampMs: 1_730_000_000_000,
          fallback: envFallback,
        }),
      ]);

      expect(ecoErr.iucnStatus).toBe('VU');
      assertNoNonFiniteNumbers(envErr, 'envOffline');

      // TelemetryClient completely offline -> resolves empty fleet cleanly without throwing or unhandled rejection
      const client = new TelemetryClient({
        fetchFn: failingFetch,
        healthTimeoutMs: 30,
        apiTimeoutMs: 30,
        atnTimeoutMs: 30,
        skipWorker: true,
      });
      const offlineFleet = await client.loadFleet(1_730_000_000_000);
      expect(offlineFleet.animals).toEqual([]);
      expect(offlineFleet.connectionMode).toBe('STATIC_DECK');

      const studyOffline = await client.importMovebankStudy('2911040');
      expect(studyOffline.diagnosticStatus).toBe('AUTH_REQUIRED');

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
