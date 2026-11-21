import type { AnimalDossier, SensorType } from '../../src/types/telemetry.ts';
import {
  argosAccuracyMeters,
  buildDefaultEcology,
  buildDefaultEnvironment,
  computeAnimalKinematics,
  normalizeArgosLc,
  normalizeTelemetryFixes,
  type RawFixInput,
} from '../kinematics.ts';

export const DEFAULT_ATN_ERDDAP_BASE_URL = 'https://atn.ioos.us/erddap/tabledap';

export interface AtnDatasetSpec {
  datasetId: string;
  id: string;
  nickname: string;
  commonName: string;
  scientificName: string;
  colorHex: string;
  regionLabel: string;
  studyTitle: string;
  principalInvestigators: string;
  institution: string;
  studyUrl: string;
  licenseTerms: string;
}

export const ATN_CURATED_DATASETS: AtnDatasetSpec[] = [
  {
    datasetId: 'atn_174822_spotted-seal_trajectory_20180414-20181103',
    id: 'atn-174822-spotted-seal',
    nickname: 'Bering Seal PL2018 (PTT 174822)',
    commonName: 'Spotted Seal',
    scientificName: 'Phoca largha',
    colorHex: '#2dd4bf',
    regionLabel: 'Bering Sea, North Pacific',
    studyTitle: 'Bering Sea Spotted & Ribbon Seal Telemetry (PTT 174822)',
    principalInvestigators:
      'Josh London, Stacie Koslovsky, Michael Cameron, Peter Boveng, Heather Ziel',
    institution: 'NOAA Alaska Fisheries Science Center (Marine Mammal Laboratory)',
    studyUrl:
      'https://portal.atn.ioos.us/#metadata/70c76508-b252-4c3d-9f27-e4cba9300537/project',
    licenseTerms:
      'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge NOAA AFSC & US IOOS ATN.',
  },
  {
    datasetId: 'atn_94821_blainvilles-beaked-whale_trajectory_20091221-20100111',
    id: 'atn-94821-beaked-whale',
    nickname: "HIMd168 Beaked Whale (PTT 94821)",
    commonName: "Blainville's Beaked Whale",
    scientificName: 'Mesoplodon densirostris',
    colorHex: '#60a5fa',
    regionLabel: "Hawai'i Island Basin, Central Pacific",
    studyTitle: 'Odontocete Tagging in the Main Hawaiian Islands (PTT 94821)',
    principalInvestigators:
      'Robin Baird, M. Bradley Hanson, Gregory S. Schorr, Daniel L. Webster, Erin M. Oleson',
    institution: 'Cascadia Research Collective / NOAA Fisheries',
    studyUrl:
      'https://portal.atn.ioos.us/#metadata/1f1ff520-a4f5-4425-9681-57396059f1c9/project',
    licenseTerms:
      'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge Cascadia Research Collective & US IOOS ATN.',
  },
  {
    datasetId: 'atn_85568_short-finned-pilot-whale_trajectory_20080705-20080802',
    id: 'atn-85568-pilot-whale',
    nickname: 'HIGm0471 Pilot Whale (PTT 85568)',
    commonName: 'Short-finned Pilot Whale',
    scientificName: 'Globicephala macrorhynchus',
    colorHex: '#38bdf8',
    regionLabel: "Hawai'i Island Basin, Central Pacific",
    studyTitle: 'Odontocete Tagging in the Main Hawaiian Islands (PTT 85568)',
    principalInvestigators:
      'Robin Baird, M. Bradley Hanson, Gregory S. Schorr, Daniel L. Webster, Erin M. Oleson',
    institution: 'Cascadia Research Collective / NOAA Fisheries',
    studyUrl:
      'https://portal.atn.ioos.us/#metadata/1f1ff520-a4f5-4425-9681-57396059f1c9/project',
    licenseTerms:
      'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge Cascadia Research Collective & US IOOS ATN.',
  },
];

export interface ErddapTableJson {
  table?: {
    columnNames?: string[];
    columnUnits?: Array<string | null>;
    rows?: unknown[][];
  };
}

export interface AtnErddapProviderOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  limitRows?: number;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNonEmptyString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'not specified') {
    return null;
  }
  return s;
}

function normalizeErddapDepthMeters(rawDepth: unknown): number | null {
  const num = toFiniteNumber(rawDepth);
  if (num === null) return null;
  return num === 0 ? 0 : -Math.abs(num);
}

function resolveAtnSensorType(rawType: unknown, rawTag: unknown): SensorType {
  const combined = `${String(rawType ?? '')} ${String(rawTag ?? '')}`.toLowerCase();
  if (combined.includes('gps') || combined.includes('fastloc')) return 'GPS-GSM';
  if (combined.includes('acoustic')) return 'Acoustic / Archival';
  return 'Argos Doppler PTT';
}

export class AtnErddapProvider {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly limitRows: number;

  constructor(options?: AtnErddapProviderOptions) {
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.baseUrl = (options?.baseUrl ?? DEFAULT_ATN_ERDDAP_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options?.timeoutMs ?? 6000;
    this.limitRows = options?.limitRows ?? 160;
  }

  public buildDatasetUrl(datasetId: string): string {
    return `${this.baseUrl}/${encodeURIComponent(datasetId)}.json?&orderByLimit(%22${this.limitRows}%22)`;
  }

  public parseDatasetResponse(
    spec: AtnDatasetSpec,
    payload: ErddapTableJson,
    referenceNowMs: number = Date.now(),
  ): AnimalDossier | null {
    const colNames = payload.table?.columnNames;
    const rows = payload.table?.rows;
    if (!Array.isArray(colNames) || !Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const colIdx = new Map<string, number>();
    colNames.forEach((name, idx) => colIdx.set(name, idx));
    const cell = (row: unknown[], col: string): unknown => {
      const idx = colIdx.get(col);
      return idx !== undefined ? row[idx] : undefined;
    };

    const rawFixes: RawFixInput[] = [];
    let localIdentifier = spec.id;
    let scientificName = spec.scientificName;
    let sex = 'unknown';
    let lifeStage = 'adult';
    let massKg: number | null = null;

    for (const row of rows) {
      if (!Array.isArray(row)) continue;

      const qartodLoc = toFiniteNumber(cell(row, 'qartod_location_flag'));
      if (qartodLoc === 4) continue; // Skip QARTOD-failed positions.

      const timeStr = toNonEmptyString(cell(row, 'time'));
      const lat = toFiniteNumber(cell(row, 'latitude'));
      const lon = toFiniteNumber(cell(row, 'longitude'));
      if (!timeStr || lat === null || lon === null) continue;

      const timestampMs = Date.parse(timeStr);
      if (!Number.isFinite(timestampMs)) continue;

      const animalField = toNonEmptyString(cell(row, 'animal'));
      const deployField = toNonEmptyString(cell(row, 'deploy_id'));
      if (animalField) localIdentifier = animalField;
      else if (deployField) localIdentifier = deployField;

      const taxonField = toNonEmptyString(cell(row, 'taxon_name'));
      if (taxonField) scientificName = taxonField;

      const sexField = toNonEmptyString(cell(row, 'animal_sex'));
      if (sexField) sex = sexField.toLowerCase();

      const stageField = toNonEmptyString(cell(row, 'animal_life_stage'));
      if (stageField) lifeStage = stageField.toLowerCase();

      const weightField = toFiniteNumber(cell(row, 'animal_weight'));
      if (weightField !== null && weightField > 0) massKg = weightField;

      const argosLc = normalizeArgosLc(cell(row, 'location_class'));
      const rawErrorRadius = toFiniteNumber(cell(row, 'error_radius'));
      const accuracyRadiusMeters =
        rawErrorRadius !== null && rawErrorRadius > 0
          ? rawErrorRadius
          : argosAccuracyMeters(argosLc);

      rawFixes.push({
        timestampMs,
        lat,
        lon,
        altitudeOrDepthMeters: normalizeErddapDepthMeters(cell(row, 'depth')),
        argosLc,
        accuracyRadiusMeters,
        sensorType: resolveAtnSensorType(
          cell(row, 'type'),
          cell(row, 'instrument_tag') ?? cell(row, 'instrument'),
        ),
      });
    }

    const fixes = normalizeTelemetryFixes(spec.id, rawFixes, 'MARINE');
    if (fixes.length === 0) return null;

    const latestFix = fixes[fixes.length - 1];
    const kinematics = computeAnimalKinematics(fixes, referenceNowMs);
    const ecology = buildDefaultEcology(scientificName);
    const environment = buildDefaultEnvironment(
      latestFix.lat,
      latestFix.lon,
      latestFix.timestampMs,
      spec.regionLabel,
      'MARINE',
      latestFix.altitudeOrDepthMeters,
      latestFix.externalTempC,
    );

    return {
      id: spec.id,
      localIdentifier,
      nickname: spec.nickname,
      scientificName,
      commonName: spec.commonName,
      guild: 'MARINE',
      sex,
      lifeStage,
      massKg,
      deploymentStartIso: fixes[0].timestamp,
      feedStatus: 'LIVE_API',
      sourceProvider: 'IOOS_ATN_ERDDAP',
      studyId: spec.datasetId,
      diagnosticStatus: 'OK',
      colorHex: spec.colorHex,
      latestFix,
      fixes,
      kinematics,
      ecology,
      environment,
      attribution: {
        studyTitle: spec.studyTitle,
        principalInvestigators: spec.principalInvestigators,
        institution: spec.institution,
        studyUrl: spec.studyUrl,
        licenseTerms: spec.licenseTerms,
        licenseMd5Required: false,
      },
    };
  }

  public async fetchDataset(
    spec: AtnDatasetSpec,
    referenceNowMs: number = Date.now(),
  ): Promise<AnimalDossier | null> {
    const url = this.buildDatasetUrl(spec.datasetId);
    const res = await this.fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`ATN ERDDAP HTTP ${res.status} for ${spec.datasetId}`);
    }

    const payload = (await res.json()) as ErddapTableJson;
    return this.parseDatasetResponse(spec, payload, referenceNowMs);
  }

  public async fetchCuratedMarineFleet(
    referenceNowMs: number = Date.now(),
  ): Promise<AnimalDossier[]> {
    const settled = await Promise.allSettled(
      ATN_CURATED_DATASETS.map((spec) => this.fetchDataset(spec, referenceNowMs)),
    );

    const animals: AnimalDossier[] = [];
    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value) {
        animals.push(item.value);
      }
    }
    return animals;
  }
}
