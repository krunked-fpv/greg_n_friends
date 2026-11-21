import { useEffect } from 'react';
import { AnimalBioDossier } from './components/dossier/AnimalBioDossier';
import { FleetDiscoveryPanel } from './components/hud/FleetDiscoveryPanel';
import { StudyImporterModal } from './components/hud/StudyImporterModal';
import { TopCommandBar } from './components/hud/TopCommandBar';
import { WildPulseMap } from './components/map/WildPulseMap';
import { MigrationTimelineBar } from './components/timeline/MigrationTimelineBar';
import { useAnimalEnrichment } from './hooks/useAnimalEnrichment';
import { usePlaybackTicker } from './hooks/usePlaybackTicker';
import { useWildPulseKeyboard } from './hooks/useWildPulseKeyboard';
import { telemetryClient } from './services/telemetryClient';
import { useTelemetryStore } from './store/telemetryStore';

export function App() {
  const setLoading = useTelemetryStore((s) => s.setLoading);
  const setLoadError = useTelemetryStore((s) => s.setLoadError);
  const setConnectionStatus = useTelemetryStore((s) => s.setConnectionStatus);
  const setAnimals = useTelemetryStore((s) => s.setAnimals);
  const loadError = useTelemetryStore((s) => s.loadError);

  useWildPulseKeyboard();
  usePlaybackTicker();
  useAnimalEnrichment();

  useEffect(() => {
    let active = true;

    const bootstrapFleet = async (): Promise<void> => {
      setLoading(true);
      try {
        const fleet = await telemetryClient.loadFleet(Date.now());
        if (!active) return;

        setConnectionStatus(
          fleet.connectionMode,
          telemetryClient.getLastProxyHealth(),
        );
        const refNow = Date.parse(fleet.generatedAt);
        setAnimals(
          fleet.animals,
          Number.isFinite(refNow) ? refNow : Date.now(),
        );
      } catch (err) {
        if (!active) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to initialize WildPulse telemetry feeds.';
        setLoadError(message);
        setLoading(false);
      }
    };

    void bootstrapFleet();

    return () => {
      active = false;
    };
  }, [setLoading, setLoadError, setConnectionStatus, setAnimals]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-obsidian-950 text-slate-100">
      <WildPulseMap />

      <TopCommandBar />

      <FleetDiscoveryPanel />

      <AnimalBioDossier />

      <MigrationTimelineBar />

      <StudyImporterModal
        onImportStudy={(studyId, licenseMd5) =>
          telemetryClient.importMovebankStudy(studyId, licenseMd5)
        }
      />

      {loadError ? (
        <div
          role="alert"
          className="pointer-events-auto fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-rose-400/50 bg-obsidian-950/95 px-4 py-2 text-xs font-mono text-rose-200 shadow-2xl backdrop-blur-xl"
        >
          TELEMETRY BOOTSTRAP WARNING: {loadError}
        </div>
      ) : null}
    </div>
  );
}

export default App;
