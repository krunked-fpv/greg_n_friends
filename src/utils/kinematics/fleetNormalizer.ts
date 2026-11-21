import type {
  AnimalDossier,
  InterpolatedAnimalFrame,
} from '../../types/telemetry';
import {
  computeAnimalKinematics,
  normalizeTelemetryFixes,
} from './math';
import { computeSolarPosition } from './solar';

export type KinematicsWorkerRequest =
  | {
      type: 'NORMALIZE_FLEET';
      requestId: number;
      animals: AnimalDossier[];
      referenceNowMs: number;
    }
  | {
      type: 'SET_FLEET';
      animals: AnimalDossier[];
    }
  | {
      type: 'INTERPOLATE_FLEET';
      requestId: number;
      timestampMs: number;
    };

export type KinematicsWorkerResponse =
  | {
      type: 'NORMALIZE_FLEET_RESULT';
      requestId: number;
      animals: AnimalDossier[];
    }
  | {
      type: 'INTERPOLATE_FLEET_RESULT';
      requestId: number;
      timestampMs: number;
      frames: InterpolatedAnimalFrame[];
    };

export function normalizeAnimalDossier(
  animal: AnimalDossier,
  referenceNowMs: number = Date.now(),
): AnimalDossier {
  const safeNowMs = Number.isFinite(referenceNowMs)
    ? referenceNowMs
    : Date.now();
  const normalizedFixes = normalizeTelemetryFixes(animal.fixes, animal.guild);
  const kinematics = computeAnimalKinematics(
    normalizedFixes,
    animal.guild,
    safeNowMs,
  );
  const latestFix =
    normalizedFixes.length > 0
      ? normalizedFixes[normalizedFixes.length - 1]!
      : animal.latestFix;

  const solar = computeSolarPosition(
    latestFix?.lat ?? 0,
    latestFix?.lon ?? 0,
    safeNowMs,
  );

  return {
    ...animal,
    fixes: normalizedFixes,
    latestFix,
    kinematics,
    environment: {
      ...animal.environment,
      solarElevationDeg: solar.solarElevationDeg,
      solarPhase: solar.solarPhase,
    },
  };
}

export function normalizeFleetBatch(
  animals: readonly AnimalDossier[],
  referenceNowMs: number = Date.now(),
): AnimalDossier[] {
  return animals.map((animal) =>
    normalizeAnimalDossier(animal, referenceNowMs),
  );
}
