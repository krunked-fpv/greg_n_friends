import type {
  AnimalDossier,
  InterpolatedAnimalFrame,
} from '../types/telemetry';
import { interpolateFleetAtTimestamp } from '../utils/kinematics/interpolator';
import {
  normalizeFleetBatch,
  type KinematicsWorkerRequest,
  type KinematicsWorkerResponse,
} from '../utils/kinematics/fleetNormalizer';

interface PendingNormalize {
  resolve: (animals: AnimalDossier[]) => void;
  animals: AnimalDossier[];
  referenceNowMs: number;
}

interface PendingInterpolate {
  resolve: (frames: InterpolatedAnimalFrame[]) => void;
  timestampMs: number;
}

export class KinematicsBridge {
  private worker: Worker | null = null;
  private workerDisabled = false;
  private nextRequestId = 1;
  private cachedFleet: AnimalDossier[] = [];
  private pendingNormalize = new Map<number, PendingNormalize>();
  private pendingInterpolate = new Map<number, PendingInterpolate>();

  private ensureWorker(): Worker | null {
    if (this.workerDisabled) return null;
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') {
      this.workerDisabled = true;
      return null;
    }

    try {
      const worker = new Worker(
        new URL('./kinematics.worker.ts', import.meta.url),
        { type: 'module' },
      );

      worker.addEventListener(
        'message',
        (event: MessageEvent<KinematicsWorkerResponse>) => {
          const msg = event.data;
          if (!msg) return;

          if (msg.type === 'NORMALIZE_FLEET_RESULT') {
            const pending = this.pendingNormalize.get(msg.requestId);
            if (pending) {
              this.pendingNormalize.delete(msg.requestId);
              this.cachedFleet = msg.animals;
              pending.resolve(msg.animals);
            }
            return;
          }

          if (msg.type === 'INTERPOLATE_FLEET_RESULT') {
            const pending = this.pendingInterpolate.get(msg.requestId);
            if (pending) {
              this.pendingInterpolate.delete(msg.requestId);
              pending.resolve(msg.frames);
            }
          }
        },
      );

      worker.addEventListener('error', () => {
        this.fallbackAllPendingAndDisable();
      });

      this.worker = worker;
      if (this.cachedFleet.length > 0) {
        const initMsg: KinematicsWorkerRequest = {
          type: 'SET_FLEET',
          animals: this.cachedFleet,
        };
        worker.postMessage(initMsg);
      }
      return worker;
    } catch {
      this.workerDisabled = true;
      return null;
    }
  }

  private fallbackAllPendingAndDisable(): void {
    this.workerDisabled = true;
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore termination failures
      }
      this.worker = null;
    }

    this.pendingNormalize.forEach((pending, id) => {
      this.pendingNormalize.delete(id);
      const normalized = normalizeFleetBatch(
        pending.animals,
        pending.referenceNowMs,
      );
      this.cachedFleet = normalized;
      pending.resolve(normalized);
    });

    this.pendingInterpolate.forEach((pending, id) => {
      this.pendingInterpolate.delete(id);
      pending.resolve(
        interpolateFleetAtTimestamp(this.cachedFleet, pending.timestampMs),
      );
    });
  }

  isUsingWorker(): boolean {
    return !this.workerDisabled && typeof Worker !== 'undefined';
  }

  setFleet(animals: AnimalDossier[]): void {
    this.cachedFleet = animals;
    const worker = this.ensureWorker();
    if (worker) {
      const msg: KinematicsWorkerRequest = {
        type: 'SET_FLEET',
        animals,
      };
      worker.postMessage(msg);
    }
  }

  async normalizeFleet(
    animals: AnimalDossier[],
    referenceNowMs: number = Date.now(),
  ): Promise<AnimalDossier[]> {
    const worker = this.ensureWorker();
    if (!worker) {
      const normalized = normalizeFleetBatch(animals, referenceNowMs);
      this.cachedFleet = normalized;
      return normalized;
    }

    const requestId = this.nextRequestId++;
    return new Promise<AnimalDossier[]>((resolve) => {
      this.pendingNormalize.set(requestId, {
        resolve,
        animals,
        referenceNowMs,
      });
      try {
        const msg: KinematicsWorkerRequest = {
          type: 'NORMALIZE_FLEET',
          requestId,
          animals,
          referenceNowMs,
        };
        worker.postMessage(msg);
      } catch {
        this.pendingNormalize.delete(requestId);
        this.fallbackAllPendingAndDisable();
        const normalized = normalizeFleetBatch(animals, referenceNowMs);
        this.cachedFleet = normalized;
        resolve(normalized);
      }
    });
  }

  async interpolateFleet(
    timestampMs: number,
  ): Promise<InterpolatedAnimalFrame[]> {
    if (this.cachedFleet.length === 0) {
      return [];
    }

    const worker = this.ensureWorker();
    if (!worker) {
      return interpolateFleetAtTimestamp(this.cachedFleet, timestampMs);
    }

    const requestId = this.nextRequestId++;
    return new Promise<InterpolatedAnimalFrame[]>((resolve) => {
      this.pendingInterpolate.set(requestId, { resolve, timestampMs });
      try {
        const msg: KinematicsWorkerRequest = {
          type: 'INTERPOLATE_FLEET',
          requestId,
          timestampMs,
        };
        worker.postMessage(msg);
      } catch {
        this.pendingInterpolate.delete(requestId);
        this.fallbackAllPendingAndDisable();
        resolve(interpolateFleetAtTimestamp(this.cachedFleet, timestampMs));
      }
    });
  }

  interpolateFleetSync(timestampMs: number): InterpolatedAnimalFrame[] {
    return interpolateFleetAtTimestamp(this.cachedFleet, timestampMs);
  }

  dispose(): void {
    this.fallbackAllPendingAndDisable();
  }
}

export const kinematicsBridge = new KinematicsBridge();
