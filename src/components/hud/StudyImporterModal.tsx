import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DownloadCloud,
  FileCheck2,
  KeyRound,
  Loader2,
  Radio,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { useTelemetryStore } from '../../store/telemetryStore';
import type { DiagnosticStatus, StudyImportResponse } from '../../types/telemetry';
import { FeedProvenanceBadge } from './telemetryBadges';

export interface StudyImporterModalProps {
  onImportStudy?: (studyId: string, licenseMd5?: string) => Promise<StudyImportResponse>;
}

const FEATURED_PRESETS = [
  {
    studyId: '2911040',
    title: 'Galápagos Albatrosses',
    species: 'Phoebastria irrorata',
    badge: 'PUBLIC GPS',
    description:
      'Verified Movebank open-access pelagic foraging tracks across the Humboldt Current & Galápagos archipelago.',
  },
];

async function defaultImportStudy(
  studyId: string,
  licenseMd5?: string,
): Promise<StudyImportResponse> {
  const endpoint = new URL(
    `api/studies/${encodeURIComponent(studyId)}${
      licenseMd5 ? `?licenseMd5=${encodeURIComponent(licenseMd5)}` : ''
    }`,
    document.baseURI,
  );
  const res = await fetch(endpoint.toString(), {
    signal: AbortSignal.timeout(12000),
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Movebank proxy endpoint unavailable (HTTP ${res.status}). Start the local Express proxy server to query arbitrary Movebank studies.`,
    );
  }
  const payload = (await res.json()) as StudyImportResponse;
  return payload;
}

function getDiagnosticBannerMeta(status: DiagnosticStatus): {
  title: string;
  containerClass: string;
  icon: typeof CheckCircle2;
} {
  switch (status) {
    case 'OK':
      return {
        title: 'Study Telemetry Loaded & Merged',
        containerClass: 'border-emerald-400/50 bg-emerald-500/12 text-emerald-100',
        icon: CheckCircle2,
      };
    case 'LICENSE_REQUIRED':
      return {
        title: 'Movebank Data License Confirmation Required',
        containerClass: 'border-amber-400/55 bg-amber-500/12 text-amber-100',
        icon: FileCheck2,
      };
    case 'AUTH_REQUIRED':
      return {
        title: 'Movebank Direct-Read Credentials Required',
        containerClass: 'border-rose-400/55 bg-rose-500/12 text-rose-100',
        icon: KeyRound,
      };
    case 'TAG_SILENT':
      return {
        title: 'Study Valid — No Active Telemetry Coordinates',
        containerClass: 'border-amber-400/45 bg-amber-500/10 text-amber-100',
        icon: Radio,
      };
    case 'RATE_LIMITED':
      return {
        title: 'Upstream Movebank Rate Limit Triggered',
        containerClass: 'border-rose-400/50 bg-rose-500/12 text-rose-100',
        icon: Clock,
      };
  }
}

export function StudyImporterModal({ onImportStudy }: StudyImporterModalProps) {
  const studyImporterOpen = useTelemetryStore((s) => s.studyImporterOpen);
  const setStudyImporterOpen = useTelemetryStore((s) => s.setStudyImporterOpen);
  const mergeImportedAnimals = useTelemetryStore((s) => s.mergeImportedAnimals);
  const setLastStudyImport = useTelemetryStore((s) => s.setLastStudyImport);
  const selectAnimal = useTelemetryStore((s) => s.selectAnimal);
  const lastStudyImport = useTelemetryStore((s) => s.lastStudyImport);

  const [studyIdInput, setStudyIdInput] = useState<string>('2911040');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<StudyImportResponse | null>(
    lastStudyImport,
  );

  useEffect(() => {
    setImportResult(lastStudyImport);
  }, [lastStudyImport]);

  useEffect(() => {
    if (studyImporterOpen) {
      setNetworkError(null);
    }
  }, [studyImporterOpen]);

  useEffect(() => {
    if (!studyImporterOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStudyImporterOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [studyImporterOpen, setStudyImporterOpen]);

  if (!studyImporterOpen) {
    return null;
  }

  const executeImport = async (rawStudyId: string, licenseMd5?: string) => {
    const cleanId = rawStudyId.trim();
    if (!cleanId) {
      setNetworkError('Enter a valid Movebank Study ID (e.g. 2911040).');
      return;
    }

    setStudyIdInput(cleanId);
    setIsSubmitting(true);
    setNetworkError(null);

    try {
      const handler = onImportStudy ?? defaultImportStudy;
      const response = await handler(cleanId, licenseMd5);
      setImportResult(response);
      setLastStudyImport(response);

      if (response.diagnosticStatus === 'OK' && response.animals.length > 0) {
        mergeImportedAnimals(response.animals);
        selectAnimal(response.animals[0].id, true);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to reach Movebank telemetry importer endpoint.';
      setNetworkError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void executeImport(studyIdInput);
  };

  const handleAcceptLicense = () => {
    if (!importResult) return;
    const targetId = importResult.studyId || studyIdInput.trim();
    void executeImport(targetId, importResult.licenseMd5 ?? undefined);
  };

  const handleInspectLoaded = () => {
    if (importResult && importResult.animals.length > 0) {
      selectAnimal(importResult.animals[0].id, true);
    }
    setStudyImporterOpen(false);
  };

  const activeDiagnostic = importResult?.diagnosticStatus ?? null;
  const bannerMeta = activeDiagnostic ? getDiagnosticBannerMeta(activeDiagnostic) : null;
  const BannerIcon = bannerMeta?.icon ?? AlertTriangle;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-obsidian-950/75 backdrop-blur-md p-4"
      onClick={() => setStudyImporterOpen(false)}
      role="presentation"
    >
      <div
        data-testid="study-importer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-importer-title"
        onClick={(e) => e.stopPropagation()}
        className="hud-glass-elevated w-full max-w-xl rounded-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b hud-hairline px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-500/15">
              <DownloadCloud className="h-4 w-4 text-cyan-300" />
            </div>
            <div className="min-w-0">
              <h2
                id="study-importer-title"
                className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-100 truncate"
              >
                Movebank Study Importer
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Serialized telemetry queue with automated license-md5 handshake
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStudyImporterOpen(false)}
            aria-label="Close Movebank Study Importer"
            className="shrink-0 rounded-lg border border-slate-700/70 bg-obsidian-900/70 p-1.5 text-slate-400 hover:border-cyan-400/50 hover:text-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto hud-scrollbar p-5 space-y-4">
          {/* Custom Study ID Form */}
          <form onSubmit={handleSubmit} className="space-y-2">
            <label
              htmlFor="movebank-study-id-input"
              className="block hud-section-label"
            >
              Movebank Study ID
            </label>
            <div className="flex items-center gap-2">
              <input
                id="movebank-study-id-input"
                type="text"
                data-testid="study-id-input"
                value={studyIdInput}
                onChange={(e) => setStudyIdInput(e.target.value)}
                placeholder="Enter Movebank Study ID (e.g. 2911040)"
                className="select-text min-w-0 flex-1 rounded-lg border border-slate-700/80 bg-obsidian-950/90 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/70 focus:outline-none"
              />
              <button
                type="submit"
                data-testid="study-import-submit-btn"
                disabled={isSubmitting}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/50 bg-cyan-500/20 px-4 py-2 font-mono text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Querying...</span>
                  </>
                ) : (
                  <>
                    <DownloadCloud className="h-3.5 w-3.5" />
                    <span>Load Study</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Featured Public Presets */}
          <div className="space-y-1.5">
            <div className="hud-section-label flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-cyan-300" />
              <span>Featured Public Study Preset</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {FEATURED_PRESETS.map((preset) => (
                <button
                  key={preset.studyId}
                  type="button"
                  data-testid={`study-preset-${preset.studyId}`}
                  disabled={isSubmitting}
                  onClick={() => void executeImport(preset.studyId)}
                  className="hud-card rounded-xl p-3 text-left flex items-start justify-between gap-3 disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="shrink-0 rounded bg-cyan-500/15 border border-cyan-400/35 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300 tabular-telemetry">
                        ID {preset.studyId}
                      </span>
                      <span className="text-xs font-semibold text-slate-100">
                        {preset.title}
                      </span>
                      <span className="text-[11px] italic text-slate-400">
                        {preset.species}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {preset.description}
                    </p>
                  </div>
                  <span className="shrink-0 rounded border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[9.5px] font-semibold text-emerald-300">
                    {preset.badge}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Network Error */}
          {networkError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/50 bg-rose-500/15 p-3 text-xs text-rose-100 flex items-start gap-2.5"
            >
              <ShieldAlert className="h-4 w-4 text-rose-300 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] font-bold uppercase text-rose-200">
                  Request Failed
                </div>
                <p className="mt-0.5 text-[11px] text-rose-200/90 break-words">{networkError}</p>
              </div>
            </div>
          )}

          {/* Diagnostic Result Banner */}
          {importResult && bannerMeta && (
            <div
              data-testid={`study-import-status-${importResult.diagnosticStatus}`}
              className={`rounded-xl border p-3.5 space-y-2.5 ${bannerMeta.containerClass}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <BannerIcon className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-bold uppercase tracking-wider">
                        {bannerMeta.title}
                      </span>
                      <span className="rounded border border-white/15 bg-black/25 px-1.5 py-0.5 font-mono text-[9.5px]">
                        {importResult.diagnosticStatus}
                      </span>
                    </div>
                    <p className="mt-1 text-xs opacity-90 select-text break-words">
                      {importResult.message}
                    </p>
                  </div>
                </div>
                <FeedProvenanceBadge feedStatus={importResult.feedStatus} compact />
              </div>

              {/* OK Details */}
              {importResult.diagnosticStatus === 'OK' && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2.5">
                  <div className="font-mono text-[11px] text-emerald-200 tabular-telemetry">
                    Study #{importResult.studyId}: {importResult.animals.length}{' '}
                    {importResult.animals.length === 1 ? 'individual' : 'individuals'} merged into
                    active fleet
                  </div>
                  {importResult.animals.length > 0 && (
                    <button
                      type="button"
                      onClick={handleInspectLoaded}
                      className="rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3 py-1 font-mono text-[10.5px] font-semibold text-emerald-100 hover:bg-emerald-500/30 transition-colors"
                    >
                      Inspect Track on Map
                    </button>
                  )}
                </div>
              )}

              {/* AUTH_REQUIRED Guidance */}
              {importResult.diagnosticStatus === 'AUTH_REQUIRED' && (
                <p className="border-t border-white/10 pt-2 text-[11px] text-rose-200/85">
                  Configure <code className="font-mono text-rose-100">MOVEBANK_USERNAME</code> and{' '}
                  <code className="font-mono text-rose-100">MOVEBANK_PASSWORD</code> in your local
                  server <code className="font-mono text-rose-100">.env</code> (or run the local
                  Express proxy) for restricted Movebank Direct-Read studies.
                </p>
              )}

              {/* TAG_SILENT Guidance */}
              {importResult.diagnosticStatus === 'TAG_SILENT' && (
                <p className="border-t border-white/10 pt-2 text-[11px] text-amber-200/85">
                  Movebank returned study metadata without valid GPS/Argos coordinates in the active
                  sensor query window.
                </p>
              )}

              {/* RATE_LIMITED Guidance */}
              {importResult.diagnosticStatus === 'RATE_LIMITED' && (
                <p className="border-t border-white/10 pt-2 text-[11px] text-rose-200/85">
                  Movebank throttled upstream polling (HTTP 429). Wait a few seconds and retry; the
                  proxy FIFO queue serializes calls to prevent concurrent floods.
                </p>
              )}
            </div>
          )}

          {/* Interactive license-md5 Study Terms Confirmation Drawer */}
          {importResult?.diagnosticStatus === 'LICENSE_REQUIRED' && (
            <div
              data-testid="license-terms-drawer"
              className="rounded-xl border border-amber-400/55 bg-obsidian-950/90 p-4 space-y-3 shadow-[0_0_24px_-8px_rgba(245,158,11,0.35)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="h-4 w-4 text-amber-300" />
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-amber-200">
                    Study License Terms Confirmation
                  </span>
                </div>
                {importResult.licenseMd5 && (
                  <span
                    data-testid="license-md5-hash"
                    className="select-text rounded border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-200 tabular-telemetry"
                  >
                    MD5: {importResult.licenseMd5}
                  </span>
                )}
              </div>

              <div
                data-testid="license-terms-text"
                className="select-text max-h-40 overflow-y-auto hud-scrollbar rounded-lg border border-slate-700/70 bg-obsidian-900/90 p-3 font-mono text-[11px] leading-relaxed text-slate-200 whitespace-pre-wrap"
              >
                {importResult.licenseTermsText ||
                  'This Movebank study requires explicit acceptance of the principal investigator data license terms before telemetry events are released.'}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setImportResult(null)}
                  className="rounded-lg border border-slate-700 bg-obsidian-900 px-3 py-1.5 font-mono text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="accept-license-btn"
                  disabled={isSubmitting}
                  onClick={handleAcceptLicense}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/60 bg-amber-500/20 px-4 py-1.5 font-mono text-[11px] font-semibold text-amber-100 hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileCheck2 className="h-3.5 w-3.5" />
                  )}
                  <span>Accept License Terms &amp; Load Tracks</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StudyImporterModal;
