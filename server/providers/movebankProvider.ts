import crypto from 'node:crypto';
import type {
  AnimalDossier,
  DiagnosticStatus,
  EcologicalGuild,
  SensorType,
  StudyAttribution,
  StudyImportResponse,
} from '../../src/types/telemetry.ts';
import {
  buildDefaultEcology,
  buildDefaultEnvironment,
  computeAnimalKinematics,
  inferGuildFromTaxon,
  normalizeArgosLc,
  normalizeTelemetryFixes,
  type RawFixInput,
} from '../kinematics.ts';
import {
  MovebankQueue,
  RetryableUpstreamError,
  parseRetryAfterMs,
} from '../movebankQueue.ts';

export const FEATURED_MOVEBANK_STUDY_ID = '2911040';
export const FEATURED_MOVEBANK_INDIVIDUAL = '4262-84830876';
export const DEFAULT_MOVEBANK_BASE_URL = 'https://www.movebank.org/movebank/service';

export interface MovebankProviderOptions {
  queue?: MovebankQueue;
  fetchFn?: typeof fetch;
  username?: string;
  password?: string;
  baseUrl?: string;
  maxEventsPerIndividual?: number;
  timeoutMs?: number;
}

export interface FetchStudyOptions {
  licenseMd5?: string;
  individualLocalIdentifiers?: string[];
  sensorType?: string;
  maxEventsPerIndividual?: number;
  preferDirectRead?: boolean;
  preferPublicJson?: boolean;
  includeStudyMetadata?: boolean;
  referenceNowMs?: number;
}

interface MovebankJsonLocation {
  timestamp?: number | string;
  location_long?: number | string;
  location_lat?: number | string;
  height_above_ellipsoid?: number | string;
  height_above_msl?: number | string;
  ground_speed?: number | string;
  heading?: number | string;
  external_temperature?: number | string;
  tag_voltage?: number | string;
  argos_lc?: string;
  argos_error_radius?: number | string;
  sensor_type?: string;
}

interface MovebankJsonIndividual {
  study_id?: number | string;
  individual_id?: number | string;
  individual_local_identifier?: string;
  individual_taxon_canonical_name?: string;
  sensor_type_id?: number;
  sensor_id?: number;
  locations?: MovebankJsonLocation[];
}

interface MovebankStudyMeta {
  studyTitle?: string;
  principalInvestigators?: string;
  institution?: string;
  licenseTerms?: string;
  licenseMd5Required?: boolean;
}

const KNOWN_STUDY_ATTRIBUTIONS: Record<string, MovebankStudyMeta> = {
  '2911040': {
    studyTitle: 'Galapagos Albatrosses',
    principalInvestigators:
      'Sebastian M. Cruz, Kirsten P. Huyvaert, David J. Anderson, Martin Wikelski',
    institution:
      'Max Planck Institute of Animal Behavior / Wake Forest University / Charles Darwin Foundation',
    licenseTerms: 'CC0 / Public Movebank Study 2911040 (Galapagos Albatrosses)',
    licenseMd5Required: false,
  },
};

const TELEMETRY_PALETTE = [
  '#38bdf8',
  '#22d3ee',
  '#fbbf24',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#f97316',
];

function pickColorHex(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return TELEMETRY_PALETTE[hash % TELEMETRY_PALETTE.length];
}

export function computeLicenseMd5(rawLicenseText: string): string {
  return crypto.createHash('md5').update(rawLicenseText, 'utf8').digest('hex');
}

export function parseCsvRfc4180(csvText: string): Record<string, string>[] {
  const clean = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"' && currentField.length === 0) {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\r') {
      if (clean[i + 1] === '\n') {
        i += 1;
      }
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else if (ch === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  const nonEmptyRows = rows.filter(
    (row) => row.length > 1 || (row.length === 1 && row[0].trim() !== ''),
  );
  if (nonEmptyRows.length === 0) return [];

  const headers = nonEmptyRows[0].map((h) => h.trim());
  const records: Record<string, string>[] = [];

  for (let r = 1; r < nonEmptyRows.length; r++) {
    const row = nonEmptyRows[r];
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (!header) continue;
      record[header] = row[c] !== undefined ? row[c].trim() : '';
    }
    records.push(record);
  }

  return records;
}

function parseOptionalNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const trimmed = String(raw).trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'nan') {
    return null;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function parseMovebankTimestampMs(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }

  // Movebank CSV timestamps are UTC "YYYY-MM-DD HH:MM:SS.SSS" without trailing Z.
  const isoCandidate = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(trimmed)
    ? `${trimmed.replace(/\s+/, 'T')}${/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ? '' : 'Z'}`
    : trimmed;

  const parsed = Date.parse(isoCandidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveSensorType(rawType?: string | number | null): SensorType {
  if (rawType === 653) return 'GPS-GSM';
  if (rawType === 82798) return 'Argos Doppler PTT';
  if (rawType === 397) return 'Solar Geolocation';
  const str = String(rawType ?? '').trim().toLowerCase();
  if (str.includes('argos')) return 'Argos Doppler PTT';
  if (str.includes('solar') || str.includes('gls')) return 'Solar Geolocation';
  if (str.includes('acoustic')) return 'Acoustic / Archival';
  return 'GPS-GSM';
}

function getField(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (key in row && row[key] !== '') return row[key];
  }
  return undefined;
}

function isMovebankCsvHeader(firstLine: string): boolean {
  if (!firstLine.includes(',')) return false;
  const cols = firstLine
    .replace(/^\uFEFF/, '')
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());

  const knownHeaders = new Set([
    'timestamp',
    'location_long',
    'location-long',
    'location_lat',
    'location-lat',
    'lon',
    'lat',
    'longitude',
    'latitude',
    'individual_local_identifier',
    'individual-local-identifier',
    'individual_id',
    'individual-id',
    'study_id',
    'study-id',
    'event_id',
    'event-id',
  ]);

  return cols.some((col) => knownHeaders.has(col));
}

function looksLikeTomcatOrAuthDenial(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('http status 401') ||
    lower.includes('http status 403') ||
    lower.includes('unauthorized') ||
    lower.includes('access denied') ||
    lower.includes('access is denied') ||
    lower.includes('do not have permission') ||
    lower.includes('requires authentication') ||
    lower.includes('not authorized')
  );
}

function looksLikeLicenseChallenge(text: string, httpStatus: number): boolean {
  const lower = text.toLowerCase();
  if (!text.trim()) return false;
  if (looksLikeTomcatOrAuthDenial(text)) return false;
  if (lower.includes('rate limiting') || lower.includes('too many requests')) return false;

  if (httpStatus === 403) {
    return (
      lower.includes('license') ||
      lower.includes('terms') ||
      lower.includes('by downloading') ||
      lower.includes('please read') ||
      lower.includes('agreement')
    );
  }

  return true;
}

function looksLikeRateLimitBody(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('rate limiting') || lower.includes('too many requests');
}

export class MovebankProvider {
  public readonly queue: MovebankQueue;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly defaultMaxEvents: number;
  private readonly timeoutMs: number;
  private readonly explicitUsername?: string;
  private readonly explicitPassword?: string;
  private readonly studyCookies = new Map<string, string>();

  constructor(options?: MovebankProviderOptions) {
    this.queue = options?.queue ?? new MovebankQueue({ minIntervalMs: 450 });
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.baseUrl = (options?.baseUrl ?? DEFAULT_MOVEBANK_BASE_URL).replace(/\/+$/, '');
    this.defaultMaxEvents = options?.maxEventsPerIndividual ?? 140;
    this.timeoutMs = options?.timeoutMs ?? 10_000;
    this.explicitUsername = options?.username;
    this.explicitPassword = options?.password;
  }

  private getCredentials(): { username: string; password: string } | null {
    const username = (this.explicitUsername ?? process.env.MOVEBANK_USERNAME ?? '').trim();
    const password = (this.explicitPassword ?? process.env.MOVEBANK_PASSWORD ?? '').trim();
    if (!username || !password) return null;
    return { username, password };
  }

  public isAuthConfigured(): boolean {
    return this.getCredentials() !== null;
  }

  private buildAuthHeaders(studyId: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/csv, text/plain, */*',
    };
    const creds = this.getCredentials();
    if (creds) {
      const encoded = Buffer.from(`${creds.username}:${creds.password}`, 'utf8').toString('base64');
      headers.Authorization = `Basic ${encoded}`;
    }
    const cookie = this.studyCookies.get(studyId);
    if (cookie) {
      headers.Cookie = cookie;
    }
    return headers;
  }

  private captureCookies(studyId: string, headers: Headers): void {
    const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const rawCookies: string[] = [];
    if (typeof getSetCookie === 'function') {
      rawCookies.push(...getSetCookie.call(headers));
    } else {
      const single = headers.get('set-cookie');
      if (single) rawCookies.push(single);
    }
    if (rawCookies.length === 0) return;

    const pairs = rawCookies
      .map((entry) => entry.split(';')[0]?.trim())
      .filter((pair): pair is string => Boolean(pair));
    if (pairs.length > 0) {
      this.studyCookies.set(studyId, pairs.join('; '));
    }
  }

  private async queuedFetchText(
    queueKey: string,
    url: string,
    headers: Record<string, string>,
    studyIdForCookies?: string,
  ): Promise<{ status: number; body: string }> {
    return this.queue.enqueue(queueKey, async () => {
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (studyIdForCookies) {
        this.captureCookies(studyIdForCookies, res.headers);
      }

      const body = await res.text();

      if (res.status === 429 || res.status === 503 || looksLikeRateLimitBody(body)) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        throw new RetryableUpstreamError(
          res.status === 200 ? 429 : res.status,
          `Movebank upstream rate limited (${res.status})`,
          retryAfterMs,
          body,
        );
      }

      return { status: res.status, body };
    });
  }

  private async fetchStudyMetadata(
    studyId: string,
    licenseMd5?: string,
  ): Promise<MovebankStudyMeta | null> {
    if (!this.isAuthConfigured()) return null;
    const params = new URLSearchParams({
      entity_type: 'study',
      study_id: studyId,
    });
    if (licenseMd5) {
      params.set('license-md5', licenseMd5);
    }
    const url = `${this.baseUrl}/direct-read?${params.toString()}`;
    try {
      const { status, body } = await this.queuedFetchText(
        `mb:study-meta:${studyId}`,
        url,
        this.buildAuthHeaders(studyId),
        studyId,
      );
      if (status !== 200) return null;
      const firstLine = body.split(/\r?\n/)[0] ?? '';
      if (!isMovebankCsvHeader(firstLine)) return null;
      const rows = parseCsvRfc4180(body);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        studyTitle: row.name || undefined,
        principalInvestigators: row.principal_investigator_name || undefined,
        institution: row.principal_investigator_address || row.acknowledgements || undefined,
        licenseTerms: row.license_terms || row.license_type || undefined,
        licenseMd5Required: Boolean(row.license_terms),
      };
    } catch {
      return null;
    }
  }

  private buildAttribution(
    studyId: string,
    meta: MovebankStudyMeta | null,
    licenseMd5Used: boolean,
  ): StudyAttribution {
    const known = KNOWN_STUDY_ATTRIBUTIONS[studyId];
    return {
      studyTitle: meta?.studyTitle ?? known?.studyTitle ?? `Movebank Study #${studyId}`,
      principalInvestigators:
        meta?.principalInvestigators ??
        known?.principalInvestigators ??
        'Movebank Study Principal Investigator(s)',
      institution:
        meta?.institution ?? known?.institution ?? 'Movebank Animal Tracking Repository',
      studyUrl: `https://www.movebank.org/cms/webapp?gwt_fragment=page=studies,path=study${encodeURIComponent(studyId)}`,
      licenseTerms:
        meta?.licenseTerms ??
        known?.licenseTerms ??
        (licenseMd5Used
          ? 'Accepted Study License Terms (license-md5 verified)'
          : 'Movebank Public / Study Data Terms'),
      licenseMd5Required: meta?.licenseMd5Required ?? Boolean(licenseMd5Used),
    };
  }

  private buildAnimalDossier(
    studyId: string,
    localIdentifier: string,
    scientificName: string,
    rawFixes: RawFixInput[],
    sourceProvider: 'MOVEBANK_PUBLIC' | 'MOVEBANK_DIRECT',
    attribution: StudyAttribution,
    referenceNowMs: number,
  ): AnimalDossier | null {
    const guild: EcologicalGuild = inferGuildFromTaxon(scientificName);
    const id = `mb-${studyId}-${localIdentifier}`
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-');
    const fixes = normalizeTelemetryFixes(id, rawFixes, guild);
    if (fixes.length === 0) return null;

    const latestFix = fixes[fixes.length - 1];
    const kinematics = computeAnimalKinematics(fixes, referenceNowMs);
    const ecology = buildDefaultEcology(scientificName);
    const commonName =
      ecology.wikiUrl && scientificName === 'Phoebastria irrorata'
        ? 'Waved Albatross'
        : scientificName;
    const environment = buildDefaultEnvironment(
      latestFix.lat,
      latestFix.lon,
      latestFix.timestampMs,
      `Movebank Study ${studyId}`,
      guild,
      latestFix.altitudeOrDepthMeters,
      latestFix.externalTempC,
    );

    return {
      id,
      localIdentifier,
      nickname: `${commonName} (${localIdentifier})`,
      scientificName,
      commonName,
      guild,
      sex: 'unknown',
      lifeStage: 'adult',
      massKg: null,
      deploymentStartIso: fixes[0].timestamp,
      feedStatus: 'LIVE_API',
      sourceProvider,
      studyId,
      diagnosticStatus: 'OK',
      colorHex: pickColorHex(id),
      latestFix,
      fixes,
      kinematics,
      ecology,
      environment,
      attribution,
    };
  }

  private parseJsonPayload(
    studyId: string,
    body: string,
    sourceProvider: 'MOVEBANK_PUBLIC' | 'MOVEBANK_DIRECT',
    attribution: StudyAttribution,
    referenceNowMs: number,
  ): AnimalDossier[] {
    const parsed = JSON.parse(body) as
      | { individuals?: MovebankJsonIndividual[] }
      | MovebankJsonIndividual[]
      | Array<Record<string, unknown>>;

    const individuals: MovebankJsonIndividual[] = Array.isArray(parsed)
      ? (parsed as MovebankJsonIndividual[])
      : Array.isArray(parsed?.individuals)
        ? parsed.individuals
        : [];

    const animals: AnimalDossier[] = [];
    for (const ind of individuals) {
      if (!Array.isArray(ind.locations) || ind.locations.length === 0) continue;
      const localId = String(
        ind.individual_local_identifier ?? ind.individual_id ?? 'unknown',
      );
      const sciName = String(ind.individual_taxon_canonical_name ?? 'Unknown species');
      const baseSensor = resolveSensorType(ind.sensor_type_id);

      const rawFixes: RawFixInput[] = [];
      for (const loc of ind.locations) {
        const tsMs = parseMovebankTimestampMs(loc.timestamp);
        const lat = parseOptionalNumber(loc.location_lat);
        const lon = parseOptionalNumber(loc.location_long);
        if (tsMs === null || lat === null || lon === null) continue;

        const speedMs = parseOptionalNumber(loc.ground_speed);
        const alt =
          parseOptionalNumber(loc.height_above_msl) ??
          parseOptionalNumber(loc.height_above_ellipsoid);

        rawFixes.push({
          timestampMs: tsMs,
          lat,
          lon,
          altitudeOrDepthMeters: alt,
          groundSpeedKmh: speedMs !== null ? speedMs * 3.6 : null,
          headingDeg: parseOptionalNumber(loc.heading),
          externalTempC: parseOptionalNumber(loc.external_temperature),
          tagVoltage: parseOptionalNumber(loc.tag_voltage),
          argosLc: normalizeArgosLc(loc.argos_lc),
          accuracyRadiusMeters: parseOptionalNumber(loc.argos_error_radius),
          sensorType: loc.sensor_type ? resolveSensorType(loc.sensor_type) : baseSensor,
        });
      }

      const dossier = this.buildAnimalDossier(
        studyId,
        localId,
        sciName,
        rawFixes,
        sourceProvider,
        attribution,
        referenceNowMs,
      );
      if (dossier) animals.push(dossier);
    }

    return animals;
  }

  private parseCsvPayload(
    studyId: string,
    body: string,
    sourceProvider: 'MOVEBANK_PUBLIC' | 'MOVEBANK_DIRECT',
    attribution: StudyAttribution,
    referenceNowMs: number,
  ): AnimalDossier[] {
    const rows = parseCsvRfc4180(body);
    if (rows.length === 0) return [];

    const grouped = new Map<
      string,
      { sciName: string; sensorType: SensorType; rawFixes: RawFixInput[] }
    >();

    for (const row of rows) {
      const tsMs = parseMovebankTimestampMs(
        getField(row, ['timestamp', 'study_local_timestamp']),
      );
      const lat = parseOptionalNumber(
        getField(row, ['location_lat', 'location-lat', 'lat', 'latitude']),
      );
      const lon = parseOptionalNumber(
        getField(row, ['location_long', 'location-long', 'location_lon', 'lon', 'longitude']),
      );
      if (tsMs === null || lat === null || lon === null) continue;

      const localId =
        getField(row, [
          'individual_local_identifier',
          'individual-local-identifier',
          'individual_id',
          'individual-id',
          'tag_local_identifier',
          'tag_id',
        ]) ?? 'individual-1';

      const sciName =
        getField(row, [
          'individual_taxon_canonical_name',
          'individual-taxon-canonical-name',
          'taxon_canonical_name',
        ]) ?? 'Unknown species';

      const sensorType = resolveSensorType(
        getField(row, ['sensor_type', 'sensor-type', 'sensor_type_id']),
      );

      const speedMs = parseOptionalNumber(
        getField(row, ['ground_speed', 'ground-speed']),
      );
      const rawDepth = parseOptionalNumber(getField(row, ['depth']));
      const rawAlt =
        parseOptionalNumber(
          getField(row, [
            'height_above_msl',
            'height-above-msl',
            'height_above_ellipsoid',
            'height-above-ellipsoid',
            'altitude',
          ]),
        ) ?? (rawDepth !== null ? (rawDepth === 0 ? 0 : -Math.abs(rawDepth)) : null);

      const bucket = grouped.get(localId) ?? {
        sciName,
        sensorType,
        rawFixes: [],
      };
      bucket.rawFixes.push({
        timestampMs: tsMs,
        lat,
        lon,
        altitudeOrDepthMeters: rawAlt,
        groundSpeedKmh: speedMs !== null ? speedMs * 3.6 : null,
        headingDeg: parseOptionalNumber(getField(row, ['heading'])),
        externalTempC: parseOptionalNumber(
          getField(row, ['external_temperature', 'external-temperature']),
        ),
        tagVoltage: parseOptionalNumber(
          getField(row, ['tag_voltage', 'tag-voltage', 'battery_voltage']),
        ),
        argosLc: normalizeArgosLc(getField(row, ['argos_lc', 'argos-lc', 'location_class'])),
        accuracyRadiusMeters: parseOptionalNumber(
          getField(row, ['argos_error_radius', 'eobs_horizontal_accuracy_estimate']),
        ),
        sensorType,
      });
      grouped.set(localId, bucket);
    }

    const animals: AnimalDossier[] = [];
    for (const [localId, bucket] of grouped.entries()) {
      const dossier = this.buildAnimalDossier(
        studyId,
        localId,
        bucket.sciName,
        bucket.rawFixes,
        sourceProvider,
        attribution,
        referenceNowMs,
      );
      if (dossier) animals.push(dossier);
    }
    return animals;
  }

  public async fetchStudy(
    studyIdRaw: string,
    options?: FetchStudyOptions,
  ): Promise<StudyImportResponse> {
    const studyId = studyIdRaw.trim();
    const referenceNowMs = options?.referenceNowMs ?? Date.now();
    const maxEvents = options?.maxEventsPerIndividual ?? this.defaultMaxEvents;
    const sensorType = options?.sensorType ?? 'gps';
    const hasAuth = this.isAuthConfigured();
    const useDirectRead =
      !options?.preferPublicJson &&
      Boolean(hasAuth || options?.preferDirectRead || options?.licenseMd5);

    const params = new URLSearchParams();
    let url: string;
    const sourceProvider = useDirectRead ? 'MOVEBANK_DIRECT' : 'MOVEBANK_PUBLIC';

    if (useDirectRead) {
      params.set('entity_type', 'event');
      params.set('study_id', studyId);
      params.set('max_events_per_individual', String(maxEvents));
      if (options?.individualLocalIdentifiers && options.individualLocalIdentifiers.length > 0) {
        params.set('individual_local_identifier', options.individualLocalIdentifiers.join(','));
      }
      if (options?.licenseMd5) {
        params.set('license-md5', options.licenseMd5.trim());
      }
      url = `${this.baseUrl}/direct-read?${params.toString()}`;
    } else {
      params.set('study_id', studyId);
      if (options?.individualLocalIdentifiers && options.individualLocalIdentifiers.length > 0) {
        for (const ident of options.individualLocalIdentifiers) {
          params.append('individual_local_identifiers', ident);
        }
      }
      params.set('sensor_type', sensorType);
      params.set('max_events_per_individual', String(maxEvents));
      url = `${this.baseUrl}/public/json?${params.toString()}`;
    }

    const queueKey = `mb:${sourceProvider}:${studyId}:${options?.licenseMd5 ?? ''}:${options?.individualLocalIdentifiers?.join(',') ?? ''}:${sensorType}:${maxEvents}`;

    let status: number;
    let body: string;
    try {
      const result = await this.queuedFetchText(
        queueKey,
        url,
        this.buildAuthHeaders(studyId),
        studyId,
      );
      status = result.status;
      body = result.body;
    } catch (err) {
      if (err instanceof RetryableUpstreamError) {
        return {
          studyId,
          diagnosticStatus: 'RATE_LIMITED',
          feedStatus: 'LIVE_API',
          animals: [],
          licenseTermsText: null,
          licenseMd5: null,
          message: `Movebank upstream throttled request (${err.status}). Retry shortly.`,
        };
      }
      throw err;
    }

    if (status === 429 || status === 503 || looksLikeRateLimitBody(body)) {
      return {
        studyId,
        diagnosticStatus: 'RATE_LIMITED',
        feedStatus: 'LIVE_API',
        animals: [],
        licenseTermsText: null,
        licenseMd5: null,
        message: 'Movebank upstream returned HTTP 429 rate-limit response.',
      };
    }

    if (status === 401) {
      return {
        studyId,
        diagnosticStatus: 'AUTH_REQUIRED',
        feedStatus: 'LIVE_API',
        animals: [],
        licenseTermsText: null,
        licenseMd5: null,
        message:
          'Movebank study requires authenticated Direct-Read credentials (MOVEBANK_USERNAME / MOVEBANK_PASSWORD).',
      };
    }

    if (status === 403) {
      if (looksLikeLicenseChallenge(body, 403)) {
        const licenseMd5 = computeLicenseMd5(body);
        return {
          studyId,
          diagnosticStatus: 'LICENSE_REQUIRED',
          feedStatus: 'LIVE_API',
          animals: [],
          licenseTermsText: body,
          licenseMd5,
          message: `Movebank study ${studyId} requires acceptance of study license terms.`,
        };
      }
      return {
        studyId,
        diagnosticStatus: 'AUTH_REQUIRED',
        feedStatus: 'LIVE_API',
        animals: [],
        licenseTermsText: null,
        licenseMd5: null,
        message: `Access forbidden (HTTP 403) for Movebank study ${studyId}. Check study permissions or credentials.`,
      };
    }

    if (status < 200 || status >= 300) {
      return {
        studyId,
        diagnosticStatus: 'TAG_SILENT',
        feedStatus: 'LIVE_API',
        animals: [],
        licenseTermsText: null,
        licenseMd5: null,
        message: `Movebank returned HTTP ${status} for study ${studyId}.`,
      };
    }

    const trimmed = body.trim();
    if (trimmed.length === 0) {
      return {
        studyId,
        diagnosticStatus: 'TAG_SILENT',
        feedStatus: 'LIVE_API',
        animals: [],
        licenseTermsText: null,
        licenseMd5: null,
        message: `Study ${studyId} returned zero telemetry events (TAG_SILENT).`,
      };
    }

    const firstLine = trimmed.split(/\r?\n/)[0] ?? '';
    const isJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    const isCsv = !isJson && isMovebankCsvHeader(firstLine);

    if (!isJson && !isCsv) {
      if (looksLikeTomcatOrAuthDenial(body)) {
        return {
          studyId,
          diagnosticStatus: 'AUTH_REQUIRED',
          feedStatus: 'LIVE_API',
          animals: [],
          licenseTermsText: null,
          licenseMd5: null,
          message: `Authentication required for Movebank study ${studyId}.`,
        };
      }
      if (looksLikeLicenseChallenge(body, status)) {
        const licenseMd5 = computeLicenseMd5(body);
        return {
          studyId,
          diagnosticStatus: 'LICENSE_REQUIRED',
          feedStatus: 'LIVE_API',
          animals: [],
          licenseTermsText: body,
          licenseMd5,
          message: `Movebank study ${studyId} requires acceptance of license terms before data download.`,
        };
      }
    }

    const studyMeta =
      options?.includeStudyMetadata && hasAuth
        ? await this.fetchStudyMetadata(studyId, options?.licenseMd5)
        : null;
    const attribution = this.buildAttribution(studyId, studyMeta, Boolean(options?.licenseMd5));

    let animals: AnimalDossier[] = [];
    if (isJson) {
      try {
        animals = this.parseJsonPayload(
          studyId,
          trimmed,
          sourceProvider,
          attribution,
          referenceNowMs,
        );
      } catch {
        animals = [];
      }
    } else if (isCsv) {
      animals = this.parseCsvPayload(
        studyId,
        body,
        sourceProvider,
        attribution,
        referenceNowMs,
      );
    }

    const diagnosticStatus: DiagnosticStatus = animals.length > 0 ? 'OK' : 'TAG_SILENT';

    return {
      studyId,
      diagnosticStatus,
      feedStatus: 'LIVE_API',
      animals,
      licenseTermsText: studyMeta?.licenseTerms ?? null,
      licenseMd5: options?.licenseMd5 ?? null,
      message:
        animals.length > 0
          ? `Loaded ${animals.length} tracked individual(s) from Movebank study ${studyId}.`
          : `Study ${studyId} is accessible but currently contains 0 event coordinates (TAG_SILENT).`,
    };
  }

  public async fetchFeaturedStudy(referenceNowMs?: number): Promise<StudyImportResponse> {
    return this.fetchStudy(FEATURED_MOVEBANK_STUDY_ID, {
      individualLocalIdentifiers: [FEATURED_MOVEBANK_INDIVIDUAL],
      sensorType: 'gps',
      maxEventsPerIndividual: 140,
      preferPublicJson: true,
      referenceNowMs,
    });
  }
}
