import type { AnimalDossier } from '../types/telemetry';
import {
  normalizeAnimalDossier,
  normalizeFleetBatch,
  type KinematicsWorkerRequest,
  type KinematicsWorkerResponse,
} from '../utils/kinematics/fleetNormalizer';
import { interpolateFleetAtTimestamp } from '../utils/kinematics/interpolator';

export {
  normalizeAnimalDossier,
  normalizeFleetBatch,
  type KinematicsWorkerRequest,
  type KinematicsWorkerResponse,
};

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
