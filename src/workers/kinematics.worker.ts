import type {
  AnimalDossier,
  InterpolatedAnimalFrame,
} from '../types/telemetry';
import { interpolateFleetAtTimestamp } from '../utils/kinematics/interpolator';
import {
  computeAnimalKinematics,
  normalizeTelemetryFixes,
} from '../utils/kinematics/math';
import { computeSolarPosition } from '../utils/kinematics/solar';

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

let workerFleet: AnimalDossier[] = [];

const hasDedicatedWorkerGlobal =
  typeof self !== 'undefined' &&
  typeof (self as unknown as { document?: unknown }).document === 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage ===
    'function';

interface WorkerGlobalScopeLike {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<KinematicsWorkerRequest>) => void,
  ) => void;
  postMessage: (message: KinematicsWorkerResponse) => void;
}

if (hasDedicatedWorkerGlobal) {
  const workerScope = self as unknown as WorkerGlobalScopeLike;

  workerScope.addEventListener(
    'message',
    (event: MessageEvent<KinematicsWorkerRequest>) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'SET_FLEET') {
        workerFleet = Array.isArray(msg.animals) ? msg.animals : [];
        return;
      }

      if (msg.type === 'NORMALIZE_FLEET') {
        const normalized = normalizeFleetBatch(msg.animals, msg.referenceNowMs);
        workerFleet = normalized;
        const response: KinematicsWorkerResponse = {
          type: 'NORMALIZE_FLEET_RESULT',
          requestId: msg.requestId,
          animals: normalized,
        };
        workerScope.postMessage(response);
        return;
      }

      if (msg.type === 'INTERPOLATE_FLEET') {
        const frames = interpolateFleetAtTimestamp(
          workerFleet,
          msg.timestampMs,
        );
        const response: KinematicsWorkerResponse = {
          type: 'INTERPOLATE_FLEET_RESULT',
          requestId: msg.requestId,
          timestampMs: msg.timestampMs,
          frames,
        };
        workerScope.postMessage(response);
      }
    },
  );
}
