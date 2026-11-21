import { create } from 'zustand';
import type {
  AnimalDossier,
  AnimalEcology,
  AnimalEnvironment,
  BasemapId,
  ConnectionMode,
  EcologicalGuild,
  FeedStatus,
  PingRecencyFilter,
  ProxyHealthResponse,
  StudyImportResponse,
  TrackColorMode,
} from '../types/telemetry';
import { playbackClock } from './playbackClock';

export interface FlyToRequest {
  lat: number;
  lon: number;
  zoom?: number;
  nonce: number;
}

export interface TelemetryStoreState {
  animals: AnimalDossier[];
  isLoading: boolean;
  loadError: string | null;
  connectionMode: ConnectionMode;
  proxyHealth: ProxyHealthResponse | null;
  selectedAnimalId: string | null;
  guildFilter: EcologicalGuild | 'ALL';
  recencyFilter: PingRecencyFilter;
  feedFilter: FeedStatus | 'ALL';
  featuredStudyFilter: string | 'ALL';
  searchQuery: string;
  basemap: BasemapId;
  trackColorMode: TrackColorMode;
  leftDrawerOpen: boolean;
  rightDrawerOpen: boolean;
  studyImporterOpen: boolean;
  flyToRequest: FlyToRequest | null;
  lastStudyImport: StudyImportResponse | null;
  referenceNowMs: number;

  setLoading: (isLoading: boolean) => void;
  setLoadError: (err: string | null) => void;
  setConnectionStatus: (mode: ConnectionMode, health: ProxyHealthResponse | null) => void;
  setAnimals: (animals: AnimalDossier[], referenceNowMs?: number) => void;
  mergeImportedAnimals: (imported: AnimalDossier[]) => void;
  updateAnimalEnrichment: (
    animalId: string,
    patch: { ecology?: Partial<AnimalEcology>; environment?: Partial<AnimalEnvironment> },
  ) => void;
  selectAnimal: (animalId: string | null, flyTo?: boolean) => void;
  setGuildFilter: (guild: EcologicalGuild | 'ALL') => void;
  setRecencyFilter: (recency: PingRecencyFilter) => void;
  setFeedFilter: (feed: FeedStatus | 'ALL') => void;
  setFeaturedStudyFilter: (studyId: string | 'ALL') => void;
  setSearchQuery: (query: string) => void;
  setBasemap: (basemap: BasemapId) => void;
  setTrackColorMode: (mode: TrackColorMode) => void;
  setLeftDrawerOpen: (open: boolean) => void;
  toggleLeftDrawer: () => void;
  setRightDrawerOpen: (open: boolean) => void;
  toggleRightDrawer: () => void;
  setStudyImporterOpen: (open: boolean) => void;
  setLastStudyImport: (res: StudyImportResponse | null) => void;
  triggerFlyTo: (lat: number, lon: number, zoom?: number) => void;
}

function syncPlaybackBoundsFromAnimals(animals: AnimalDossier[]): void {
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const animal of animals) {
    for (const fix of animal.fixes) {
      if (Number.isFinite(fix.timestampMs)) {
        if (fix.timestampMs < minMs) minMs = fix.timestampMs;
        if (fix.timestampMs > maxMs) maxMs = fix.timestampMs;
      }
    }
  }
  if (Number.isFinite(minMs) && Number.isFinite(maxMs)) {
    playbackClock.initializeBounds(minMs, maxMs);
  }
}

export const useTelemetryStore = create<TelemetryStoreState>((set, get) => ({
  animals: [],
  isLoading: true,
  loadError: null,
  connectionMode: 'STATIC_DECK',
  proxyHealth: null,
  selectedAnimalId: null,
  guildFilter: 'ALL',
  recencyFilter: 'ALL',
  feedFilter: 'ALL',
  featuredStudyFilter: 'ALL',
  searchQuery: '',
  basemap: 'dark-tactical',
  trackColorMode: 'speed',
  leftDrawerOpen: true,
  rightDrawerOpen: false,
  studyImporterOpen: false,
  flyToRequest: null,
  lastStudyImport: null,
  referenceNowMs: Date.now(),

  setLoading: (isLoading) => set({ isLoading }),
  setLoadError: (loadError) => set({ loadError }),
  setConnectionStatus: (connectionMode, proxyHealth) =>
    set({ connectionMode, proxyHealth }),

  setAnimals: (animals, referenceNowMs) => {
    const nowMs = referenceNowMs ?? Date.now();
    syncPlaybackBoundsFromAnimals(animals);
    set({
      animals,
      isLoading: false,
      loadError: null,
      referenceNowMs: nowMs,
    });
  },

  mergeImportedAnimals: (imported) => {
    const existing = get().animals;
    const byId = new Map<string, AnimalDossier>();
    for (const a of existing) byId.set(a.id, a);
    for (const a of imported) byId.set(a.id, a);
    const merged = Array.from(byId.values());
    syncPlaybackBoundsFromAnimals(merged);
    set({ animals: merged });
  },

  updateAnimalEnrichment: (animalId, patch) => {
    set((state) => ({
      animals: state.animals.map((animal) => {
        if (animal.id !== animalId) return animal;
        return {
          ...animal,
          ecology: patch.ecology
            ? { ...animal.ecology, ...patch.ecology }
            : animal.ecology,
          environment: patch.environment
            ? { ...animal.environment, ...patch.environment }
            : animal.environment,
        };
      }),
    }));
  },

  selectAnimal: (animalId, flyTo = true) => {
    if (!animalId) {
      set({ selectedAnimalId: null, rightDrawerOpen: false });
      return;
    }
    const animal = get().animals.find((a) => a.id === animalId);
    if (!animal) return;
    set((state) => ({
      selectedAnimalId: animalId,
      rightDrawerOpen: true,
      flyToRequest: flyTo
        ? {
            lat: animal.latestFix.lat,
            lon: animal.latestFix.lon,
            zoom: animal.guild === 'TERRESTRIAL' || animal.guild === 'REPTILE' ? 6.5 : 4.2,
            nonce: (state.flyToRequest?.nonce ?? 0) + 1,
          }
        : state.flyToRequest,
    }));
  },

  setGuildFilter: (guildFilter) => set({ guildFilter }),
  setRecencyFilter: (recencyFilter) => set({ recencyFilter }),
  setFeedFilter: (feedFilter) => set({ feedFilter }),
  setFeaturedStudyFilter: (featuredStudyFilter) => set({ featuredStudyFilter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setBasemap: (basemap) => set({ basemap }),
  setTrackColorMode: (trackColorMode) => set({ trackColorMode }),
  setLeftDrawerOpen: (leftDrawerOpen) => set({ leftDrawerOpen }),
  toggleLeftDrawer: () => set((s) => ({ leftDrawerOpen: !s.leftDrawerOpen })),
  setRightDrawerOpen: (rightDrawerOpen) => set({ rightDrawerOpen }),
  toggleRightDrawer: () => set((s) => ({ rightDrawerOpen: !s.rightDrawerOpen })),
  setStudyImporterOpen: (studyImporterOpen) => set({ studyImporterOpen }),
  setLastStudyImport: (lastStudyImport) => set({ lastStudyImport }),
  triggerFlyTo: (lat, lon, zoom) =>
    set((state) => ({
      flyToRequest: {
        lat,
        lon,
        zoom,
        nonce: (state.flyToRequest?.nonce ?? 0) + 1,
      },
    })),
}));

export function selectFilteredAnimals(state: TelemetryStoreState): AnimalDossier[] {
  const query = state.searchQuery.trim().toLowerCase();
  const DAY_MS = 24 * 3600 * 1000;
  const SEVEN_DAYS_MS = 7 * DAY_MS;

  return state.animals.filter((animal) => {
    if (state.guildFilter !== 'ALL' && animal.guild !== state.guildFilter) {
      return false;
    }
    if (state.feedFilter !== 'ALL' && animal.feedStatus !== state.feedFilter) {
      return false;
    }
    if (
      state.featuredStudyFilter !== 'ALL' &&
      animal.studyId !== state.featuredStudyFilter
    ) {
      return false;
    }
    if (state.recencyFilter !== 'ALL') {
      const freshnessMs = animal.kinematics.pingFreshnessMs;
      if (state.recencyFilter === 'ACTIVE_24H' && freshnessMs > DAY_MS) {
        return false;
      }
      if (
        state.recencyFilter === 'LAST_7D' &&
        (freshnessMs <= DAY_MS || freshnessMs > SEVEN_DAYS_MS)
      ) {
        return false;
      }
      if (state.recencyFilter === 'HISTORICAL' && freshnessMs <= SEVEN_DAYS_MS) {
        return false;
      }
    }
    if (query.length > 0) {
      const haystack = [
        animal.nickname,
        animal.localIdentifier,
        animal.commonName,
        animal.scientificName,
        animal.attribution.studyTitle,
        animal.studyId,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
