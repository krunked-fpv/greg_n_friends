import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AnimalDossier,
  ConnectionMode,
  FeedStatus,
  FleetResponse,
  ProxyHealthResponse,
  StudyImportResponse,
} from '../src/types/telemetry.ts';
import { TelemetryCache } from './cache.ts';
import {
  computeAnimalKinematics,
  formatFreshnessLabel,
} from './kinematics.ts';
import { MovebankQueue } from './movebankQueue.ts';
import { AtnErddapProvider } from './providers/atnErddapProvider.ts';
import {
  FEATURED_MOVEBANK_STUDY_ID,
  MovebankProvider,
} from './providers/movebankProvider.ts';

export interface TelemetryProviderOptions {
  queue?: MovebankQueue;
  cache?: TelemetryCache;
  movebank?: MovebankProvider;
  atn?: AtnErddapProvider;
  fallbackFleetPath?: string;
}

function withRefreshedFeedAndFreshness(
  animals: AnimalDossier[],
  targetFeedStatus: FeedStatus,
  nowMs: number,
): AnimalDossier[] {
  return animals.map((animal) => {
    const feedStatus: FeedStatus =
      animal.feedStatus === 'DEMO_FEED' ? 'DEMO_FEED' : targetFeedStatus;
    const pingFreshnessMs = Math.max(0, nowMs - animal.latestFix.timestampMs);
    return {
      ...animal,
      feedStatus,
      kinematics: {
        ...animal.kinematics,
        pingFreshnessMs,
        pingFreshnessLabel: formatFreshnessLabel(pingFreshnessMs),
      },
    };
  });
}

function shiftDemoFleetIfStale(
  fleet: FleetResponse,
  nowMs: number,
): AnimalDossier[] {
  const generatedMs = Date.parse(fleet.generatedAt);
  const shiftMs = Number.isFinite(generatedMs) ? Math.max(0, nowMs - generatedMs) : 0;

  if (shiftMs < 60 * 60 * 1000) {
    return withRefreshedFeedAndFreshness(fleet.animals, 'DEMO_FEED', nowMs);
  }

  return fleet.animals.map((animal) => {
    const shiftedFixes = animal.fixes.map((fix) => {
      const nextMs = fix.timestampMs + shiftMs;
      return {
        ...fix,
        timestampMs: nextMs,
        timestamp: new Date(nextMs).toISOString(),
      };
    });
    const latestFix = shiftedFixes[shiftedFixes.length - 1] ?? animal.latestFix;
    return {
      ...animal,
      feedStatus: 'DEMO_FEED',
      deploymentStartIso: shiftedFixes[0]?.timestamp ?? animal.deploymentStartIso,
      latestFix,
      fixes: shiftedFixes,
      kinematics: computeAnimalKinematics(shiftedFixes, nowMs),
    };
  });
}

export function buildFleetResponse(
  animals: AnimalDossier[],
  connectionMode: ConnectionMode,
  generatedAtMs: number = Date.now(),
): FleetResponse {
  let liveCount = 0;
  let cachedCount = 0;
  let demoCount = 0;

  for (const animal of animals) {
    if (animal.feedStatus === 'LIVE_API') liveCount += 1;
    else if (animal.feedStatus === 'CACHED') cachedCount += 1;
    else demoCount += 1;
  }

  return {
    generatedAt: new Date(generatedAtMs).toISOString(),
    connectionMode,
    animals,
    sourceSummary: {
      liveCount,
      cachedCount,
      demoCount,
    },
  };
}

export class TelemetryProvider {
  public readonly queue: MovebankQueue;
  public readonly cache: TelemetryCache;
  public readonly movebank: MovebankProvider;
  public readonly atn: AtnErddapProvider;
  private readonly fallbackFleetPath: string;
  private readonly startedAtMs: number;

  constructor(options?: TelemetryProviderOptions) {
    this.queue = options?.queue ?? new MovebankQueue({ minIntervalMs: 450 });
    this.cache = options?.cache ?? new TelemetryCache();
    this.movebank =
      options?.movebank ?? new MovebankProvider({ queue: this.queue });
    this.atn = options?.atn ?? new AtnErddapProvider();
    this.fallbackFleetPath =
      options?.fallbackFleetPath ??
      path.resolve(process.cwd(), 'public', 'data', 'fallback-fleet.json');
    this.startedAtMs = Date.now();
  }

  public getHealth(): ProxyHealthResponse {
    const nowMs = Date.now();
    return {
      status: 'ok',
      movebankAuthConfigured: this.movebank.isAuthConfigured(),
      queueDepth: this.queue.queueDepth,
      cacheEntries: this.cache.getEntryCount(),
      uptimeSeconds: Math.max(0, Math.floor((nowMs - this.startedAtMs) / 1000)),
      timestampIso: new Date(nowMs).toISOString(),
    };
  }

  public async getStudy(
    studyIdRaw: string,
    licenseMd5?: string,
  ): Promise<StudyImportResponse> {
    const studyId = studyIdRaw.trim();
    const cleanMd5 = licenseMd5?.trim() || undefined;
    const cacheKey = `movebank:study:${studyId}:${cleanMd5 ?? 'none'}`;
    const nowMs = Date.now();

    const cached = await this.cache.get<StudyImportResponse>(cacheKey);
    if (cached) {
      return {
        ...cached.value,
        feedStatus: 'CACHED',
        animals: withRefreshedFeedAndFreshness(
          cached.value.animals,
          'CACHED',
          nowMs,
        ),
      };
    }

    const res = await this.movebank.fetchStudy(studyId, {
      licenseMd5: cleanMd5,
      includeStudyMetadata: true,
      referenceNowMs: nowMs,
    });

    await this.cache.set(cacheKey, res, {
      diagnosticStatus: res.diagnosticStatus,
    });

    return res;
  }

  public async getFeaturedMovebankAnimals(
    nowMs: number = Date.now(),
  ): Promise<AnimalDossier[]> {
    const cacheKey = `movebank:featured:${FEATURED_MOVEBANK_STUDY_ID}`;
    const cached = await this.cache.get<StudyImportResponse>(cacheKey);
    if (cached) {
      return withRefreshedFeedAndFreshness(cached.value.animals, 'CACHED', nowMs);
    }

    try {
      const res = await this.movebank.fetchFeaturedStudy(nowMs);
      if (res.diagnosticStatus === 'OK' && res.animals.length > 0) {
        await this.cache.set(cacheKey, res, {
          diagnosticStatus: res.diagnosticStatus,
        });
        return res.animals;
      }
    } catch {
      // Fall back gracefully when Movebank public API is unreachable/throttled.
    }
    return [];
  }

  public async getAtnMarineFleet(
    nowMs: number = Date.now(),
  ): Promise<FleetResponse> {
    const cacheKey = 'atn:curated-marine';
    const cached = await this.cache.get<AnimalDossier[]>(cacheKey);
    if (cached) {
      const animals = withRefreshedFeedAndFreshness(cached.value, 'CACHED', nowMs);
      return buildFleetResponse(animals, 'PROXY_LIVE', nowMs);
    }

    const animals = await this.atn.fetchCuratedMarineFleet(nowMs);
    if (animals.length > 0) {
      await this.cache.set(cacheKey, animals, { diagnosticStatus: 'OK' });
    }
    return buildFleetResponse(animals, 'PROXY_LIVE', nowMs);
  }

  public async loadFallbackDemoAnimals(
    nowMs: number = Date.now(),
  ): Promise<AnimalDossier[]> {
    try {
      const raw = await fs.readFile(this.fallbackFleetPath, 'utf8');
      const parsed = JSON.parse(raw) as FleetResponse | AnimalDossier[];
      const fleet: FleetResponse = Array.isArray(parsed)
        ? buildFleetResponse(parsed, 'STATIC_DECK', nowMs)
        : parsed;
      return shiftDemoFleetIfStale(fleet, nowMs);
    } catch {
      return [];
    }
  }

  public async getFleet(options?: {
    includeDemoSeed?: boolean;
  }): Promise<FleetResponse> {
    const nowMs = Date.now();
    const includeDemo = options?.includeDemoSeed ?? true;

    const [mbRes, atnRes, demoRes] = await Promise.allSettled([
      this.getFeaturedMovebankAnimals(nowMs),
      this.getAtnMarineFleet(nowMs),
      includeDemo ? this.loadFallbackDemoAnimals(nowMs) : Promise.resolve([]),
    ]);

    const merged = new Map<string, AnimalDossier>();

    if (mbRes.status === 'fulfilled') {
      for (const a of mbRes.value) merged.set(a.id, a);
    }
    if (atnRes.status === 'fulfilled') {
      for (const a of atnRes.value.animals) merged.set(a.id, a);
    }
    if (demoRes.status === 'fulfilled') {
      for (const a of demoRes.value) {
        if (!merged.has(a.id)) merged.set(a.id, a);
      }
    }

    return buildFleetResponse(Array.from(merged.values()), 'PROXY_LIVE', nowMs);
  }

  public async harvestUpstreamSnapshot(): Promise<{
    fleet: FleetResponse;
    warnings: string[];
  }> {
    const nowMs = Date.now();
    const warnings: string[] = [];

    const [mbSettled, atnSettled] = await Promise.allSettled([
      this.movebank.fetchFeaturedStudy(nowMs),
      this.atn.fetchCuratedMarineFleet(nowMs),
    ]);

    const harvested: AnimalDossier[] = [];

    if (mbSettled.status === 'fulfilled') {
      if (mbSettled.value.diagnosticStatus === 'OK' && mbSettled.value.animals.length > 0) {
        harvested.push(
          ...withRefreshedFeedAndFreshness(mbSettled.value.animals, 'CACHED', nowMs),
        );
      } else {
        warnings.push(
          `Movebank featured study returned ${mbSettled.value.diagnosticStatus}: ${mbSettled.value.message}`,
        );
      }
    } else {
      warnings.push(`Movebank featured study error: ${String(mbSettled.reason)}`);
    }

    if (atnSettled.status === 'fulfilled') {
      if (atnSettled.value.length > 0) {
        harvested.push(
          ...withRefreshedFeedAndFreshness(atnSettled.value, 'CACHED', nowMs),
        );
      } else {
        warnings.push('IOOS ATN ERDDAP returned 0 trajectories.');
      }
    } else {
      warnings.push(`IOOS ATN ERDDAP error: ${String(atnSettled.reason)}`);
    }

    return {
      fleet: buildFleetResponse(harvested, 'CI_SNAPSHOT', nowMs),
      warnings,
    };
  }
}
