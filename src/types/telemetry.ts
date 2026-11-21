export type EcologicalGuild = 'AVIAN' | 'MARINE' | 'TERRESTRIAL' | 'REPTILE';

export type FeedStatus = 'LIVE_API' | 'CACHED' | 'DEMO_FEED';

export type SourceProvider =
  | 'MOVEBANK_PUBLIC'
  | 'MOVEBANK_DIRECT'
  | 'IOOS_ATN_ERDDAP'
  | 'SEED_ARCHIVE';

export type DiagnosticStatus =
  | 'OK'
  | 'LICENSE_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'TAG_SILENT'
  | 'RATE_LIMITED';

export type ArgosLocationClass = 'G' | '3' | '2' | '1' | '0' | 'A' | 'B' | 'Z' | null;

export type SensorType =
  | 'GPS-GSM'
  | 'Argos Doppler PTT'
  | 'Solar Geolocation'
  | 'Acoustic / Archival';

export type BasemapId = 'dark-tactical' | 'satellite' | 'terrain' | 'ocean';

export type TrackColorMode = 'speed' | 'altitude' | 'recency' | 'animal';

export type PingRecencyFilter = 'ALL' | 'ACTIVE_24H' | 'LAST_7D' | 'HISTORICAL';

export type SolarPhase = 'Daylight' | 'Civil Twilight' | 'Nautical Twilight' | 'Night';

export type IucnStatus = 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'DD';

export type ConnectionMode = 'PROXY_LIVE' | 'CI_SNAPSHOT' | 'STATIC_DECK';

export interface TelemetryFix {
  id: string;
  timestamp: string;
  timestampMs: number;
  lat: number;
  lon: number;
  /** Positive = meters above terrain/ellipsoid; negative = ocean depth in meters; null = unavailable */
  altitudeOrDepthMeters: number | null;
  groundSpeedKmh: number | null;
  speedIsDerived: boolean;
  headingDeg: number | null;
  externalTempC: number | null;
  tagVoltage: number | null;
  argosLc: ArgosLocationClass;
  accuracyRadiusMeters: number | null;
  sensorType: SensorType;
  segmentDistanceKm: number;
  isOutlierSpike: boolean;
}

export interface DailyDistanceBucket {
  dateIso: string;
  distanceKm: number;
  fixCount: number;
  avgSpeedKmh: number;
}

export interface AnimalKinematics {
  totalDistanceKm: number;
  displacement24hKm: number;
  distance24hKm: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  currentSpeedKmh: number;
  currentBearingDeg: number;
  currentCardinal: string;
  pingFreshnessMs: number;
  pingFreshnessLabel: string;
  daysTracked: number;
  dailyDistanceSeries: DailyDistanceBucket[];
  hasAltitudeOrDepth: boolean;
}

export interface AnimalEcology {
  photoUrl: string | null;
  photoAttribution: string | null;
  iucnStatus: IucnStatus;
  taxonomy: {
    kingdom: string;
    phylum: string;
    class: string;
    order: string;
    family: string;
    genus: string;
    species: string;
  };
  summaryExtract: string;
  wikiUrl: string | null;
  enriched: boolean;
}

export interface AnimalEnvironment {
  airTempC: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  surfacePressureHpa: number | null;
  elevationMeters: number | null;
  seaSurfaceTempC: number | null;
  waveHeightMeters: number | null;
  oceanCurrentKmh: number | null;
  solarPhase: SolarPhase;
  solarElevationDeg: number;
  regionLabel: string;
  fetchedAt: string | null;
}

export interface StudyAttribution {
  studyTitle: string;
  principalInvestigators: string;
  institution: string;
  studyUrl: string;
  licenseTerms: string;
  licenseMd5Required: boolean;
}

export interface AnimalSummary {
  id: string;
  localIdentifier: string;
  nickname: string;
  scientificName: string;
  commonName: string;
  guild: EcologicalGuild;
  sex: string;
  lifeStage: string;
  massKg: number | null;
  deploymentStartIso: string;
  feedStatus: FeedStatus;
  sourceProvider: SourceProvider;
  studyId: string;
  diagnosticStatus: DiagnosticStatus;
  colorHex: string;
}

export interface AnimalDossier extends AnimalSummary {
  latestFix: TelemetryFix;
  fixes: TelemetryFix[];
  kinematics: AnimalKinematics;
  ecology: AnimalEcology;
  environment: AnimalEnvironment;
  attribution: StudyAttribution;
}

export interface InterpolatedAnimalFrame {
  animalId: string;
  nickname: string;
  commonName: string;
  scientificName: string;
  guild: EcologicalGuild;
  feedStatus: FeedStatus;
  colorHex: string;
  lat: number;
  lon: number;
  bearingDeg: number;
  speedKmh: number;
  altitudeOrDepthMeters: number | null;
  accuracyRadiusMeters: number | null;
  argosLc: ArgosLocationClass;
  timestampMs: number;
  activeTrailIndex: number;
}

export interface ProxyHealthResponse {
  status: 'ok';
  movebankAuthConfigured: boolean;
  queueDepth: number;
  cacheEntries: number;
  uptimeSeconds: number;
  timestampIso: string;
}

export interface FleetResponse {
  generatedAt: string;
  connectionMode: ConnectionMode;
  animals: AnimalDossier[];
  sourceSummary: {
    liveCount: number;
    cachedCount: number;
    demoCount: number;
  };
}

export interface StudyImportResponse {
  studyId: string;
  diagnosticStatus: DiagnosticStatus;
  feedStatus: FeedStatus;
  animals: AnimalDossier[];
  licenseTermsText: string | null;
  licenseMd5: string | null;
  message: string;
}
