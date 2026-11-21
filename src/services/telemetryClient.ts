import type {
  AnimalDossier,
  ConnectionMode,
  EcologicalGuild,
  FeedStatus,
  FleetResponse,
  IucnStatus,
  ProxyHealthResponse,
  SensorType,
  StudyAttribution,
  StudyImportResponse,
  TelemetryFix,
} from '../types/telemetry';
import {
  getArgosUncertaintyMeters,
  normalizeArgosLocationClass,
} from '../utils/kinematics/math';
import { kinematicsBridge } from '../workers/kinematicsBridge';

export type FetchLike = typeof fetch;

export interface TelemetryClientOptions {
  fetchFn?: FetchLike;
  healthTimeoutMs?: number;
  apiTimeoutMs?: number;
  atnTimeoutMs?: number;
  skipWorker?: boolean;
}

interface AtnDatasetDescriptor {
  datasetId: string;
  animalId: string;
  nickname: string;
  commonName: string;
  scientificName: string;
  guild: EcologicalGuild;
  colorHex: string;
  iucnStatus: IucnStatus;
  summaryExtract: string;
  attribution: StudyAttribution;
}

const ATN_CURATED_DATASETS: readonly AtnDatasetDescriptor[] = [
  {
    datasetId: 'atn_174822_spotted-seal_trajectory_20180414-20181103',
    animalId: 'atn-174822',
    nickname: 'Bering Seal #174822',
    commonName: 'Spotted Seal',
    scientificName: 'Phoca largha',
    guild: 'MARINE',
    colorHex: '#38bdf8',
    iucnStatus: 'LC',
    summaryExtract:
      'Pagophilic pinniped tracked across Bering Sea pack-ice margins and coastal haul-outs via Wildlife Computers SPOT satellite telemetry.',
    attribution: {
      studyTitle:
        'Spotted seal (Phoca largha) Bering Sea satellite telemetry (PTT 174822)',
      principalInvestigators: 'Josh London',
      institution:
        'Marine Mammal Laboratory, NOAA Alaska Fisheries Science Center',
      studyUrl:
        'https://atn.ioos.us/erddap/tabledap/atn_174822_spotted-seal_trajectory_20180414-20181103.html',
      licenseTerms:
        'NOAA / U.S. Animal Telemetry Network (ATN) public scientific telemetry archive. Acknowledge ATN & NOAA AFSC.',
      licenseMd5Required: false,
    },
  },
  {
    datasetId:
      'atn_94821_blainvilles-beaked-whale_trajectory_20091221-20100111',
    animalId: 'atn-94821',
    nickname: 'Kona Beaked #94821',
    commonName: "Blainville's Beaked Whale",
    scientificName: 'Mesoplodon densirostris',
    guild: 'MARINE',
    colorHex: '#22d3ee',
    iucnStatus: 'LC',
    summaryExtract:
      'Deep-diving ziphiid cetacean tracked off the leeward slope of Hawaiʻi Island using Argos SPOT5 satellite-linked telemetry.',
    attribution: {
      studyTitle:
        "Blainville's beaked whale (Mesoplodon densirostris) Hawaiʻi telemetry (PTT 94821)",
      principalInvestigators: 'Robin W. Baird',
      institution: 'Cascadia Research Collective / IOOS ATN',
      studyUrl:
        'https://atn.ioos.us/erddap/tabledap/atn_94821_blainvilles-beaked-whale_trajectory_20091221-20100111.html',
      licenseTerms:
        'IOOS Animal Telemetry Network (ATN) public dataset. Acknowledge Cascadia Research Collective & IOOS ATN.',
      licenseMd5Required: false,
    },
  },
  {
    datasetId:
      'atn_85568_short-finned-pilot-whale_trajectory_20080705-20080802',
    animalId: 'atn-85568',
    nickname: 'Kona Pilot #85568',
    commonName: 'Short-finned Pilot Whale',
    scientificName: 'Globicephala macrorhynchus',
    guild: 'MARINE',
    colorHex: '#818cf8',
    iucnStatus: 'LC',
    summaryExtract:
      'Island-associated delphinid tracked along deep pelagic escarpments off Hawaiʻi via Argos satellite telemetry.',
    attribution: {
      studyTitle:
        'Short-finned pilot whale (Globicephala macrorhynchus) Hawaiʻi telemetry (PTT 85568)',
      principalInvestigators: 'Robin W. Baird',
      institution: 'Cascadia Research Collective / IOOS ATN',
      studyUrl:
        'https://atn.ioos.us/erddap/tabledap/atn_85568_short-finned-pilot-whale_trajectory_20080705-20080802.html',
      licenseTerms:
        'IOOS Animal Telemetry Network (ATN) public dataset. Acknowledge Cascadia Research Collective & IOOS ATN.',
      licenseMd5Required: false,
    },
  },
];

const FEED_PRIORITY: Record<FeedStatus, number> = {
  LIVE_API: 3,
  CACHED: 2,
  DEMO_FEED: 1,
};

/**
 * Resolves a relative app asset or API path against document.baseURI / import.meta.env.BASE_URL.
 * Never emits root-relative `/...` URLs so GitHub Pages subpath deployments resolve cleanly.
 */
export function resolveRelativeAppUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\.?\//, '');
  const metaEnv = (
    import.meta as unknown as { env?: { BASE_URL?: string } }
  ).env;
  const baseEnv = metaEnv?.BASE_URL;

  if (typeof document !== 'undefined' && document.baseURI) {
    if (baseEnv && baseEnv !== './' && baseEnv !== '/') {
      const normalizedBase = baseEnv.endsWith('/') ? baseEnv : `${baseEnv}/`;
      return new URL(
        clean,
        new URL(normalizedBase, document.baseURI),
      ).toString();
    }
    return new URL(`./${clean}`, document.baseURI).toString();
  }

  if (baseEnv && baseEnv !== './' && baseEnv !== '/') {
    const normalizedBase = baseEnv.endsWith('/') ? baseEnv : `${baseEnv}/`;
    return `${normalizedBase}${clean}`;
  }

  return `./${clean}`;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number,
  fetchFn: FetchLike,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface RawErddapTableResponse {
  table?: {
    columnNames?: string[];
    rows?: unknown[][];
  };
}

function parseNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseStringOrFallback(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function parseAtnErddapDossier(
  descriptor: AtnDatasetDescriptor,
  payload: RawErddapTableResponse,
): AnimalDossier | null {
  const cols = payload.table?.columnNames;
  const rows = payload.table?.rows;
  if (!Array.isArray(cols) || !Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const colIndex = new Map<string, number>();
  cols.forEach((name, idx) => colIndex.set(name, idx));

  const getCell = (row: unknown[], colName: string): unknown => {
    const idx = colIndex.get(colName);
    return idx === undefined ? undefined : row[idx];
  };

  let sex = 'Unknown';
  let lifeStage = 'Adult';
  let massKg: number | null = null;
  let localIdentifier = descriptor.animalId;
  let taxonName = descriptor.scientificName;
  const fixes: TelemetryFix[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const timeRaw = getCell(row, 'time');
    const lat = parseNumberOrNull(getCell(row, 'latitude'));
    const lon = parseNumberOrNull(getCell(row, 'longitude'));
    if (typeof timeRaw !== 'string' || lat === null || lon === null) {
      continue;
    }
    const timestampMs = Date.parse(timeRaw);
    if (!Number.isFinite(timestampMs)) continue;

    const rawDepth = parseNumberOrNull(getCell(row, 'depth'));
    const altitudeOrDepthMeters =
      rawDepth === null ? null : rawDepth === 0 ? 0 : -Math.abs(rawDepth);

    const argosLc = normalizeArgosLocationClass(
      getCell(row, 'location_class') as string | null | undefined,
    );
    const explicitRadius = parseNumberOrNull(getCell(row, 'error_radius'));
    const accuracyRadiusMeters =
      explicitRadius !== null && explicitRadius > 0
        ? explicitRadius
        : getArgosUncertaintyMeters(argosLc);

    const typeStr = parseStringOrFallback(
      getCell(row, 'type'),
      parseStringOrFallback(getCell(row, 'instrument_tag'), 'Argos'),
    );
    const sensorType: SensorType = typeStr.toUpperCase().includes('GPS')
      ? 'GPS-GSM'
      : 'Argos Doppler PTT';

    if (sex === 'Unknown') {
      const candidateSex = parseStringOrFallback(
        getCell(row, 'animal_sex'),
        '',
      );
      if (candidateSex && candidateSex.toLowerCase() !== 'not specified') {
        sex = candidateSex;
      }
    }
    if (lifeStage === 'Adult') {
      const candidateStage = parseStringOrFallback(
        getCell(row, 'animal_life_stage'),
        '',
      );
      if (candidateStage) {
        lifeStage = candidateStage;
      }
    }
    if (massKg === null) {
      const weight = parseNumberOrNull(getCell(row, 'animal_weight'));
      if (weight !== null && weight > 0) massKg = weight;
    }
    if (localIdentifier === descriptor.animalId) {
      const candidateId = parseStringOrFallback(
        getCell(row, 'ptt'),
        parseStringOrFallback(getCell(row, 'deploy_id'), ''),
      );
      if (candidateId) localIdentifier = candidateId;
    }
    const rowTaxon = parseStringOrFallback(getCell(row, 'taxon_name'), '');
    if (rowTaxon) taxonName = rowTaxon;

    fixes.push({
      id: `${descriptor.animalId}-${i}`,
      timestamp: timeRaw,
      timestampMs,
      lat,
      lon,
      altitudeOrDepthMeters,
      groundSpeedKmh: null,
      speedIsDerived: true,
      headingDeg: null,
      externalTempC: null,
      tagVoltage: null,
      argosLc,
      accuracyRadiusMeters,
      sensorType,
      segmentDistanceKm: 0,
      isOutlierSpike: false,
    });
  }

  if (fixes.length === 0) return null;

  fixes.sort((a, b) => a.timestampMs - b.timestampMs);
  const firstFix = fixes[0]!;
  const latestFix = fixes[fixes.length - 1]!;
  const parts = taxonName.split(/\s+/);
  const genus = parts[0] ?? '';

  return {
    id: descriptor.animalId,
    localIdentifier,
    nickname: descriptor.nickname,
    scientificName: taxonName,
    commonName: descriptor.commonName,
    guild: descriptor.guild,
    sex,
    lifeStage,
    massKg,
    deploymentStartIso: firstFix.timestamp,
    feedStatus: 'LIVE_API',
    sourceProvider: 'IOOS_ATN_ERDDAP',
    studyId: descriptor.datasetId,
    diagnosticStatus: 'OK',
    colorHex: descriptor.colorHex,
    latestFix,
    fixes,
    kinematics: {
      totalDistanceKm: 0,
      displacement24hKm: 0,
      distance24hKm: 0,
      avgSpeedKmh: 0,
      maxSpeedKmh: 0,
      currentSpeedKmh: 0,
      currentBearingDeg: 0,
      currentCardinal: 'N',
      pingFreshnessMs: 0,
      pingFreshnessLabel: 'Just now',
      daysTracked: 1,
      dailyDistanceSeries: [],
      hasAltitudeOrDepth: fixes.some((f) => f.altitudeOrDepthMeters !== null),
    },
    ecology: {
      photoUrl: null,
      photoAttribution: null,
      iucnStatus: descriptor.iucnStatus,
      taxonomy: {
        kingdom: 'Animalia',
        phylum: 'Chordata',
        class: 'Mammalia',
        order:
          descriptor.scientificName === 'Phoca largha'
            ? 'Carnivora'
            : 'Cetartiodactyla',
        family:
          descriptor.scientificName === 'Phoca largha'
            ? 'Phocidae'
            : descriptor.scientificName === 'Mesoplodon densirostris'
              ? 'Ziphiidae'
              : 'Delphinidae',
        genus,
        species: taxonName,
      },
      summaryExtract: descriptor.summaryExtract,
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
      regionLabel:
        descriptor.scientificName === 'Phoca largha'
          ? 'Bering Sea'
          : 'Central North Pacific (Hawaiʻi)',
      fetchedAt: null,
    },
    attribution: descriptor.attribution,
  };
}

function extractAnimalsArray(raw: unknown): {
  animals: AnimalDossier[];
  generatedAt?: string;
} {
  if (Array.isArray(raw)) {
    return { animals: raw as AnimalDossier[] };
  }
  if (
    raw &&
    typeof raw === 'object' &&
    Array.isArray((raw as { animals?: unknown }).animals)
  ) {
    const obj = raw as { animals: AnimalDossier[]; generatedAt?: string };
    return { animals: obj.animals, generatedAt: obj.generatedAt };
  }
  return { animals: [] };
}

/**
 * Shifts DEMO_FEED animal timestamps relative to referenceNowMs while strictly preserving
 * original inter-fix intervals and staggered recency buckets (<24h, 2-6d, >14d).
 * LIVE_API and CACHED animals are never shifted.
 */
export function shiftDemoFeedTimestamps(
  animals: readonly AnimalDossier[],
  generatedAtIso: string | undefined,
  referenceNowMs: number,
): AnimalDossier[] {
  const demoAnimals = animals.filter((a) => a.feedStatus === 'DEMO_FEED');
  if (demoAnimals.length === 0) return [...animals];

  let maxDemoFixMs = -Infinity;
  for (const animal of demoAnimals) {
    for (const fix of animal.fixes) {
      if (Number.isFinite(fix.timestampMs) && fix.timestampMs > maxDemoFixMs) {
        maxDemoFixMs = fix.timestampMs;
      }
    }
    if (
      animal.latestFix &&
      Number.isFinite(animal.latestFix.timestampMs) &&
      animal.latestFix.timestampMs > maxDemoFixMs
    ) {
      maxDemoFixMs = animal.latestFix.timestampMs;
    }
  }

  const parsedGeneratedMs = generatedAtIso ? Date.parse(generatedAtIso) : NaN;
  const anchorMs =
    Number.isFinite(parsedGeneratedMs) &&
    (!Number.isFinite(maxDemoFixMs) || parsedGeneratedMs >= maxDemoFixMs)
      ? parsedGeneratedMs
      : Number.isFinite(maxDemoFixMs)
        ? maxDemoFixMs
        : referenceNowMs;

  const deltaMs = referenceNowMs - anchorMs;
  if (Math.abs(deltaMs) < 1000) {
    return [...animals];
  }

  return animals.map((animal) => {
    if (animal.feedStatus !== 'DEMO_FEED') {
      return animal;
    }
    const shiftedFixes = animal.fixes.map((fix) => {
      const nextMs = fix.timestampMs + deltaMs;
      return {
        ...fix,
        timestampMs: nextMs,
        timestamp: new Date(nextMs).toISOString(),
      };
    });
    const shiftedLatest =
      shiftedFixes.length > 0
        ? shiftedFixes[shiftedFixes.length - 1]!
        : {
            ...animal.latestFix,
            timestampMs: animal.latestFix.timestampMs + deltaMs,
            timestamp: new Date(
              animal.latestFix.timestampMs + deltaMs,
            ).toISOString(),
          };
    const parsedDeployMs = Date.parse(animal.deploymentStartIso);
    const shiftedDeployIso = Number.isFinite(parsedDeployMs)
      ? new Date(parsedDeployMs + deltaMs).toISOString()
      : shiftedFixes[0]?.timestamp ?? animal.deploymentStartIso;

    return {
      ...animal,
      deploymentStartIso: shiftedDeployIso,
      fixes: shiftedFixes,
      latestFix: shiftedLatest,
    };
  });
}

function mergeAndDedupeFleet(
  candidates: readonly AnimalDossier[],
): AnimalDossier[] {
  const byId = new Map<string, AnimalDossier>();
  for (const animal of candidates) {
    if (!animal || !animal.id) continue;
    const existing = byId.get(animal.id);
    if (!existing) {
      byId.set(animal.id, animal);
      continue;
    }
    const existingPriority = FEED_PRIORITY[existing.feedStatus] ?? 0;
    const incomingPriority = FEED_PRIORITY[animal.feedStatus] ?? 0;
    if (incomingPriority > existingPriority) {
      byId.set(animal.id, animal);
    }
  }
  return Array.from(byId.values());
}

export class TelemetryClient {
  private readonly fetchFn: FetchLike;
  private readonly healthTimeoutMs: number;
  private readonly apiTimeoutMs: number;
  private readonly atnTimeoutMs: number;
  private readonly skipWorker: boolean;

  private proxyAvailable = false;
  private lastProxyHealth: ProxyHealthResponse | null = null;
  private lastConnectionMode: ConnectionMode = 'STATIC_DECK';
  private cachedSnapshotAnimals: AnimalDossier[] = [];

  constructor(options: TelemetryClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.healthTimeoutMs = options.healthTimeoutMs ?? 1500;
    this.apiTimeoutMs = options.apiTimeoutMs ?? 8000;
    this.atnTimeoutMs = options.atnTimeoutMs ?? 4500;
    this.skipWorker = options.skipWorker ?? false;
  }

  isProxyAvailable(): boolean {
    return this.proxyAvailable;
  }

  getLastProxyHealth(): ProxyHealthResponse | null {
    return this.lastProxyHealth;
  }

  getLastConnectionMode(): ConnectionMode {
    return this.lastConnectionMode;
  }

  private async normalizeAnimals(
    animals: AnimalDossier[],
    referenceNowMs: number,
  ): Promise<AnimalDossier[]> {
    if (this.skipWorker) {
      const { normalizeFleetBatch } = await import(
        '../workers/kinematics.worker'
      );
      return normalizeFleetBatch(animals, referenceNowMs);
    }
    return kinematicsBridge.normalizeFleet(animals, referenceNowMs);
  }

  private async probeProxyHealth(): Promise<ProxyHealthResponse | null> {
    try {
      const healthUrl = resolveRelativeAppUrl('./api/health');
      const health = await fetchJsonWithTimeout<ProxyHealthResponse>(
        healthUrl,
        this.healthTimeoutMs,
        this.fetchFn,
      );
      if (health && health.status === 'ok') {
        this.proxyAvailable = true;
        this.lastProxyHealth = health;
        return health;
      }
    } catch {
      // Proxy offline or unreachable in static mode
    }
    this.proxyAvailable = false;
    this.lastProxyHealth = null;
    return null;
  }

  private async fetchFallbackDeck(
    referenceNowMs: number,
  ): Promise<AnimalDossier[]> {
    try {
      const fallbackUrl = resolveRelativeAppUrl('./data/fallback-fleet.json');
      const raw = await fetchJsonWithTimeout<unknown>(
        fallbackUrl,
        this.apiTimeoutMs,
        this.fetchFn,
      );
      const { animals, generatedAt } = extractAnimalsArray(raw);
      const tagged = animals.map((a) => ({
        ...a,
        feedStatus: 'DEMO_FEED' as const,
      }));
      return shiftDemoFeedTimestamps(tagged, generatedAt, referenceNowMs);
    } catch {
      return [];
    }
  }

  private async fetchCiSnapshot(
    referenceNowMs: number,
  ): Promise<AnimalDossier[]> {
    try {
      const snapshotUrl = resolveRelativeAppUrl('./data/ci-live-snapshot.json');
      const raw = await fetchJsonWithTimeout<unknown>(
        snapshotUrl,
        this.apiTimeoutMs,
        this.fetchFn,
      );
      const { animals, generatedAt } = extractAnimalsArray(raw);
      const mapped = animals.map((animal) => ({
        ...animal,
        feedStatus:
          animal.feedStatus === 'DEMO_FEED'
            ? ('DEMO_FEED' as const)
            : ('CACHED' as const),
      }));
      return shiftDemoFeedTimestamps(mapped, generatedAt, referenceNowMs);
    } catch {
      return [];
    }
  }

  private async fetchDirectAtnErddap(): Promise<AnimalDossier[]> {
    const results = await Promise.allSettled(
      ATN_CURATED_DATASETS.map(async (descriptor) => {
        const url = `https://atn.ioos.us/erddap/tabledap/${descriptor.datasetId}.json?&orderByLimit(%22160%22)`;
        const raw = await fetchJsonWithTimeout<RawErddapTableResponse>(
          url,
          this.atnTimeoutMs,
          this.fetchFn,
        );
        return parseAtnErddapDossier(descriptor, raw);
      }),
    );

    const dossiers: AnimalDossier[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        dossiers.push(result.value);
      }
    }
    return dossiers;
  }

  /**
   * Executes the 4-Tier Telemetry Waterfall:
   * 1) Local Proxy (`./api/health` + `./api/fleet`)
   * 2) CI Live Snapshot (`./data/ci-live-snapshot.json`, CACHED provenance)
   * 3) Direct Browser IOOS ATN ERDDAP (`LIVE_API` provenance)
   * 4) Seed Fallback Deck (`./data/fallback-fleet.json`, shifted DEMO_FEED)
   */
  async loadFleet(referenceNowMs: number = Date.now()): Promise<FleetResponse> {
    const nowMs = Number.isFinite(referenceNowMs) ? referenceNowMs : Date.now();
    const collected: AnimalDossier[] = [];
    let connectionMode: ConnectionMode = 'STATIC_DECK';

    // Tier 1: Local Express Telemetry Proxy
    const health = await this.probeProxyHealth();
    if (health) {
      try {
        const fleetUrl = resolveRelativeAppUrl('./api/fleet');
        const proxyFleet = await fetchJsonWithTimeout<FleetResponse>(
          fleetUrl,
          this.apiTimeoutMs,
          this.fetchFn,
        );
        const { animals: proxyAnimals } = extractAnimalsArray(proxyFleet);
        if (proxyAnimals.length > 0) {
          const demoInProxy = proxyAnimals.filter(
            (a) => a.feedStatus === 'DEMO_FEED',
          );
          let maxDemoMs = -Infinity;
          for (const a of demoInProxy) {
            if (a.latestFix && Number.isFinite(a.latestFix.timestampMs)) {
              maxDemoMs = Math.max(maxDemoMs, a.latestFix.timestampMs);
            }
          }
          const needsShift =
            Number.isFinite(maxDemoMs) && nowMs - maxDemoMs > 20 * 3600_000;
          const shiftedProxy = needsShift
            ? shiftDemoFeedTimestamps(
                proxyAnimals,
                new Date(maxDemoMs + 2 * 3600_000).toISOString(),
                nowMs,
              )
            : proxyAnimals;
          collected.push(...shiftedProxy);
          connectionMode = 'PROXY_LIVE';
        }
      } catch {
        // If /api/fleet failed despite healthy /api/health, fall through to Tiers 2-4
        this.proxyAvailable = false;
      }
    }

    if (connectionMode !== 'PROXY_LIVE') {
      // Tier 2: Hydrate CI Live Snapshot (CACHED)
      const snapshotAnimals = await this.fetchCiSnapshot(nowMs);
      if (snapshotAnimals.length > 0) {
        collected.push(...snapshotAnimals);
        this.cachedSnapshotAnimals = snapshotAnimals;
        if (snapshotAnimals.some((a) => a.feedStatus === 'CACHED')) {
          connectionMode = 'CI_SNAPSHOT';
        }
      }

      // Tier 3: Direct CORS-enabled IOOS ATN ERDDAP (LIVE_API)
      const liveAtnAnimals = await this.fetchDirectAtnErddap();
      if (liveAtnAnimals.length > 0) {
        collected.push(...liveAtnAnimals);
      }
    }

    // Tier 4: Fallback Demo Deck (shifted DEMO_FEED merged & deduped)
    const fallbackAnimals = await this.fetchFallbackDeck(nowMs);
    if (fallbackAnimals.length > 0) {
      collected.push(...fallbackAnimals);
    }

    const deduped = mergeAndDedupeFleet(collected);
    const normalized = await this.normalizeAnimals(deduped, nowMs);
    if (!this.skipWorker) {
      kinematicsBridge.setFleet(normalized);
    }

    this.lastConnectionMode = connectionMode;

    let liveCount = 0;
    let cachedCount = 0;
    let demoCount = 0;
    for (const animal of normalized) {
      if (animal.feedStatus === 'LIVE_API') liveCount += 1;
      else if (animal.feedStatus === 'CACHED') cachedCount += 1;
      else demoCount += 1;
    }

    return {
      generatedAt: new Date(nowMs).toISOString(),
      connectionMode,
      animals: normalized,
      sourceSummary: {
        liveCount,
        cachedCount,
        demoCount,
      },
    };
  }

  /**
   * Imports a Movebank Study through the local proxy (`./api/studies/:studyId`),
   * supporting `license-md5` study terms confirmation. Gracefully handles static mode.
   */
  async importMovebankStudy(
    studyId: string,
    licenseMd5?: string,
  ): Promise<StudyImportResponse> {
    const cleanId = studyId.trim();
    if (!cleanId) {
      return {
        studyId: '',
        diagnosticStatus: 'TAG_SILENT',
        feedStatus: 'DEMO_FEED',
        animals: [],
        licenseTermsText: null,
        licenseMd5: null,
        message: 'Enter a valid numeric Movebank Study ID.',
      };
    }

    if (!this.proxyAvailable) {
      await this.probeProxyHealth();
    }

    if (this.proxyAvailable) {
      try {
        const query = licenseMd5
          ? `?licenseMd5=${encodeURIComponent(licenseMd5.trim())}`
          : '';
        const url = resolveRelativeAppUrl(
          `./api/studies/${encodeURIComponent(cleanId)}${query}`,
        );
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          Math.max(this.apiTimeoutMs, 12000),
        );
        let res: StudyImportResponse;
        try {
          const response = await this.fetchFn(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('application/json')) {
            const parsed = (await response.json()) as Partial<StudyImportResponse>;
            if (parsed && typeof parsed.diagnosticStatus === 'string') {
              res = {
                studyId: parsed.studyId ?? cleanId,
                diagnosticStatus: parsed.diagnosticStatus,
                feedStatus: parsed.feedStatus ?? 'DEMO_FEED',
                animals: Array.isArray(parsed.animals) ? parsed.animals : [],
                licenseTermsText: parsed.licenseTermsText ?? null,
                licenseMd5: parsed.licenseMd5 ?? null,
                message: parsed.message ?? `HTTP ${response.status}`,
              };
            } else if (!response.ok) {
              throw new Error(`HTTP ${response.status} from ${url}`);
            } else {
              res = parsed as StudyImportResponse;
            }
          } else if (!response.ok) {
            throw new Error(`HTTP ${response.status} from ${url}`);
          } else {
            res = (await response.json()) as StudyImportResponse;
          }
        } finally {
          clearTimeout(timer);
        }
        const nowMs = Date.now();
        const normalizedAnimals = Array.isArray(res.animals)
          ? await this.normalizeAnimals(res.animals, nowMs)
          : [];
        return {
          ...res,
          animals: normalizedAnimals,
        };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Study import request failed.';
        return {
          studyId: cleanId,
          diagnosticStatus: msg.includes('429')
            ? 'RATE_LIMITED'
            : 'AUTH_REQUIRED',
          feedStatus: 'DEMO_FEED',
          animals: [],
          licenseTermsText: null,
          licenseMd5: null,
          message: `Movebank proxy import failed (${msg}).`,
        };
      }
    }

    // Static / GitHub Pages fallback: check if requested study exists in CI snapshot
    const snapshotMatches = this.cachedSnapshotAnimals.filter(
      (a) => a.studyId === cleanId,
    );
    if (snapshotMatches.length > 0) {
      return {
        studyId: cleanId,
        diagnosticStatus: 'OK',
        feedStatus: snapshotMatches[0]!.feedStatus,
        animals: snapshotMatches,
        licenseTermsText: null,
        licenseMd5: null,
        message: `Loaded ${snapshotMatches.length} individual(s) for study ${cleanId} from CI telemetry snapshot.`,
      };
    }

    return {
      studyId: cleanId,
      diagnosticStatus: 'AUTH_REQUIRED',
      feedStatus: 'DEMO_FEED',
      animals: [],
      licenseTermsText: null,
      licenseMd5: null,
      message:
        'Local Telemetry Proxy (127.0.0.1:3001) is unavailable in static mode. Movebank API omits browser CORS headers; run `npm run dev` or `npm start` locally for live Movebank study imports.',
    };
  }
}

export const telemetryClient = new TelemetryClient();
