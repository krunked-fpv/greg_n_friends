import {
  CURATED_ATN_DATASETS,
  type CuratedAtnDatasetSpec,
} from '../data/curatedAtnDatasets';
import type {
  AnimalDossier,
  ConnectionMode,
  FeedStatus,
  FleetResponse,
  ProxyHealthResponse,
  SensorType,
  StudyImportResponse,
  TelemetryFix,
} from '../types/telemetry';
import { normalizeFleetBatch } from '../utils/kinematics/fleetNormalizer';
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

function parseCleanFieldString(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed || lower === 'null' || lower === 'not specified') {
      return '';
    }
    return trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

const ATN_SPECIES_ECOLOGY_HINTS: Record<
  string,
  {
    order: string;
    family: string;
    photoUrl: string;
    photoAttribution: string;
    wikiUrl: string;
  }
> = {
  'Phoca largha': {
    order: 'Carnivora',
    family: 'Phocidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Spotted_seal_mother_and_pup_in_the_Bering_Sea.jpg/330px-Spotted_seal_mother_and_pup_in_the_Bering_Sea.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / NOAA Bering Sea',
    wikiUrl: 'https://en.wikipedia.org/wiki/Spotted_seal',
  },
  'Mesoplodon densirostris': {
    order: 'Artiodactyla',
    family: 'Ziphiidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c6/Blainville%27s_beaked_whale_size.svg/330px-Blainville%27s_beaked_whale_size.svg.png?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: "https://en.wikipedia.org/wiki/Blainville's_beaked_whale",
  },
  'Globicephala macrorhynchus': {
    order: 'Artiodactyla',
    family: 'Delphinidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d5/Globicephala_macrorhynchus_Kurzflossen-Grindwal_DSCF8148.JPG/330px-Globicephala_macrorhynchus_Kurzflossen-Grindwal_DSCF8148.JPG?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Short-finned_pilot_whale',
  },
  'Erignathus barbatus': {
    order: 'Carnivora',
    family: 'Phocidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/78/Bearded_Seal.jpg/330px-Bearded_Seal.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Bearded_seal',
  },
  'Pseudorca crassidens': {
    order: 'Artiodactyla',
    family: 'Delphinidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/99/Pseudoorca_Crassidens_-_False_Killer_Whale.jpg/330px-Pseudoorca_Crassidens_-_False_Killer_Whale.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/False_killer_whale',
  },
  'Phoca vitulina': {
    order: 'Carnivora',
    family: 'Phocidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/48/Common_seal_%28Phoca_vitulina%29_2.jpg/330px-Common_seal_%28Phoca_vitulina%29_2.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Harbor_seal',
  },
  'Histriophoca fasciata': {
    order: 'Carnivora',
    family: 'Phocidae',
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a3/Ribbon-seal-male_Josh_London_NOAAedit_%2816086029928%29_%28cropped%29.jpg/330px-Ribbon-seal-male_Josh_London_NOAAedit_%2816086029928%29_%28cropped%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Josh London (NOAA)',
    wikiUrl: 'https://en.wikipedia.org/wiki/Ribbon_seal',
  },
};

function resolveMarineTaxonomy(scientificName: string): {
  order: string;
  family: string;
} {
  const hint = ATN_SPECIES_ECOLOGY_HINTS[scientificName];
  if (hint) return { order: hint.order, family: hint.family };
  const lower = scientificName.toLowerCase();
  if (
    lower.includes('phoca') ||
    lower.includes('erignathus') ||
    lower.includes('histriophoca')
  ) {
    return { order: 'Carnivora', family: 'Phocidae' };
  }
  if (lower.includes('mesoplodon')) {
    return { order: 'Artiodactyla', family: 'Ziphiidae' };
  }
  return { order: 'Artiodactyla', family: 'Delphinidae' };
}

function parseAtnErddapDossier(
  descriptor: CuratedAtnDatasetSpec,
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

  let sex = 'unknown';
  let lifeStage = 'adult';
  let massKg: number | null = null;
  let localIdentifier = descriptor.id;
  let hasResolvedLocalId = false;
  let taxonName = descriptor.scientificName;
  const fixes: TelemetryFix[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const qartodLoc = parseNumberOrNull(getCell(row, 'qartod_location_flag'));
    if (qartodLoc === 4) continue;

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
    const combinedSensor = `${typeStr} ${parseStringOrFallback(getCell(row, 'instrument_tag'), '')}`.toLowerCase();
    const sensorType: SensorType =
      combinedSensor.includes('gps') || combinedSensor.includes('fastloc')
        ? 'GPS-GSM'
        : combinedSensor.includes('acoustic')
          ? 'Acoustic / Archival'
          : 'Argos Doppler PTT';

    if (sex === 'unknown') {
      const candidateSex = parseCleanFieldString(getCell(row, 'animal_sex'));
      if (candidateSex) {
        sex = candidateSex.toLowerCase();
      }
    }
    if (lifeStage === 'adult') {
      const candidateStage = parseCleanFieldString(
        getCell(row, 'animal_life_stage'),
      );
      if (candidateStage) {
        lifeStage = candidateStage.toLowerCase();
      }
    }
    if (massKg === null) {
      const weight = parseNumberOrNull(getCell(row, 'animal_weight'));
      if (weight !== null && weight > 0) massKg = weight;
    }
    if (!hasResolvedLocalId) {
      const candidateId =
        parseCleanFieldString(getCell(row, 'animal')) ||
        parseCleanFieldString(getCell(row, 'deploy_id')) ||
        parseCleanFieldString(getCell(row, 'ptt'));
      if (candidateId) {
        localIdentifier = candidateId;
        hasResolvedLocalId = true;
      }
    }
    const rowTaxon = parseCleanFieldString(getCell(row, 'taxon_name'));
    if (rowTaxon) taxonName = rowTaxon;

    fixes.push({
      id: `${descriptor.id}-${i}`,
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
  const species = parts[1] ?? taxonName;
  const taxonomyOrderFamily = resolveMarineTaxonomy(taxonName);

  return {
    id: descriptor.id,
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
      photoUrl: ATN_SPECIES_ECOLOGY_HINTS[taxonName]?.photoUrl ?? null,
      photoAttribution:
        ATN_SPECIES_ECOLOGY_HINTS[taxonName]?.photoAttribution ?? null,
      iucnStatus: descriptor.iucnStatus,
      taxonomy: {
        kingdom: 'Animalia',
        phylum: 'Chordata',
        class: 'Mammalia',
        order: taxonomyOrderFamily.order,
        family: taxonomyOrderFamily.family,
        genus,
        species,
      },
      summaryExtract: descriptor.summaryExtract,
      wikiUrl: ATN_SPECIES_ECOLOGY_HINTS[taxonName]?.wikiUrl ?? null,
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
      regionLabel: descriptor.regionLabel,
      fetchedAt: null,
    },
    attribution: { ...descriptor.attribution },
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

function normalizeIdKey(id: string): string {
  return id.trim().toLowerCase();
}

function buildCompositeIdentityKey(animal: AnimalDossier): string | null {
  const source = String(animal.sourceProvider ?? '').trim().toUpperCase();
  const study = String(animal.studyId ?? '').trim().toLowerCase();
  const local = String(animal.localIdentifier ?? '').trim().toLowerCase();
  if (!source || !study || !local) return null;
  return `${source}:${study}:${local}`;
}

export function mergeAndDedupeFleet(
  candidates: readonly AnimalDossier[],
): AnimalDossier[] {
  const slots: Array<AnimalDossier | null> = [];
  const slotById = new Map<string, number>();
  const slotByComposite = new Map<string, number>();

  const registerKeys = (animal: AnimalDossier, idx: number): void => {
    const idKey = normalizeIdKey(animal.id);
    if (idKey) slotById.set(idKey, idx);
    const compKey = buildCompositeIdentityKey(animal);
    if (compKey) slotByComposite.set(compKey, idx);
  };

  for (const candidate of candidates) {
    if (!candidate || !candidate.id) continue;
    const idKey = normalizeIdKey(candidate.id);
    if (!idKey) continue;
    const compKey = buildCompositeIdentityKey(candidate);

    const existingIdIdx = slotById.get(idKey);
    const existingCompIdx = compKey ? slotByComposite.get(compKey) : undefined;

    if (existingIdIdx === undefined && existingCompIdx === undefined) {
      const idx = slots.length;
      slots.push(candidate);
      registerKeys(candidate, idx);
      continue;
    }

    if (
      existingIdIdx !== undefined &&
      existingCompIdx !== undefined &&
      existingIdIdx !== existingCompIdx
    ) {
      const a = slots[existingIdIdx];
      const b = slots[existingCompIdx];
      const winner = [a, b, candidate]
        .filter((x): x is AnimalDossier => x !== null)
        .reduce((best, cur) =>
          (FEED_PRIORITY[cur.feedStatus] ?? 0) >
          (FEED_PRIORITY[best.feedStatus] ?? 0)
            ? cur
            : best,
        );
      slots[existingIdIdx] = winner;
      slots[existingCompIdx] = null;
      if (a) registerKeys(a, existingIdIdx);
      if (b) registerKeys(b, existingIdIdx);
      registerKeys(candidate, existingIdIdx);
      registerKeys(winner, existingIdIdx);
      continue;
    }

    const targetIdx = existingIdIdx ?? existingCompIdx!;
    const existing = slots[targetIdx];
    if (!existing) {
      slots[targetIdx] = candidate;
      registerKeys(candidate, targetIdx);
      continue;
    }

    const existingPriority = FEED_PRIORITY[existing.feedStatus] ?? 0;
    const incomingPriority = FEED_PRIORITY[candidate.feedStatus] ?? 0;
    if (incomingPriority > existingPriority) {
      slots[targetIdx] = candidate;
    }
    registerKeys(candidate, targetIdx);
  }

  return slots.filter((a): a is AnimalDossier => a !== null);
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
      CURATED_ATN_DATASETS.map(async (descriptor) => {
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
