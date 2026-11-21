import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AnimalDossier,
  ArgosLocationClass,
  EcologicalGuild,
  FleetResponse,
  IucnStatus,
  SensorType,
} from '../src/types/telemetry.ts';
import {
  argosAccuracyMeters,
  buildDefaultEnvironment,
  computeAnimalKinematics,
  normalizeLongitude,
  normalizeTelemetryFixes,
  shortestDeltaLonDeg,
  type RawFixInput,
} from '../server/kinematics.ts';

const FIXES_PER_ANIMAL = 150;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface Waypoint {
  lat: number;
  lon: number;
  altOrDepth: number;
}

interface SeedAnimalSpec {
  id: string;
  localIdentifier: string;
  nickname: string;
  scientificName: string;
  commonName: string;
  guild: EcologicalGuild;
  sex: string;
  lifeStage: string;
  massKg: number;
  colorHex: string;
  sensorType: SensorType;
  studyId: string;
  studyTitle: string;
  principalInvestigators: string;
  institution: string;
  studyUrl: string;
  licenseTerms: string;
  regionLabel: string;
  iucnStatus: IucnStatus;
  taxonomy: AnimalDossier['ecology']['taxonomy'];
  photoUrl: string;
  photoAttribution: string;
  wikiUrl: string;
  summaryExtract: string;
  latestOffsetMs: number;
  stepHours: number;
  baseTempC: number;
  tempSpanC: number;
  waypoints: Waypoint[];
  minExtremeAltOrDepth?: { index: number; value: number };
  maxExtremeAltOrDepth?: { index: number; value: number };
  minAltBound?: number;
  maxAltBound?: number;
  altWaveAmp?: number;
  pinnedCoords?: Array<{ index: number; lat: number; lon: number }>;
  diurnalMode: 'diurnal' | 'nocturnal' | 'continuous';
}

function createRng(seedStr: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    state ^= seedStr.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Unwraps longitudes relative to the preceding waypoint along shortest longitudinal arcs
 * so Catmull-Rom / geodesic spline interpolation never jumps across ±180°.
 */
function unwrapWaypoints(waypoints: Waypoint[]): Array<Waypoint & { unwrappedLon: number }> {
  const result: Array<Waypoint & { unwrappedLon: number }> = [];
  let prevLon = waypoints[0].lon;
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const delta = i === 0 ? 0 : shortestDeltaLonDeg(prevLon, wp.lon);
    const unwrappedLon = i === 0 ? wp.lon : result[i - 1].unwrappedLon + delta;
    result.push({ ...wp, unwrappedLon });
    prevLon = wp.lon;
  }
  return result;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function sampleSplinePoint(
  unwrapped: Array<Waypoint & { unwrappedLon: number }>,
  progress: number,
): { lat: number; lon: number; altOrDepth: number } {
  const n = unwrapped.length;
  const scaled = Math.max(0, Math.min(n - 1, progress * (n - 1)));
  const seg = Math.min(n - 2, Math.floor(scaled));
  const t = scaled - seg;

  const p0 = unwrapped[Math.max(0, seg - 1)];
  const p1 = unwrapped[seg];
  const p2 = unwrapped[Math.min(n - 1, seg + 1)];
  const p3 = unwrapped[Math.min(n - 1, seg + 2)];

  const lat = Math.max(-85, Math.min(85, catmullRom(p0.lat, p1.lat, p2.lat, p3.lat, t)));
  const lon = normalizeLongitude(
    catmullRom(p0.unwrappedLon, p1.unwrappedLon, p2.unwrappedLon, p3.unwrappedLon, t),
  );
  const altOrDepth = catmullRom(p0.altOrDepth, p1.altOrDepth, p2.altOrDepth, p3.altOrDepth, t);

  return { lat, lon, altOrDepth };
}

function pickArgosLc(sensorType: SensorType, rand: () => number): ArgosLocationClass {
  if (sensorType === 'GPS-GSM') return 'G';
  const r = rand();
  if (r < 0.28) return '3';
  if (r < 0.54) return '2';
  if (r < 0.76) return '1';
  if (r < 0.90) return '0';
  if (r < 0.97) return 'A';
  return 'B';
}

const SEED_SPECS: SeedAnimalSpec[] = [
  {
    id: 'luna-01',
    localIdentifier: 'LUNA-GW-01',
    nickname: 'Luna (White Shark)',
    scientificName: 'Carcharodon carcharias',
    commonName: 'Great White Shark',
    guild: 'MARINE',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 1180,
    colorHex: '#38bdf8',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-NE-PACIFIC-SHARKS',
    studyTitle: 'Northeast Pacific White Shark Offshore Foraging Corridor',
    principalInvestigators: 'Dr. Barbara Block, Dr. Salvador Jorgensen',
    institution: 'Stanford Hopkins Marine Station / Monterey Bay Aquarium',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'White Shark Café, Northeast Pacific',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Chondrichthyes',
      order: 'Lamniformes',
      family: 'Lamnidae',
      genus: 'Carcharodon',
      species: 'carcharias',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/56/White_shark.jpg/330px-White_shark.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Terry Goss',
    wikiUrl: 'https://en.wikipedia.org/wiki/Great_white_shark',
    summaryExtract:
      'Apex pelagic lamnid shark performing seasonal trans-oceanic migrations between coastal pinniped rookeries and the oligotrophic North Pacific White Shark Café.',
    latestOffsetMs: 2 * HOUR_MS,
    stepHours: 4.5,
    baseTempC: 16.5,
    tempSpanC: 11.0,
    diurnalMode: 'nocturnal',
    waypoints: [
      { lat: 29.02, lon: -118.31, altOrDepth: -18 },
      { lat: 27.95, lon: -120.85, altOrDepth: -85 },
      { lat: 26.40, lon: -124.40, altOrDepth: -240 },
      { lat: 24.85, lon: -128.90, altOrDepth: -410 },
      { lat: 23.60, lon: -133.60, altOrDepth: -620 },
      { lat: 24.25, lon: -135.45, altOrDepth: -510 },
      { lat: 25.15, lon: -134.10, altOrDepth: -140 },
      { lat: 24.45, lon: -131.80, altOrDepth: -320 },
    ],
    minExtremeAltOrDepth: { index: 92, value: -620 },
    minAltBound: -620,
    maxAltBound: -4,
  },
  {
    id: 'kalani-7',
    localIdentifier: 'KALANI-DC-07',
    nickname: 'Kalani (Leatherback)',
    scientificName: 'Dermochelys coriacea',
    commonName: 'Leatherback Sea Turtle',
    guild: 'REPTILE',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 420,
    colorHex: '#2dd4bf',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-PACIFIC-LEATHERBACK',
    studyTitle: 'Western-Central Pacific Leatherback Trans-Meridian Migration',
    principalInvestigators: 'Dr. Scott Benson, Dr. George Shillinger',
    institution: 'NOAA Southwest Fisheries Science Center / Upwell',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Equatorial Central Pacific (±180° Meridian)',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Reptilia',
      order: 'Testudines',
      family: 'Dermochelyidae',
      genus: 'Dermochelys',
      species: 'coriacea',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fc/Leatherback_sea_turtle_Tinglar%2C_USVI_%285839996547%29.jpg/330px-Leatherback_sea_turtle_Tinglar%2C_USVI_%285839996547%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / USVI',
    wikiUrl: 'https://en.wikipedia.org/wiki/Leatherback_sea_turtle',
    summaryExtract:
      'Deep-diving pelagic sea turtle crossing the Pacific antimeridian while tracking mesopelagic gelatinous zooplankton layers down to bathypelagic depths.',
    latestOffsetMs: 4.5 * HOUR_MS,
    stepHours: 6,
    baseTempC: 25.0,
    tempSpanC: 19.5,
    diurnalMode: 'continuous',
    waypoints: [
      { lat: -11.80, lon: 175.40, altOrDepth: -25 },
      { lat: -12.45, lon: 177.20, altOrDepth: -180 },
      { lat: -13.10, lon: 178.75, altOrDepth: -490 },
      { lat: -13.65, lon: 179.60, altOrDepth: -940 },
      { lat: -13.95, lon: -179.40, altOrDepth: -720 },
      { lat: -14.55, lon: -177.65, altOrDepth: -310 },
      { lat: -15.20, lon: -175.40, altOrDepth: -85 },
      { lat: -15.85, lon: -173.80, altOrDepth: -45 },
    ],
    minExtremeAltOrDepth: { index: 74, value: -940 },
    minAltBound: -940,
    maxAltBound: -2,
    pinnedCoords: [
      { index: 73, lat: -13.38, lon: 179.15 },
      { index: 74, lat: -13.65, lon: 179.6 },
      { index: 75, lat: -13.95, lon: -179.4 },
      { index: 76, lat: -14.22, lon: -178.75 },
    ],
  },
  {
    id: 'aurora-h4',
    localIdentifier: 'AURORA-MN-H4',
    nickname: 'Aurora (Humpback Whale)',
    scientificName: 'Megaptera novaeangliae',
    commonName: 'Humpback Whale',
    guild: 'MARINE',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 29500,
    colorHex: '#60a5fa',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-ALASKA-HAWAII-WHALES',
    studyTitle: 'North Pacific Humpback Whale Breeding Corridor Telemetry',
    principalInvestigators: 'Dr. Ari Friedlaender, Dr. Bruce Mate',
    institution: 'UC Santa Cruz / Oregon State Marine Mammal Institute',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'North Pacific Pelagic Corridor',
    iucnStatus: 'LC',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Artiodactyla',
      family: 'Balaenopteridae',
      genus: 'Megaptera',
      species: 'novaeangliae',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d7/Humpback_whale_breaching_off_Cabo_San_Lucas.jpg/330px-Humpback_whale_breaching_off_Cabo_San_Lucas.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Humpback_whale',
    summaryExtract:
      'Long-distance baleen cetacean migrating thousands of kilometers across open North Pacific waters between high-latitude krill feeding grounds and Hawaiian calving basins.',
    latestOffsetMs: 2.5 * DAY_MS,
    stepHours: 4.5,
    baseTempC: 15.0,
    tempSpanC: 9.5,
    diurnalMode: 'continuous',
    minAltBound: -280,
    maxAltBound: -4,
    waypoints: [
      { lat: 55.60, lon: -137.40, altOrDepth: -35 },
      { lat: 50.20, lon: -140.80, altOrDepth: -140 },
      { lat: 43.80, lon: -144.60, altOrDepth: -260 },
      { lat: 37.10, lon: -148.20, altOrDepth: -180 },
      { lat: 30.60, lon: -151.90, altOrDepth: -90 },
      { lat: 24.90, lon: -154.70, altOrDepth: -210 },
      { lat: 21.15, lon: -156.55, altOrDepth: -45 },
    ],
  },
  {
    id: 'bridger-12',
    localIdentifier: 'BRIDGER-AC-12',
    nickname: 'Bridger (Golden Eagle)',
    scientificName: 'Aquila chrysaetos',
    commonName: 'Golden Eagle',
    guild: 'AVIAN',
    sex: 'male',
    lifeStage: 'adult',
    massKg: 4.4,
    colorHex: '#fbbf24',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-ROCKY-MOUNTAIN-RAPTORS',
    studyTitle: 'Rocky Mountain Front Thermal Soaring & Ridge Migration',
    principalInvestigators: 'Dr. Todd Katzner, Dr. Brian Millsap',
    institution: 'USGS Forest & Rangeland Ecosystem Science Center',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Greater Yellowstone & Wind River Range, WY/MT',
    iucnStatus: 'LC',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Accipitriformes',
      family: 'Accipitridae',
      genus: 'Aquila',
      species: 'chrysaetos',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cc/015_Wild_Golden_Eagle_in_flight_at_Pfyn-Finges_%28Switzerland%29_Photo_by_Giles_Laurent.jpg/330px-015_Wild_Golden_Eagle_in_flight_at_Pfyn-Finges_%28Switzerland%29_Photo_by_Giles_Laurent.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Giles Laurent',
    wikiUrl: 'https://en.wikipedia.org/wiki/Golden_eagle',
    summaryExtract:
      'Soaring alpine raptor exploiting orographic updrafts and midday mountain thermals along the Continental Divide at altitudes exceeding 3,800 meters.',
    latestOffsetMs: 8 * HOUR_MS,
    stepHours: 2.5,
    baseTempC: 9.0,
    tempSpanC: 14.0,
    diurnalMode: 'diurnal',
    waypoints: [
      { lat: 45.82, lon: -110.92, altOrDepth: 2150 },
      { lat: 45.18, lon: -110.15, altOrDepth: 2980 },
      { lat: 44.32, lon: -109.78, altOrDepth: 3420 },
      { lat: 43.25, lon: -109.62, altOrDepth: 3850 },
      { lat: 42.10, lon: -109.95, altOrDepth: 2740 },
      { lat: 40.92, lon: -110.42, altOrDepth: 3180 },
    ],
    maxExtremeAltOrDepth: { index: 88, value: 3850 },
    minAltBound: 1400,
    maxAltBound: 3850,
  },
  {
    id: 'adenauer-88',
    localIdentifier: 'ADENAUER-CC-88',
    nickname: 'Adenauer (White Stork)',
    scientificName: 'Ciconia ciconia',
    commonName: 'White Stork',
    guild: 'AVIAN',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 3.4,
    colorHex: '#f59e0b',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-EURASIAN-STORK-FLYWAY',
    studyTitle: 'Eastern European-Nile Thermal Soaring Flyway Project',
    principalInvestigators: 'Prof. Martin Wikelski, Dr. Andrea Flack',
    institution: 'Max Planck Institute of Animal Behavior',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Bosphorus & Eastern Mediterranean Flyway',
    iucnStatus: 'LC',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Ciconiiformes',
      family: 'Ciconiidae',
      genus: 'Ciconia',
      species: 'ciconia',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/13/White_stork_%28Ciconia_ciconia%29_Bia%C5%82owieza.jpg/330px-White_stork_%28Ciconia_ciconia%29_Bia%C5%82owieza.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Białowieża',
    wikiUrl: 'https://en.wikipedia.org/wiki/White_stork',
    summaryExtract:
      'Obligate thermal-soaring long-distance migrant funneling over the Bosphorus Strait and Levantine corridor toward African wintering grounds.',
    latestOffsetMs: 4.0 * DAY_MS,
    stepHours: 3.5,
    baseTempC: 19.5,
    tempSpanC: 10.5,
    diurnalMode: 'diurnal',
    waypoints: [
      { lat: 51.75, lon: 13.45, altOrDepth: 320 },
      { lat: 47.40, lon: 18.85, altOrDepth: 950 },
      { lat: 42.65, lon: 26.55, altOrDepth: 1480 },
      { lat: 41.15, lon: 29.06, altOrDepth: 1120 },
      { lat: 37.85, lon: 34.45, altOrDepth: 1960 },
      { lat: 32.60, lon: 35.52, altOrDepth: 1240 },
      { lat: 27.35, lon: 31.18, altOrDepth: 480 },
    ],
  },
  {
    id: 'erebus-03',
    localIdentifier: 'EREBUS-DE-03',
    nickname: 'Erebus (Wandering Albatross)',
    scientificName: 'Diomedea exulans',
    commonName: 'Wandering Albatross',
    guild: 'AVIAN',
    sex: 'male',
    lifeStage: 'adult',
    massKg: 9.2,
    colorHex: '#f472b6',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-SOUTHERN-OCEAN-ALBATROSS',
    studyTitle: 'Sub-Antarctic Dynamic Soaring Across the Southern Ocean',
    principalInvestigators: 'Dr. Henri Weimerskirch, Dr. Samantha Patrick',
    institution: 'CNRS Centre d’Études Biologiques de Chizé',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Campbell Plateau & Furious Fifties (±180°)',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Procellariiformes',
      family: 'Diomedeidae',
      genus: 'Diomedea',
      species: 'exulans',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/Diomedea_exulans_-_SE_Tasmania.jpg/330px-Diomedea_exulans_-_SE_Tasmania.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / SE Tasmania',
    wikiUrl: 'https://en.wikipedia.org/wiki/Snowy_albatross',
    summaryExtract:
      'Circumpolar dynamic-soaring procellariid harvesting Southern Ocean wind shear gradients while crossing the ±180° meridian in roaring gale corridors.',
    latestOffsetMs: 13 * HOUR_MS,
    stepHours: 3.0,
    baseTempC: 6.2,
    tempSpanC: 4.5,
    diurnalMode: 'continuous',
    minAltBound: 4,
    maxAltBound: 85,
    altWaveAmp: 18,
    waypoints: [
      { lat: -52.55, lon: 169.15, altOrDepth: 18 },
      { lat: -54.10, lon: 174.40, altOrDepth: 42 },
      { lat: -55.45, lon: 179.30, altOrDepth: 64 },
      { lat: -56.05, lon: -178.90, altOrDepth: 78 },
      { lat: -55.30, lon: -174.10, altOrDepth: 35 },
      { lat: -56.20, lon: -177.50, altOrDepth: 54 },
      { lat: -56.85, lon: 178.40, altOrDepth: 28 },
    ],
  },
  {
    id: 'wapiti-09f',
    localIdentifier: 'WAPITI-CL-09F',
    nickname: 'Wapiti 09F (Gray Wolf)',
    scientificName: 'Canis lupus',
    commonName: 'Gray Wolf',
    guild: 'TERRESTRIAL',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 43,
    colorHex: '#a78bfa',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-YELLOWSTONE-CANIDS',
    studyTitle: 'Greater Yellowstone Ecosystem Pack Territoriality & Winter Movements',
    principalInvestigators: 'Dr. Douglas Smith, Dr. Daniel Stahler',
    institution: 'Yellowstone Wolf Project / National Park Service',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Lamar Valley & Mirror Plateau, Yellowstone',
    iucnStatus: 'LC',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Carnivora',
      family: 'Canidae',
      genus: 'Canis',
      species: 'lupus',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/Eurasian_wolf_2.jpg/330px-Eurasian_wolf_2.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Wolf',
    summaryExtract:
      'Territorial apex pack carnivore patrolling alpine benches, riparian elk winter ranges, and ridgeline travel corridors in Yellowstone National Park.',
    latestOffsetMs: 19 * HOUR_MS,
    stepHours: 2.0,
    baseTempC: 3.5,
    tempSpanC: 11.0,
    diurnalMode: 'nocturnal',
    waypoints: [
      { lat: 44.89, lon: -110.22, altOrDepth: 2020 },
      { lat: 44.81, lon: -110.09, altOrDepth: 2340 },
      { lat: 44.68, lon: -110.14, altOrDepth: 2690 },
      { lat: 44.73, lon: -110.34, altOrDepth: 2450 },
      { lat: 44.84, lon: -110.41, altOrDepth: 2110 },
      { lat: 44.91, lon: -110.27, altOrDepth: 1960 },
    ],
  },
  {
    id: 'tsavo-matriarch',
    localIdentifier: 'TSAVO-LA-04',
    nickname: 'Tsavo Matriarch (Elephant)',
    scientificName: 'Loxodonta africana',
    commonName: 'African Savanna Elephant',
    guild: 'TERRESTRIAL',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 3850,
    colorHex: '#34d399',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-TSAVO-CORRIDORS',
    studyTitle: 'Tsavo-Amboseli Landscape Connectivity & Waterhole Foraging',
    principalInvestigators: 'Dr. Iain Douglas-Hamilton, Dr. Jake Wall',
    institution: 'Save the Elephants / Kenya Wildlife Service',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Tsavo–Chyulu Corridor, Southern Kenya',
    iucnStatus: 'EN',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Proboscidea',
      family: 'Elephantidae',
      genus: 'Loxodonta',
      species: 'africana',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/94/178_Male_African_bush_elephant_in_Etosha_National_Park_Photo_by_Giles_Laurent.jpg/330px-178_Male_African_bush_elephant_in_Etosha_National_Park_Photo_by_Giles_Laurent.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Giles Laurent',
    wikiUrl: 'https://en.wikipedia.org/wiki/African_bush_elephant',
    summaryExtract:
      'Endangered keystone megaherbivore matriarch navigating seasonal savanna wildlife corridors between perennial riverine oases and Chyulu volcanic woodlands.',
    latestOffsetMs: 5.5 * DAY_MS,
    stepHours: 3.0,
    baseTempC: 27.5,
    tempSpanC: 9.0,
    diurnalMode: 'diurnal',
    waypoints: [
      { lat: -2.95, lon: 38.44, altOrDepth: 460 },
      { lat: -2.84, lon: 38.18, altOrDepth: 620 },
      { lat: -2.72, lon: 37.86, altOrDepth: 910 },
      { lat: -2.65, lon: 37.54, altOrDepth: 1080 },
      { lat: -2.74, lon: 37.38, altOrDepth: 1120 },
      { lat: -2.81, lon: 37.65, altOrDepth: 840 },
    ],
  },
  {
    id: 'ano-nuevo-44',
    localIdentifier: 'ANO-MA-44',
    nickname: 'Año Nuevo 44 (Elephant Seal)',
    scientificName: 'Mirounga angustirostris',
    commonName: 'Northern Elephant Seal',
    guild: 'MARINE',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 540,
    colorHex: '#22d3ee',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-ANO-NUEVO-SEALS',
    studyTitle: 'Año Nuevo Pelagic Post-Breeding Foraging Dive Study',
    principalInvestigators: 'Dr. Daniel Costa, Dr. Patrick Robinson',
    institution: 'UC Santa Cruz Institute of Marine Sciences',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'North Pacific Transition Zone',
    iucnStatus: 'LC',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Carnivora',
      family: 'Phocidae',
      genus: 'Mirounga',
      species: 'angustirostris',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6c/Mating_scene_with_elevated_Alpha_Male._Elephant_Seals_of_Piedras_Blancas.jpg/330px-Mating_scene_with_elevated_Alpha_Male._Elephant_Seals_of_Piedras_Blancas.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Piedras Blancas',
    wikiUrl: 'https://en.wikipedia.org/wiki/Northern_elephant_seal',
    summaryExtract:
      'Deep-diving pelagic phocid performing continuous mesopelagic foraging dives up to 800m across the North Pacific Subarctic Frontal Zone.',
    latestOffsetMs: 16 * DAY_MS,
    stepHours: 4.5,
    baseTempC: 11.2,
    tempSpanC: 8.5,
    diurnalMode: 'nocturnal',
    waypoints: [
      { lat: 37.12, lon: -122.48, altOrDepth: -35 },
      { lat: 40.40, lon: -129.80, altOrDepth: -410 },
      { lat: 44.80, lon: -139.20, altOrDepth: -780 },
      { lat: 48.20, lon: -149.60, altOrDepth: -650 },
      { lat: 50.10, lon: -158.80, altOrDepth: -820 },
      { lat: 51.35, lon: -165.40, altOrDepth: -480 },
    ],
    minExtremeAltOrDepth: { index: 112, value: -820 },
  },
  {
    id: 'darwin-sc-19',
    localIdentifier: 'DARWIN-CP-19',
    nickname: 'Darwin 19 (Galápagos Tortoise)',
    scientificName: 'Chelonoidis porteri',
    commonName: 'Galápagos Tortoise',
    guild: 'REPTILE',
    sex: 'male',
    lifeStage: 'adult',
    massKg: 215,
    colorHex: '#10b981',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-GALAPAGOS-TORTOISE',
    studyTitle: 'Santa Cruz Highland-Lowland Altitudinal Migration Ecology',
    principalInvestigators: 'Dr. Stephen Blake, Dr. Sharon Deem',
    institution: 'Charles Darwin Foundation / Saint Louis Zoo',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Santa Cruz Island, Galápagos Archipelago',
    iucnStatus: 'CR',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Reptilia',
      order: 'Testudines',
      family: 'Testudinidae',
      genus: 'Chelonoidis',
      species: 'porteri',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f3/Galapagos_Geochelone_nigra_porteri.jpg/330px-Galapagos_Geochelone_nigra_porteri.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Western_Santa_Cruz_tortoise',
    summaryExtract:
      'Critically endangered insular giant tortoise executing seasonal altitudinal migrations along vegetated rainfall gradients on Santa Cruz Island.',
    latestOffsetMs: 21 * DAY_MS,
    stepHours: 6.0,
    baseTempC: 24.5,
    tempSpanC: 6.0,
    diurnalMode: 'diurnal',
    waypoints: [
      { lat: -0.635, lon: -90.376, altOrDepth: 410 },
      { lat: -0.654, lon: -90.366, altOrDepth: 295 },
      { lat: -0.678, lon: -90.352, altOrDepth: 175 },
      { lat: -0.702, lon: -90.338, altOrDepth: 80 },
      { lat: -0.718, lon: -90.324, altOrDepth: 28 },
      { lat: -0.684, lon: -90.348, altOrDepth: 145 },
    ],
  },
];

function buildSeedAnimal(spec: SeedAnimalSpec, referenceNowMs: number): AnimalDossier {
  const rand = createRng(spec.id);
  const unwrapped = unwrapWaypoints(spec.waypoints);
  const latestMs = referenceNowMs - spec.latestOffsetMs;
  const stepMs = spec.stepHours * HOUR_MS;
  const startMs = latestMs - (FIXES_PER_ANIMAL - 1) * stepMs;

  const pinnedMap = new Map<number, { lat: number; lon: number }>();
  if (spec.pinnedCoords) {
    for (const pin of spec.pinnedCoords) {
      pinnedMap.set(pin.index, { lat: pin.lat, lon: pin.lon });
    }
  }

  const rawFixes: RawFixInput[] = [];
  for (let i = 0; i < FIXES_PER_ANIMAL; i++) {
    const progress = i / (FIXES_PER_ANIMAL - 1);
    const baseTimeMs = startMs + i * stepMs;
    const jitterMs =
      i === 0 || i === FIXES_PER_ANIMAL - 1
        ? 0
        : Math.round((rand() - 0.5) * stepMs * 0.14);
    const timestampMs = baseTimeMs + jitterMs;

    const sampled = sampleSplinePoint(unwrapped, progress);
    const hourUtc = new Date(timestampMs).getUTCHours();
    const localHour = (((hourUtc + sampled.lon / 15) % 24) + 24) % 24;

    // Diurnal foraging / resting modulation.
    let activityFactor = 1;
    if (spec.diurnalMode === 'diurnal') {
      activityFactor = localHour >= 6 && localHour <= 18 ? 1.0 : 0.18;
    } else if (spec.diurnalMode === 'nocturnal') {
      activityFactor = localHour < 6 || localHour > 19 ? 1.15 : 0.72;
    }

    const meanderScale = spec.id === 'darwin-sc-19' ? 0.0012 : 0.045;
    const meanderLat =
      Math.sin(i * 0.35 + rand() * 0.4) * meanderScale * activityFactor;
    const meanderLon =
      Math.cos(i * 0.28 + rand() * 0.4) * meanderScale * activityFactor;

    const pinned = pinnedMap.get(i);
    const lat = pinned ? pinned.lat : sampled.lat + meanderLat;
    const lon = pinned
      ? pinned.lon
      : normalizeLongitude(sampled.lon + meanderLon);

    let altOrDepth = sampled.altOrDepth;
    if (spec.guild === 'MARINE' || spec.id === 'kalani-7') {
      const diveCycle = Math.abs(Math.sin(i * 0.42)) * 120 * activityFactor;
      altOrDepth = Math.min(-2, sampled.altOrDepth - diveCycle * 0.35);
      if (
        spec.minExtremeAltOrDepth &&
        i === spec.minExtremeAltOrDepth.index
      ) {
        altOrDepth = spec.minExtremeAltOrDepth.value;
      }
    } else {
      const waveAmp = spec.altWaveAmp ?? (spec.guild === 'AVIAN' ? 180 : 45);
      const altWave = Math.sin(i * 0.32) * waveAmp;
      altOrDepth = Math.max(5, sampled.altOrDepth + altWave);
      if (
        spec.maxExtremeAltOrDepth &&
        i === spec.maxExtremeAltOrDepth.index
      ) {
        altOrDepth = spec.maxExtremeAltOrDepth.value;
      }
    }
    if (spec.minAltBound !== undefined) altOrDepth = Math.max(spec.minAltBound, altOrDepth);
    if (spec.maxAltBound !== undefined) altOrDepth = Math.min(spec.maxAltBound, altOrDepth);

    // Tag battery voltage stays realistically between 3.60V and 4.15V.
    const solarRipple =
      spec.sensorType === 'GPS-GSM' ? Math.max(0, Math.sin((localHour - 6) * (Math.PI / 12))) * 0.08 : 0;
    const rawVoltage = 4.08 - progress * 0.36 + solarRipple + (rand() - 0.5) * 0.03;
    const tagVoltage = Number(Math.max(3.6, Math.min(4.15, rawVoltage)).toFixed(2));

    // Temperature tracks depth/altitude lapse rate.
    let externalTempC = spec.baseTempC;
    if (altOrDepth < 0) {
      const depthRatio = Math.min(1, Math.abs(altOrDepth) / 900);
      externalTempC = spec.baseTempC - depthRatio * spec.tempSpanC + (rand() - 0.5) * 0.8;
    } else {
      const altKm = altOrDepth / 1000;
      const diurnalTemp = Math.sin(((localHour - 8) / 24) * 2 * Math.PI) * 3.5;
      externalTempC = spec.baseTempC - altKm * 5.2 + diurnalTemp + (rand() - 0.5) * 1.1;
    }

    const argosLc = pickArgosLc(spec.sensorType, rand);
    // Keep antimeridian crossing pin points sharp so they never flag as poor-class spikes.
    const finalArgosLc: ArgosLocationClass = pinned ? '3' : argosLc;

    rawFixes.push({
      id: `${spec.id}-fix-${String(i).padStart(4, '0')}`,
      timestampMs,
      lat,
      lon,
      altitudeOrDepthMeters: Number(altOrDepth.toFixed(1)),
      headingDeg: null,
      externalTempC: Number(externalTempC.toFixed(1)),
      tagVoltage,
      argosLc: finalArgosLc,
      accuracyRadiusMeters: argosAccuracyMeters(finalArgosLc),
      sensorType: spec.sensorType,
    });
  }

  const fixes = normalizeTelemetryFixes(spec.id, rawFixes, spec.guild);
  const latestFix = fixes[fixes.length - 1];
  const kinematics = computeAnimalKinematics(fixes, referenceNowMs);
  const environment = buildDefaultEnvironment(
    latestFix.lat,
    latestFix.lon,
    latestFix.timestampMs,
    spec.regionLabel,
    spec.guild,
    latestFix.altitudeOrDepthMeters,
    latestFix.externalTempC,
  );

  return {
    id: spec.id,
    localIdentifier: spec.localIdentifier,
    nickname: spec.nickname,
    scientificName: spec.scientificName,
    commonName: spec.commonName,
    guild: spec.guild,
    sex: spec.sex,
    lifeStage: spec.lifeStage,
    massKg: spec.massKg,
    deploymentStartIso: fixes[0].timestamp,
    feedStatus: 'DEMO_FEED',
    sourceProvider: 'SEED_ARCHIVE',
    studyId: spec.studyId,
    diagnosticStatus: 'OK',
    colorHex: spec.colorHex,
    latestFix,
    fixes,
    kinematics,
    ecology: {
      photoUrl: spec.photoUrl,
      photoAttribution: spec.photoAttribution,
      iucnStatus: spec.iucnStatus,
      taxonomy: spec.taxonomy,
      summaryExtract: spec.summaryExtract,
      wikiUrl: spec.wikiUrl,
      enriched: true,
    },
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

export function generateSeedFleet(referenceNowMs: number = Date.now()): FleetResponse {
  const animals = SEED_SPECS.map((spec) => buildSeedAnimal(spec, referenceNowMs));
  return {
    generatedAt: new Date(referenceNowMs).toISOString(),
    connectionMode: 'STATIC_DECK',
    animals,
    sourceSummary: {
      liveCount: 0,
      cachedCount: 0,
      demoCount: animals.length,
    },
  };
}

async function main(): Promise<void> {
  const outPath = path.resolve(process.cwd(), 'public', 'data', 'fallback-fleet.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const fleet = generateSeedFleet(Date.now());
  await fs.writeFile(outPath, `${JSON.stringify(fleet, null, 2)}\n`, 'utf8');

  const totalFixes = fleet.animals.reduce((acc, a) => acc + a.fixes.length, 0);
  console.log(
    `[seed:generate] Wrote ${fleet.animals.length} animals (${totalFixes} fixes) to ${outPath}`,
  );
}

const isCli =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.includes('generate-seed-fleet');

if (isCli) {
  main().catch((err) => {
    console.error('[seed:generate] Failed:', err);
    process.exitCode = 1;
  });
}
