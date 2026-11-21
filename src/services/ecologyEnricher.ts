import type { AnimalEcology, IucnStatus } from '../types/telemetry';
import type { FetchLike } from './telemetryClient';

const ECOLOGY_CACHE_PREFIX = 'wildpulse:ecology:v1:';
const ECOLOGY_CACHE_TTL_MS = 24 * 3600 * 1000;
const ECOLOGY_TIMEOUT_MS = 4500;

interface CachedEcologyEntry {
  savedAtMs: number;
  value: AnimalEcology;
}

interface InatResponse {
  results?: Array<{
    name?: string;
    default_photo?: {
      medium_url?: string;
      url?: string;
      attribution?: string;
    };
    conservation_status?: {
      status?: string;
      status_name?: string;
    };
  }>;
}

interface GbifResponse {
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
}

interface WikiSummaryResponse {
  extract?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
  content_urls?: {
    desktop?: { page?: string };
    mobile?: { page?: string };
  };
}

function mapIucnCode(raw: string | undefined): IucnStatus | null {
  if (!raw) return null;
  const token = raw.trim().toUpperCase();
  if (
    token === 'LC' ||
    token === 'NT' ||
    token === 'VU' ||
    token === 'EN' ||
    token === 'CR' ||
    token === 'DD'
  ) {
    return token;
  }
  const lower = raw.trim().toLowerCase();
  if (lower.includes('least concern')) return 'LC';
  if (lower.includes('near threatened')) return 'NT';
  if (lower.includes('vulnerable')) return 'VU';
  if (lower.includes('critically endangered')) return 'CR';
  if (lower.includes('endangered')) return 'EN';
  if (lower.includes('data deficient')) return 'DD';
  return null;
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
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function readLocalStorageEntry(key: string): CachedEcologyEntry | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEcologyEntry;
    if (
      parsed &&
      typeof parsed.savedAtMs === 'number' &&
      Date.now() - parsed.savedAtMs < ECOLOGY_CACHE_TTL_MS &&
      parsed.value
    ) {
      return parsed;
    }
  } catch {
    // Ignore storage read errors in private/restricted environments
  }
  return null;
}

function writeLocalStorageEntry(key: string, entry: CachedEcologyEntry): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Ignore quota/private mode errors
  }
}

export class EcologyEnricher {
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly memoryCache = new Map<string, CachedEcologyEntry>();
  private readonly inFlight = new Map<string, Promise<AnimalEcology>>();

  constructor(options: { fetchFn?: FetchLike; timeoutMs?: number } = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? ECOLOGY_TIMEOUT_MS;
  }

  private mergeWithFallback(
    cached: AnimalEcology,
    fallback: AnimalEcology,
  ): AnimalEcology {
    return {
      photoUrl: cached.photoUrl || fallback.photoUrl,
      photoAttribution: cached.photoAttribution || fallback.photoAttribution,
      iucnStatus: cached.iucnStatus || fallback.iucnStatus,
      taxonomy: {
        kingdom: cached.taxonomy.kingdom || fallback.taxonomy.kingdom,
        phylum: cached.taxonomy.phylum || fallback.taxonomy.phylum,
        class: cached.taxonomy.class || fallback.taxonomy.class,
        order: cached.taxonomy.order || fallback.taxonomy.order,
        family: cached.taxonomy.family || fallback.taxonomy.family,
        genus: cached.taxonomy.genus || fallback.taxonomy.genus,
        species: cached.taxonomy.species || fallback.taxonomy.species,
      },
      summaryExtract: cached.summaryExtract || fallback.summaryExtract,
      wikiUrl: cached.wikiUrl || fallback.wikiUrl,
      enriched: cached.enriched || fallback.enriched,
    };
  }

  /**
   * Queries iNaturalist, GBIF, and Wikipedia REST Summary API in parallel with
   * 4500ms timeouts and 2-tier (memory + localStorage) caching.
   * Gracefully preserves defaults when offline or when a species is absent.
   */
  async enrichAnimalEcology(
    scientificName: string,
    fallback: AnimalEcology,
  ): Promise<AnimalEcology> {
    const cleanName = scientificName.trim();
    if (!cleanName) return fallback;

    const normalizedKey = cleanName.toLowerCase();
    const storageKey = `${ECOLOGY_CACHE_PREFIX}${normalizedKey}`;

    const memHit = this.memoryCache.get(normalizedKey);
    if (memHit && Date.now() - memHit.savedAtMs < ECOLOGY_CACHE_TTL_MS) {
      return this.mergeWithFallback(memHit.value, fallback);
    }

    const diskHit = readLocalStorageEntry(storageKey);
    if (diskHit) {
      this.memoryCache.set(normalizedKey, diskHit);
      return this.mergeWithFallback(diskHit.value, fallback);
    }

    const existingPromise = this.inFlight.get(normalizedKey);
    if (existingPromise) {
      const resolved = await existingPromise;
      return this.mergeWithFallback(resolved, fallback);
    }

    const requestPromise = (async (): Promise<AnimalEcology> => {
      const wikiSlug = encodeURIComponent(cleanName.replace(/\s+/g, '_'));
      const encodedName = encodeURIComponent(cleanName);

      const [inatRes, gbifRes, wikiRes] = await Promise.allSettled([
        fetchJsonWithTimeout<InatResponse>(
          `https://api.inaturalist.org/v1/taxa?q=${encodedName}&per_page=1`,
          this.timeoutMs,
          this.fetchFn,
        ),
        fetchJsonWithTimeout<GbifResponse>(
          `https://api.gbif.org/v1/species/match?name=${encodedName}`,
          this.timeoutMs,
          this.fetchFn,
        ),
        fetchJsonWithTimeout<WikiSummaryResponse>(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${wikiSlug}`,
          this.timeoutMs,
          this.fetchFn,
        ),
      ]);

      let anyExternalSuccess = false;
      let photoUrl = fallback.photoUrl;
      let photoAttribution = fallback.photoAttribution;
      let iucnStatus = fallback.iucnStatus;
      const taxonomy = { ...fallback.taxonomy };
      let summaryExtract = fallback.summaryExtract;
      let wikiUrl = fallback.wikiUrl;

      if (inatRes.status === 'fulfilled') {
        const taxon = inatRes.value.results?.[0];
        if (taxon) {
          anyExternalSuccess = true;
          const inatPhoto =
            taxon.default_photo?.medium_url || taxon.default_photo?.url;
          if (inatPhoto) {
            photoUrl = inatPhoto;
            photoAttribution =
              taxon.default_photo?.attribution?.trim() || 'iNaturalist';
          }
          const mappedIucn =
            mapIucnCode(taxon.conservation_status?.status) ??
            mapIucnCode(taxon.conservation_status?.status_name);
          if (mappedIucn) {
            iucnStatus = mappedIucn;
          }
        }
      }

      if (gbifRes.status === 'fulfilled' && gbifRes.value) {
        const g = gbifRes.value;
        if (g.kingdom || g.phylum || g.class || g.order || g.family) {
          anyExternalSuccess = true;
        }
        taxonomy.kingdom = g.kingdom || taxonomy.kingdom;
        taxonomy.phylum = g.phylum || taxonomy.phylum;
        taxonomy.class = g.class || taxonomy.class;
        taxonomy.order = g.order || taxonomy.order;
        taxonomy.family = g.family || taxonomy.family;
        taxonomy.genus = g.genus || taxonomy.genus;
        taxonomy.species = g.species || taxonomy.species || cleanName;
      }

      if (wikiRes.status === 'fulfilled' && wikiRes.value) {
        const w = wikiRes.value;
        if (w.extract || w.content_urls) {
          anyExternalSuccess = true;
        }
        if (typeof w.extract === 'string' && w.extract.trim().length > 0) {
          summaryExtract = w.extract.trim();
        }
        const pageUrl =
          w.content_urls?.desktop?.page || w.content_urls?.mobile?.page;
        if (pageUrl) {
          wikiUrl = pageUrl;
        }
        if (!photoUrl) {
          const wikiPhoto = w.thumbnail?.source || w.originalimage?.source;
          if (wikiPhoto) {
            photoUrl = wikiPhoto;
            photoAttribution = 'Wikimedia Commons / Wikipedia';
          }
        }
      }

      const enrichedEcology: AnimalEcology = {
        photoUrl,
        photoAttribution,
        iucnStatus,
        taxonomy,
        summaryExtract,
        wikiUrl,
        enriched: anyExternalSuccess || fallback.enriched,
      };

      if (anyExternalSuccess) {
        const entry: CachedEcologyEntry = {
          savedAtMs: Date.now(),
          value: enrichedEcology,
        };
        this.memoryCache.set(normalizedKey, entry);
        writeLocalStorageEntry(storageKey, entry);
      }

      return enrichedEcology;
    })();

    this.inFlight.set(normalizedKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      this.inFlight.delete(normalizedKey);
    }
  }
}

export const ecologyEnricher = new EcologyEnricher();
