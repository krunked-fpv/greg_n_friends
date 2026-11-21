import { useEffect, useState } from 'react';
import { ecologyEnricher } from '../services/ecologyEnricher';
import { environmentEnricher } from '../services/environmentEnricher';
import { useTelemetryStore } from '../store/telemetryStore';
import type { AnimalDossier } from '../types/telemetry';

export interface AnimalEnrichmentState {
  isEnriching: boolean;
}

/**
 * Triggers parallel, cached ecological (iNaturalist, GBIF, Wikipedia) and
 * environmental (Open-Meteo Weather & Marine, BigDataCloud reverse-geocode, Solar Phase)
 * enrichment whenever an animal is selected. Gracefully falls back when offline.
 */
export function useAnimalEnrichment(
  animalOverride?: AnimalDossier | null,
): AnimalEnrichmentState {
  const selectedAnimalFromStore = useTelemetryStore((state) =>
    state.selectedAnimalId
      ? state.animals.find((a) => a.id === state.selectedAnimalId) ?? null
      : null,
  );
  const referenceNowMs = useTelemetryStore((state) => state.referenceNowMs);
  const updateAnimalEnrichment = useTelemetryStore(
    (state) => state.updateAnimalEnrichment,
  );

  const animal =
    animalOverride !== undefined ? animalOverride : selectedAnimalFromStore;

  const [isEnriching, setIsEnriching] = useState(false);

  const animalId = animal?.id ?? null;
  const scientificName = animal?.scientificName ?? '';
  const ecologyEnriched = animal?.ecology.enriched ?? false;
  const hasPhoto = Boolean(animal?.ecology.photoUrl);
  const envFetchedAt = animal?.environment.fetchedAt ?? null;
  const latestLat = animal?.latestFix?.lat ?? null;
  const latestLon = animal?.latestFix?.lon ?? null;
  const latestAlt = animal?.latestFix?.altitudeOrDepthMeters ?? null;
  const guild = animal?.guild ?? null;

  useEffect(() => {
    if (!animal || !animalId || latestLat === null || latestLon === null || !guild) {
      setIsEnriching(false);
      return;
    }

    const needsEcology = !ecologyEnriched || !hasPhoto;
    const needsEnvironment = envFetchedAt === null;

    if (!needsEcology && !needsEnvironment) {
      setIsEnriching(false);
      return;
    }

    let cancelled = false;
    setIsEnriching(true);

    const run = async (): Promise<void> => {
      try {
        const [nextEcology, nextEnvironment] = await Promise.all([
          needsEcology
            ? ecologyEnricher.enrichAnimalEcology(
                scientificName,
                animal.ecology,
              )
            : Promise.resolve(animal.ecology),
          needsEnvironment
            ? environmentEnricher.enrichAnimalEnvironment({
                lat: latestLat,
                lon: latestLon,
                guild,
                altitudeOrDepthMeters: latestAlt,
                timestampMs: referenceNowMs,
                fallback: animal.environment,
              })
            : Promise.resolve(animal.environment),
        ]);

        if (cancelled) return;

        updateAnimalEnrichment(animalId, {
          ecology: nextEcology,
          environment: nextEnvironment,
        });
      } catch {
        // Enrichment gracefully preserves default dossier fields on failure
      } finally {
        if (!cancelled) {
          setIsEnriching(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    animal,
    animalId,
    scientificName,
    ecologyEnriched,
    hasPhoto,
    envFetchedAt,
    latestLat,
    latestLon,
    latestAlt,
    guild,
    referenceNowMs,
    updateAnimalEnrichment,
  ]);

  return { isEnriching };
}
