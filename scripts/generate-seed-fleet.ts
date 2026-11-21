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

const FIXES_PER_ANIMAL = 120;
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
  isDiving?: boolean;
  meanderScale?: number;
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
    studyId: 'DEMO-NW-ATLANTIC-SHARKS',
    studyTitle: 'Northwest Atlantic White Shark Shelf-to-Sargasso Migration',
    principalInvestigators: 'Dr. Gregory Skomal, Dr. Camrin Braun',
    institution: 'Massachusetts Division of Marine Fisheries / WHOI',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Cape Cod Shelf → Sargasso Sea, NW Atlantic',
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
      'Apex pelagic lamnid shark migrating seasonally from Cape Cod seal foraging grounds across the Gulf Stream into warm mesopelagic Sargasso Sea overwintering waters.',
    latestOffsetMs: 2 * HOUR_MS,
    stepHours: 4.5,
    baseTempC: 18.5,
    tempSpanC: 12.0,
    diurnalMode: 'nocturnal',
    isDiving: true,
    waypoints: [
      { lat: 41.60, lon: -69.90, altOrDepth: -14 },
      { lat: 40.35, lon: -69.40, altOrDepth: -65 },
      { lat: 38.20, lon: -68.60, altOrDepth: -280 },
      { lat: 35.60, lon: -67.80, altOrDepth: -480 },
      { lat: 32.90, lon: -66.90, altOrDepth: -620 },
      { lat: 30.80, lon: -65.90, altOrDepth: -410 },
      { lat: 29.40, lon: -65.20, altOrDepth: -190 },
      { lat: 28.40, lon: -64.80, altOrDepth: -95 },
    ],
    minExtremeAltOrDepth: { index: 68, value: -620 },
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
    isDiving: true,
    waypoints: [
      { lat: -11.80, lon: 175.40, altOrDepth: -25 },
      { lat: -12.45, lon: 177.20, altOrDepth: -180 },
      { lat: -13.10, lon: 178.75, altOrDepth: -490 },
      { lat: -13.55, lon: 179.25, altOrDepth: -940 },
      { lat: -14.15, lon: -178.95, altOrDepth: -720 },
      { lat: -14.65, lon: -177.45, altOrDepth: -310 },
      { lat: -15.25, lon: -175.40, altOrDepth: -85 },
      { lat: -15.85, lon: -173.80, altOrDepth: -45 },
    ],
    minExtremeAltOrDepth: { index: 59, value: -940 },
    minAltBound: -940,
    maxAltBound: -2,
    pinnedCoords: [
      { index: 58, lat: -13.52, lon: 179.35 },
      { index: 59, lat: -13.65, lon: 179.6 },
      { index: 60, lat: -13.95, lon: -179.4 },
      { index: 61, lat: -14.08, lon: -179.15 },
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
    maxExtremeAltOrDepth: { index: 71, value: 3850 },
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
    minExtremeAltOrDepth: { index: 95, value: -820 },
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
  // === 17 NEW SPECIES: MARINE (+5) ===
  {
    id: 'blue-titan-02',
    localIdentifier: 'BLUE-BM-02',
    nickname: 'Titan 02 (Blue Whale)',
    scientificName: 'Balaenoptera musculus',
    commonName: 'Blue Whale',
    guild: 'MARINE',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 132000,
    colorHex: '#0ea5e9',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-EAST-PACIFIC-BLUE-WHALES',
    studyTitle: 'Eastern North Pacific Blue Whale Upwelling-to-Dome Corridor',
    principalInvestigators: 'Dr. Bruce Mate, Dr. Ladd Irvine',
    institution: 'Oregon State University Marine Mammal Institute',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Channel Islands CA → Costa Rica Dome',
    iucnStatus: 'EN',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Artiodactyla',
      family: 'Balaenopteridae',
      genus: 'Balaenoptera',
      species: 'musculus',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1c/Anim1754_-_Flickr_-_NOAA_Photo_Library.jpg/330px-Anim1754_-_Flickr_-_NOAA_Photo_Library.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / NOAA Photo Library',
    wikiUrl: 'https://en.wikipedia.org/wiki/Blue_whale',
    summaryExtract:
      'Earth’s largest extant baleen cetacean migrating southward from productive California Current krill swarms to the Equatorial Costa Rica Thermal Dome.',
    latestOffsetMs: 3.5 * HOUR_MS,
    stepHours: 6.0,
    baseTempC: 19.5,
    tempSpanC: 11.0,
    diurnalMode: 'continuous',
    isDiving: true,
    waypoints: [
      { lat: 34.02, lon: -120.15, altOrDepth: -25 },
      { lat: 31.40, lon: -118.20, altOrDepth: -140 },
      { lat: 26.80, lon: -115.40, altOrDepth: -260 },
      { lat: 21.50, lon: -110.20, altOrDepth: -310 },
      { lat: 15.80, lon: -102.40, altOrDepth: -210 },
      { lat: 10.60, lon: -94.20, altOrDepth: -285 },
      { lat: 8.85, lon: -89.80, altOrDepth: -120 },
    ],
    minExtremeAltOrDepth: { index: 59, value: -310 },
    minAltBound: -310,
    maxAltBound: -4,
  },
  {
    id: 'orca-j35-tahlequah',
    localIdentifier: 'ORCA-J35',
    nickname: 'J35 Tahlequah (Orca)',
    scientificName: 'Orcinus orca',
    commonName: 'Killer Whale',
    guild: 'MARINE',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 3600,
    colorHex: '#6366f1',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-SALISH-RESIDENT-ORCAS',
    studyTitle: 'Southern Resident Killer Whale Salish-Shelf Foraging Track',
    principalInvestigators: 'Dr. Brad Hanson, Dr. Deborah Giles',
    institution: 'NOAA Northwest Fisheries Science Center / Wild Orca',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Salish Sea → Vancouver Island Outer Shelf',
    iucnStatus: 'DD',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Artiodactyla',
      family: 'Delphinidae',
      genus: 'Orcinus',
      species: 'orca',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/37/Killerwhales_jumping.jpg/330px-Killerwhales_jumping.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Orca',
    summaryExtract:
      'Matrilineal apex delphinid pursuing Chinook salmon runs from Haro Strait through the Strait of Juan de Fuca along the Vancouver Island continental shelf.',
    latestOffsetMs: 15 * HOUR_MS,
    stepHours: 3.0,
    baseTempC: 10.4,
    tempSpanC: 4.5,
    diurnalMode: 'diurnal',
    isDiving: true,
    meanderScale: 0.015,
    waypoints: [
      { lat: 48.52, lon: -123.16, altOrDepth: -35 },
      { lat: 48.32, lon: -123.95, altOrDepth: -90 },
      { lat: 48.46, lon: -124.95, altOrDepth: -140 },
      { lat: 48.85, lon: -126.10, altOrDepth: -240 },
      { lat: 49.45, lon: -127.15, altOrDepth: -195 },
      { lat: 49.15, lon: -126.55, altOrDepth: -110 },
    ],
    minExtremeAltOrDepth: { index: 71, value: -240 },
    minAltBound: -240,
    maxAltBound: -3,
  },
  {
    id: 'tigris-ningaloo-08',
    localIdentifier: 'TIGRIS-GC-08',
    nickname: 'Ningaloo 08 (Tiger Shark)',
    scientificName: 'Galeocerdo cuvier',
    commonName: 'Tiger Shark',
    guild: 'MARINE',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 580,
    colorHex: '#06b6d4',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-NINGALOO-SHARKS',
    studyTitle: 'Eastern Indian Ocean Tiger Shark Shelf-Break Telemetry',
    principalInvestigators: 'Dr. Luciana Ferreira, Dr. Mark Meekan',
    institution: 'Australian Institute of Marine Science',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Ningaloo Reef → Shark Bay, Western Australia',
    iucnStatus: 'NT',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Chondrichthyes',
      order: 'Carcharhiniformes',
      family: 'Carcharhinidae',
      genus: 'Galeocerdo',
      species: 'cuvier',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/39/Tiger_shark.jpg/330px-Tiger_shark.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Tiger_shark',
    summaryExtract:
      'Apex carcharhinid predator patrolling Ningaloo Reef outer drop-offs and Shark Bay seagrass banks across Western Australian shelf waters.',
    latestOffsetMs: 2.2 * DAY_MS,
    stepHours: 4.0,
    baseTempC: 24.8,
    tempSpanC: 9.0,
    diurnalMode: 'nocturnal',
    isDiving: true,
    meanderScale: 0.025,
    waypoints: [
      { lat: -21.95, lon: 113.78, altOrDepth: -18 },
      { lat: -22.75, lon: 113.42, altOrDepth: -120 },
      { lat: -23.85, lon: 112.95, altOrDepth: -290 },
      { lat: -24.95, lon: 112.55, altOrDepth: -380 },
      { lat: -25.75, lon: 112.75, altOrDepth: -165 },
      { lat: -25.55, lon: 113.15, altOrDepth: -24 },
    ],
    minExtremeAltOrDepth: { index: 71, value: -380 },
    minAltBound: -380,
    maxAltBound: -2,
  },
  {
    id: 'narwhal-baffin-14',
    localIdentifier: 'BAFFIN-MM-14',
    nickname: 'Baffin 14 (Narwhal)',
    scientificName: 'Monodon monoceros',
    commonName: 'Narwhal',
    guild: 'MARINE',
    sex: 'male',
    lifeStage: 'adult',
    massKg: 1450,
    colorHex: '#818cf8',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-BAFFIN-NARWHAL',
    studyTitle: 'High Arctic Lancaster Sound–Baffin Bay Winter Abyssal Diving',
    principalInvestigators: 'Dr. Kristin Laidre, Dr. Mads Peter Heide-Jørgensen',
    institution: 'University of Washington / Greenland Institute of Natural Resources',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Lancaster Sound → Baffin Bay, High Arctic',
    iucnStatus: 'LC',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Artiodactyla',
      family: 'Monodontidae',
      genus: 'Monodon',
      species: 'monoceros',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bc/%D0%9D%D0%B0%D1%80%D0%B2%D0%B0%D0%BB_%D0%B2_%D1%80%D0%BE%D1%81%D1%81%D0%B8%D0%B9%D1%81%D0%BA%D0%BE%D0%B9_%D0%90%D1%80%D0%BA%D1%82%D0%B8%D0%BA%D0%B5.jpg/330px-%D0%9D%D0%B0%D1%80%D0%B2%D0%B0%D0%BB_%D0%B2_%D1%80%D0%BE%D1%81%D1%81%D0%B8%D0%B9%D1%81%D0%BA%D0%BE%D0%B9_%D0%90%D1%80%D0%BA%D1%82%D0%B8%D0%BA%D0%B5.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Narwhal',
    summaryExtract:
      'Tusked Arctic monodontid executing extreme winter benthic dives exceeding 1,200 meters beneath dense Baffin Bay pack ice in pursuit of Greenland halibut.',
    latestOffsetMs: 14.5 * DAY_MS,
    stepHours: 5.0,
    baseTempC: -1.4,
    tempSpanC: 1.8,
    diurnalMode: 'continuous',
    isDiving: true,
    waypoints: [
      { lat: 74.18, lon: -83.80, altOrDepth: -180 },
      { lat: 74.12, lon: -78.20, altOrDepth: -420 },
      { lat: 73.40, lon: -72.10, altOrDepth: -860 },
      { lat: 71.80, lon: -66.80, altOrDepth: -1280 },
      { lat: 70.10, lon: -63.40, altOrDepth: -1120 },
      { lat: 68.70, lon: -60.80, altOrDepth: -940 },
    ],
    minExtremeAltOrDepth: { index: 71, value: -1280 },
    minAltBound: -1280,
    maxAltBound: -5,
  },
  {
    id: 'manta-raja-06',
    localIdentifier: 'RAJA-MA-06',
    nickname: 'Raja 06 (Reef Manta)',
    scientificName: 'Mobula alfredi',
    commonName: 'Reef Manta Ray',
    guild: 'MARINE',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 1120,
    colorHex: '#14b8a6',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-CORAL-TRIANGLE-MANTAS',
    studyTitle: 'Raja Ampat–Banda Sea Deep Mesopelagic Manta Telemetry',
    principalInvestigators: 'Dr. Edy Setyawan, Dr. Mark Erdmann',
    institution: 'Elasmobranch Project Indonesia / Conservation International',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Raja Ampat → Banda Sea, Indonesia',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Chondrichthyes',
      order: 'Myliobatiformes',
      family: 'Mobulidae',
      genus: 'Mobula',
      species: 'alfredi',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/30/Dharavandhoo_Thila_-_Manata_Black_Pearl.JPG/330px-Dharavandhoo_Thila_-_Manata_Black_Pearl.JPG?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Reef_manta_ray',
    summaryExtract:
      'Planktivorous Coral Triangle mobulid ray traversing Halmahera and Banda Sea upwellings while executing mesopelagic foraging dives to 430 meters.',
    latestOffsetMs: 4.6 * DAY_MS,
    stepHours: 4.0,
    baseTempC: 28.4,
    tempSpanC: 18.0,
    diurnalMode: 'nocturnal',
    isDiving: true,
    meanderScale: 0.02,
    waypoints: [
      { lat: -1.90, lon: 130.50, altOrDepth: -28 },
      { lat: -2.60, lon: 131.10, altOrDepth: -140 },
      { lat: -4.10, lon: 131.20, altOrDepth: -310 },
      { lat: -4.75, lon: 129.90, altOrDepth: -430 },
      { lat: -5.35, lon: 128.95, altOrDepth: -260 },
      { lat: -5.65, lon: 128.45, altOrDepth: -95 },
    ],
    minExtremeAltOrDepth: { index: 71, value: -430 },
    minAltBound: -430,
    maxAltBound: -2,
  },
  // === 17 NEW SPECIES: AVIAN (+5) ===
  {
    id: 'kuaka-e7',
    localIdentifier: 'KUAKA-E7',
    nickname: 'Kuaka E7 (Bar-tailed Godwit)',
    scientificName: 'Limosa lapponica',
    commonName: 'Bar-tailed Godwit',
    guild: 'AVIAN',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 0.42,
    colorHex: '#facc15',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-PACIFIC-GODWIT-NONSTOP',
    studyTitle: 'Trans-Pacific Non-Stop Alaska–New Zealand Shorebird Migration',
    principalInvestigators: 'Dr. Jesse Conklin, Dr. Phil Battley',
    institution: 'Global Flyway Network / Massey University',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Yukon Delta AK → Firth of Thames NZ (±180°)',
    iucnStatus: 'NT',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Charadriiformes',
      family: 'Scolopacidae',
      genus: 'Limosa',
      species: 'lapponica',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/ca/Bar-tailed_Godwit.jpg/330px-Bar-tailed_Godwit.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Bar-tailed_godwit',
    summaryExtract:
      'Endurance avian record-holder executing an 11,500 km non-stop trans-Pacific flight across the ±180° antimeridian from Alaska tundra to New Zealand estuaries.',
    latestOffsetMs: 5 * HOUR_MS,
    stepHours: 2.0,
    baseTempC: 16.0,
    tempSpanC: 18.0,
    diurnalMode: 'continuous',
    altWaveAmp: 220,
    waypoints: [
      { lat: 61.30, lon: -165.40, altOrDepth: 120 },
      { lat: 52.80, lon: -171.20, altOrDepth: 2150 },
      { lat: 36.40, lon: -176.80, altOrDepth: 3450 },
      { lat: 18.20, lon: 179.50, altOrDepth: 4200 },
      { lat: 1.50, lon: 177.20, altOrDepth: 3100 },
      { lat: -17.80, lon: 175.80, altOrDepth: 2250 },
      { lat: -37.18, lon: 175.32, altOrDepth: 45 },
    ],
    maxExtremeAltOrDepth: { index: 59, value: 4200 },
    minAltBound: 20,
    maxAltBound: 4200,
  },
  {
    id: 'condor-andes-05',
    localIdentifier: 'PATAGONIA-VG-05',
    nickname: 'Aconcagua 05 (Andean Condor)',
    scientificName: 'Vultur gryphus',
    commonName: 'Andean Condor',
    guild: 'AVIAN',
    sex: 'male',
    lifeStage: 'adult',
    massKg: 12.2,
    colorHex: '#fb923c',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-PATAGONIA-CONDOR-THERMALS',
    studyTitle: 'Patagonian Andes Orographic Soaring & Ridge Energetics',
    principalInvestigators: 'Dr. Sergio Lambertucci, Dr. Emily Shepard',
    institution: 'INIBIOMA CONICET / Swansea University',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Patagonian Andes Divide, Argentina/Chile',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Accipitriformes',
      family: 'Cathartidae',
      genus: 'Vultur',
      species: 'gryphus',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b9/AndeanCondorMale.jpg/330px-AndeanCondorMale.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Andean_condor',
    summaryExtract:
      'Broad-winged New World scavenger soaring nearly continuously on Andean ridge updrafts up to 4,950 meters with minimal flapping energy expenditure.',
    latestOffsetMs: 11.5 * HOUR_MS,
    stepHours: 2.0,
    baseTempC: 4.5,
    tempSpanC: 15.0,
    diurnalMode: 'diurnal',
    altWaveAmp: 240,
    waypoints: [
      { lat: -41.15, lon: -71.75, altOrDepth: 2400 },
      { lat: -42.85, lon: -71.90, altOrDepth: 3650 },
      { lat: -45.40, lon: -72.10, altOrDepth: 4320 },
      { lat: -47.25, lon: -72.85, altOrDepth: 4950 },
      { lat: -48.60, lon: -73.05, altOrDepth: 3890 },
      { lat: -49.32, lon: -72.92, altOrDepth: 2680 },
    ],
    maxExtremeAltOrDepth: { index: 71, value: 4950 },
    minAltBound: 900,
    maxAltBound: 4950,
  },
  {
    id: 'arctic-tern-77',
    localIdentifier: 'TERN-SP-77',
    nickname: 'Kría 77 (Arctic Tern)',
    scientificName: 'Sterna paradisaea',
    commonName: 'Arctic Tern',
    guild: 'AVIAN',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 0.11,
    colorHex: '#fde047',
    sensorType: 'Solar Geolocation',
    studyId: 'DEMO-NORTH-ATLANTIC-TERNS',
    studyTitle: 'Iceland–Mid-Atlantic Ridge Pelagic Post-Breeding Flyway',
    principalInvestigators: 'Dr. Carsten Egevang, Dr. Aevar Petersen',
    institution: 'Greenland Institute of Natural Resources / Icelandic Institute',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Iceland → Mid-Atlantic Ridge Flyway',
    iucnStatus: 'LC',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Charadriiformes',
      family: 'Laridae',
      genus: 'Sterna',
      species: 'paradisaea',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fa/Arctic_tern_%28Sterna_paradisaea%29_Flatey_3.jpg/330px-Arctic_tern_%28Sterna_paradisaea%29_Flatey_3.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Flatey',
    wikiUrl: 'https://en.wikipedia.org/wiki/Arctic_tern',
    summaryExtract:
      'Pole-to-pole pelagic seabird riding North Atlantic frontal winds along the Mid-Atlantic Ridge eddy corridor en route toward Southern Ocean pack ice.',
    latestOffsetMs: 3.1 * DAY_MS,
    stepHours: 2.0,
    baseTempC: 11.5,
    tempSpanC: 9.0,
    diurnalMode: 'diurnal',
    altWaveAmp: 65,
    waypoints: [
      { lat: 64.95, lon: -23.70, altOrDepth: 45 },
      { lat: 59.20, lon: -26.80, altOrDepth: 280 },
      { lat: 51.60, lon: -30.20, altOrDepth: 410 },
      { lat: 42.40, lon: -32.40, altOrDepth: 340 },
      { lat: 33.80, lon: -34.10, altOrDepth: 260 },
      { lat: 24.50, lon: -32.60, altOrDepth: 190 },
    ],
    minAltBound: 8,
    maxAltBound: 650,
  },
  {
    id: 'snowy-tundra-11',
    localIdentifier: 'UNGAVA-BS-11',
    nickname: 'Ungava 11 (Snowy Owl)',
    scientificName: 'Bubo scandiacus',
    commonName: 'Snowy Owl',
    guild: 'AVIAN',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 2.15,
    colorHex: '#f8fafc',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-PROJECT-SNOWSTORM',
    studyTitle: 'Ungava–St. Lawrence Valley Winter Irruption Telemetry',
    principalInvestigators: 'Dr. Jean-François Therrien, Scott Weidensaul',
    institution: 'Hawk Mountain Sanctuary / Project SNOWstorm',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Ungava Peninsula → St. Lawrence Valley, QC',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Strigiformes',
      family: 'Strigidae',
      genus: 'Bubo',
      species: 'scandiacus',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f1/SnowyOwlAmericanBlackDuck.jpg/330px-SnowyOwlAmericanBlackDuck.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Snowy_owl',
    summaryExtract:
      'Tundra-breeding arctic strigid dispersing southward across subarctic shield lakes to winter over open St. Lawrence River agricultural plains.',
    latestOffsetMs: 17 * DAY_MS,
    stepHours: 3.5,
    baseTempC: -8.5,
    tempSpanC: 10.0,
    diurnalMode: 'nocturnal',
    altWaveAmp: 85,
    waypoints: [
      { lat: 59.40, lon: -73.80, altOrDepth: 380 },
      { lat: 56.20, lon: -72.10, altOrDepth: 440 },
      { lat: 52.80, lon: -71.40, altOrDepth: 560 },
      { lat: 49.40, lon: -70.60, altOrDepth: 490 },
      { lat: 47.45, lon: -70.35, altOrDepth: 110 },
      { lat: 46.78, lon: -71.15, altOrDepth: 65 },
    ],
    minAltBound: 15,
    maxAltBound: 850,
  },
  {
    id: 'emperor-ross-21',
    localIdentifier: 'ROSS-AF-21',
    nickname: 'Crozier 21 (Emperor Penguin)',
    scientificName: 'Aptenodytes forsteri',
    commonName: 'Emperor Penguin',
    guild: 'AVIAN',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 29.5,
    colorHex: '#38bdf8',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-ROSS-SEA-PENGUINS',
    studyTitle: 'Ross Sea Polynya Deep-Diving Emperor Penguin Foraging',
    principalInvestigators: 'Dr. Gerald Kooyman, Dr. Paul Ponganis',
    institution: 'Scripps Institution of Oceanography',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Ross Sea Polynya, Antarctica',
    iucnStatus: 'NT',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Sphenisciformes',
      family: 'Spheniscidae',
      genus: 'Aptenodytes',
      species: 'forsteri',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a3/Aptenodytes_forsteri_-Snow_Hill_Island%2C_Antarctica_-adults_and_juvenile-8.jpg/330px-Aptenodytes_forsteri_-Snow_Hill_Island%2C_Antarctica_-adults_and_juvenile-8.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Emperor_penguin',
    summaryExtract:
      'Deepest-diving avian predator foraging beneath Antarctic sea-ice leads in the Ross Sea polynya to depths of 480 meters for Antarctic silverfish and krill.',
    latestOffsetMs: 24 * DAY_MS,
    stepHours: 3.5,
    baseTempC: -1.8,
    tempSpanC: 1.5,
    diurnalMode: 'diurnal',
    isDiving: true,
    meanderScale: 0.025,
    waypoints: [
      { lat: -77.45, lon: 169.35, altOrDepth: -25 },
      { lat: -76.30, lon: 172.10, altOrDepth: -210 },
      { lat: -75.10, lon: 174.80, altOrDepth: -480 },
      { lat: -74.05, lon: 176.40, altOrDepth: -340 },
      { lat: -73.40, lon: 175.10, altOrDepth: -195 },
      { lat: -74.60, lon: 173.20, altOrDepth: -90 },
    ],
    minExtremeAltOrDepth: { index: 47, value: -480 },
    minAltBound: -480,
    maxAltBound: -1,
  },
  // === 17 NEW SPECIES: TERRESTRIAL MAMMALS (+5) ===
  {
    id: 'nanook-svalbard-04',
    localIdentifier: 'NANOOK-UM-04',
    nickname: 'Nanook 04 (Polar Bear)',
    scientificName: 'Ursus maritimus',
    commonName: 'Polar Bear',
    guild: 'TERRESTRIAL',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 245,
    colorHex: '#e2e8f0',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-SVALBARD-SEA-ICE',
    studyTitle: 'Svalbard & Barents Sea Drift-Ice Polar Bear Ecology',
    principalInvestigators: 'Dr. Jon Aars, Dr. Magnus Andersen',
    institution: 'Norwegian Polar Institute',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Svalbard & Barents Sea Drift-Ice',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Carnivora',
      family: 'Ursidae',
      genus: 'Ursus',
      species: 'maritimus',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/66/Polar_Bear_-_Alaska_%28cropped%29.jpg/330px-Polar_Bear_-_Alaska_%28cropped%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Polar_bear',
    summaryExtract:
      'Pagophilic apex ursid navigating dynamic Barents Sea pack-ice leads northeast of Svalbard in sub-arctic -26°C winter conditions while hunting ringed seals.',
    latestOffsetMs: 7 * HOUR_MS,
    stepHours: 4.0,
    baseTempC: -26.0,
    tempSpanC: 6.0,
    diurnalMode: 'continuous',
    altWaveAmp: 6,
    waypoints: [
      { lat: 78.90, lon: 18.20, altOrDepth: 15 },
      { lat: 79.45, lon: 22.80, altOrDepth: 12 },
      { lat: 79.85, lon: 27.60, altOrDepth: 10 },
      { lat: 79.30, lon: 31.40, altOrDepth: 8 },
      { lat: 78.65, lon: 29.10, altOrDepth: 10 },
      { lat: 78.20, lon: 24.50, altOrDepth: 14 },
    ],
    minAltBound: 2,
    maxAltBound: 45,
  },
  {
    id: 'porcupine-caribou-31',
    localIdentifier: 'PORCUPINE-RT-31',
    nickname: 'Porcupine 31 (Caribou)',
    scientificName: 'Rangifer tarandus',
    commonName: 'Barren-ground Caribou',
    guild: 'TERRESTRIAL',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 98,
    colorHex: '#a3e635',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-PORCUPINE-CARIBOU-HERD',
    studyTitle: 'Yukon–ANWR Porcupine Caribou Herd Spring Tundra Migration',
    principalInvestigators: 'Dr. Mike Suitor, Dr. Kyle Joly',
    institution: 'Yukon Environment / Alaska Dept. of Fish & Game',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Yukon / ANWR Beaufort Tundra, AK/YT',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Artiodactyla',
      family: 'Cervidae',
      genus: 'Rangifer',
      species: 'tarandus',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/96/Reinbukken_p%C3%A5_frisk_gr%C3%B8nt_beite._-_panoramio.jpg/330px-Reinbukken_p%C3%A5_frisk_gr%C3%B8nt_beite._-_panoramio.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Reindeer',
    summaryExtract:
      'Migratory Arctic cervid traversing Old Crow Flats and the British Mountains to reach coastal calving grounds on the Beaufort Sea tundra plain.',
    latestOffsetMs: 19.5 * DAY_MS,
    stepHours: 3.5,
    baseTempC: 2.5,
    tempSpanC: 9.0,
    diurnalMode: 'continuous',
    altWaveAmp: 35,
    waypoints: [
      { lat: 66.85, lon: -137.40, altOrDepth: 680 },
      { lat: 67.80, lon: -138.90, altOrDepth: 540 },
      { lat: 68.75, lon: -140.40, altOrDepth: 790 },
      { lat: 69.45, lon: -142.20, altOrDepth: 280 },
      { lat: 69.75, lon: -143.90, altOrDepth: 95 },
      { lat: 69.30, lon: -145.10, altOrDepth: 340 },
    ],
    minAltBound: 30,
    maxAltBound: 1100,
  },
  {
    id: 'shan-altai-07',
    localIdentifier: 'SHAN-PU-07',
    nickname: 'Shan 07 (Snow Leopard)',
    scientificName: 'Panthera uncia',
    commonName: 'Snow Leopard',
    guild: 'TERRESTRIAL',
    sex: 'male',
    lifeStage: 'adult',
    massKg: 46,
    colorHex: '#c084fc',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-GOBI-ALTAI-LEOPARDS',
    studyTitle: 'South Gobi Tost Mountains Alpine Snow Leopard Telemetry',
    principalInvestigators: 'Dr. Örjan Johansson, Dr. Charudutt Mishra',
    institution: 'Snow Leopard Trust / Swedish University of Agricultural Sciences',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'South Gobi / Altai Ridges, Mongolia',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Carnivora',
      family: 'Felidae',
      genus: 'Panthera',
      species: 'uncia',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a5/Irbis4.JPG/330px-Irbis4.JPG?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Snow_leopard',
    summaryExtract:
      'Elusive high-altitude felid patrolling steep granite ridgelines and ibex escarpments between 1,900m and 4,100m across the South Gobi Altai range.',
    latestOffsetMs: 3.8 * DAY_MS,
    stepHours: 3.0,
    baseTempC: 4.0,
    tempSpanC: 11.0,
    diurnalMode: 'nocturnal',
    altWaveAmp: 110,
    meanderScale: 0.015,
    waypoints: [
      { lat: 43.18, lon: 100.65, altOrDepth: 2150 },
      { lat: 43.34, lon: 100.38, altOrDepth: 2980 },
      { lat: 43.52, lon: 100.08, altOrDepth: 3820 },
      { lat: 43.65, lon: 99.85, altOrDepth: 4100 },
      { lat: 43.48, lon: 100.12, altOrDepth: 2890 },
      { lat: 43.25, lon: 100.48, altOrDepth: 1960 },
    ],
    maxExtremeAltOrDepth: { index: 71, value: 4100 },
    minAltBound: 1900,
    maxAltBound: 4100,
  },
  {
    id: 'yaguarete-ibera-15',
    localIdentifier: 'YAGUARETE-PO-15',
    nickname: 'Yaguareté 15 (Jaguar)',
    scientificName: 'Panthera onca',
    commonName: 'Jaguar',
    guild: 'TERRESTRIAL',
    sex: 'male',
    lifeStage: 'adult',
    massKg: 108,
    colorHex: '#f59e0b',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-PANTANAL-IBERA-JAGUARS',
    studyTitle: 'Pantanal–Paraná–Iberá Wetland Jaguar Dispersal Corridor',
    principalInvestigators: 'Dr. Ronaldo Morato, Dr. Sebastián Di Martino',
    institution: 'CENAP-ICMBio / Rewilding Argentina',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Pantanal & Iberá Wetlands Corridor, South America',
    iucnStatus: 'NT',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Carnivora',
      family: 'Felidae',
      genus: 'Panthera',
      species: 'onca',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0a/Standing_jaguar.jpg/330px-Standing_jaguar.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Jaguar',
    summaryExtract:
      'Apex Neotropical riparian felid traversing flooded Pantanal savannas and Paraguay-Paraná gallery forests toward the Esteros del Iberá wetland corridor.',
    latestOffsetMs: 5.8 * DAY_MS,
    stepHours: 4.0,
    baseTempC: 26.5,
    tempSpanC: 8.5,
    diurnalMode: 'nocturnal',
    altWaveAmp: 12,
    meanderScale: 0.02,
    waypoints: [
      { lat: -17.35, lon: -56.65, altOrDepth: 115 },
      { lat: -19.20, lon: -57.10, altOrDepth: 95 },
      { lat: -22.10, lon: -57.75, altOrDepth: 120 },
      { lat: -25.40, lon: -57.60, altOrDepth: 85 },
      { lat: -27.85, lon: -57.25, altOrDepth: 68 },
      { lat: -28.35, lon: -57.15, altOrDepth: 64 },
    ],
    minAltBound: 45,
    maxAltBound: 220,
  },
  {
    id: 'serengeti-wildebeest-62',
    localIdentifier: 'MARA-CT-62',
    nickname: 'Mara 62 (Blue Wildebeest)',
    scientificName: 'Connochaetes taurinus',
    commonName: 'Blue Wildebeest',
    guild: 'TERRESTRIAL',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 210,
    colorHex: '#4ade80',
    sensorType: 'GPS-GSM',
    studyId: 'DEMO-SERENGETI-MARA-MIGRATION',
    studyTitle: 'Serengeti–Mara Great Migration Rainfall-Tracking Loop',
    principalInvestigators: 'Dr. Grant Hopcraft, Dr. Thomas Morrison',
    institution: 'University of Glasgow / Frankfurt Zoological Society',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Serengeti–Maasai Mara Ecosystem, TZ/KE',
    iucnStatus: 'LC',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Mammalia',
      order: 'Artiodactyla',
      family: 'Bovidae',
      genus: 'Connochaetes',
      species: 'taurinus',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fb/Blue_Wildebeest%2C_Ngorongoro.jpg/330px-Blue_Wildebeest%2C_Ngorongoro.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons / Ngorongoro',
    wikiUrl: 'https://en.wikipedia.org/wiki/Blue_wildebeest',
    summaryExtract:
      'Keystone migratory bovid tracking green-flush forage gradients from Ndutu plains across the Grumeti and Mara Rivers through the Serengeti-Mara ecosystem.',
    latestOffsetMs: 21 * HOUR_MS,
    stepHours: 3.0,
    baseTempC: 23.0,
    tempSpanC: 9.0,
    diurnalMode: 'diurnal',
    altWaveAmp: 35,
    meanderScale: 0.018,
    waypoints: [
      { lat: -2.95, lon: 35.12, altOrDepth: 1580 },
      { lat: -2.42, lon: 34.62, altOrDepth: 1460 },
      { lat: -2.18, lon: 34.18, altOrDepth: 1320 },
      { lat: -1.62, lon: 34.85, altOrDepth: 1480 },
      { lat: -1.42, lon: 35.08, altOrDepth: 1590 },
      { lat: -1.98, lon: 35.18, altOrDepth: 1640 },
    ],
    minAltBound: 1150,
    maxAltBound: 1850,
  },
  // === 17 NEW SPECIES: REPTILES (+2) ===
  {
    id: 'tortuguero-caretta-10',
    localIdentifier: 'GYRE-CC-10',
    nickname: 'Gyre 10 (Loggerhead Turtle)',
    scientificName: 'Caretta caretta',
    commonName: 'Loggerhead Sea Turtle',
    guild: 'REPTILE',
    sex: 'female',
    lifeStage: 'adult',
    massKg: 135,
    colorHex: '#22c55e',
    sensorType: 'Argos Doppler PTT',
    studyId: 'DEMO-NORTH-ATLANTIC-LOGGERHEADS',
    studyTitle: 'Florida–Azores North Atlantic Subtropical Gyre Migration',
    principalInvestigators: 'Dr. Kate Mansfield, Dr. Alan Bolten',
    institution: 'University of Central Florida / Archie Carr Center',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Florida / Bahamas → Azores Gyre, North Atlantic',
    iucnStatus: 'VU',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Reptilia',
      order: 'Testudines',
      family: 'Cheloniidae',
      genus: 'Caretta',
      species: 'caretta',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/Loggerhead_sea_turtle.jpg/330px-Loggerhead_sea_turtle.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Loggerhead_sea_turtle',
    summaryExtract:
      'Ocean-basin navigator riding the Gulf Stream and North Atlantic Drift from Florida nesting beaches across the Sargasso Sea toward the Azores archipelago.',
    latestOffsetMs: 9.5 * HOUR_MS,
    stepHours: 8.0,
    baseTempC: 22.0,
    tempSpanC: 11.0,
    diurnalMode: 'continuous',
    isDiving: true,
    waypoints: [
      { lat: 27.65, lon: -80.15, altOrDepth: -12 },
      { lat: 29.40, lon: -75.20, altOrDepth: -65 },
      { lat: 33.10, lon: -66.40, altOrDepth: -140 },
      { lat: 36.20, lon: -53.80, altOrDepth: -210 },
      { lat: 37.80, lon: -39.60, altOrDepth: -135 },
      { lat: 38.45, lon: -28.60, altOrDepth: -55 },
    ],
    minExtremeAltOrDepth: { index: 71, value: -210 },
    minAltBound: -210,
    maxAltBound: -1,
  },
  {
    id: 'arafura-croc-03',
    localIdentifier: 'KAKADU-CP-03',
    nickname: 'Arafura 03 (Saltwater Croc)',
    scientificName: 'Crocodylus porosus',
    commonName: 'Saltwater Crocodile',
    guild: 'REPTILE',
    sex: 'male',
    lifeStage: 'adult',
    massKg: 640,
    colorHex: '#059669',
    sensorType: 'Acoustic / Archival',
    studyId: 'DEMO-KAKADU-ESTUARY-CROCS',
    studyTitle: 'East Alligator River Tidal Estuary Saltwater Crocodile Movements',
    principalInvestigators: 'Dr. Hamish Campbell, Dr. Craig Franklin',
    institution: 'Charles Darwin University / University of Queensland',
    studyUrl: 'https://www.movebank.org/',
    licenseTerms: 'WildPulse Curated Scientific Demo Deck (CC-BY-4.0)',
    regionLabel: 'Kakadu / East Alligator Estuary, Australia',
    iucnStatus: 'LC',
    taxonomy: {
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Reptilia',
      order: 'Crocodilia',
      family: 'Crocodylidae',
      genus: 'Crocodylus',
      species: 'porosus',
    },
    photoUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/43/SaltwaterCrocodile%28%27Maximo%27%29.jpg/330px-SaltwaterCrocodile%28%27Maximo%27%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
    photoAttribution: 'Wikimedia Commons',
    wikiUrl: 'https://en.wikipedia.org/wiki/Saltwater_crocodile',
    summaryExtract:
      'World’s largest extant crocodilian riding tropical macrotidal currents along mangrove channels and floodplain billabongs in Kakadu’s East Alligator estuary.',
    latestOffsetMs: 28 * DAY_MS,
    stepHours: 3.0,
    baseTempC: 30.5,
    tempSpanC: 6.5,
    diurnalMode: 'nocturnal',
    altWaveAmp: 2,
    meanderScale: 0.004,
    waypoints: [
      { lat: -12.12, lon: 132.62, altOrDepth: 2 },
      { lat: -12.18, lon: 132.72, altOrDepth: 3 },
      { lat: -12.26, lon: 132.84, altOrDepth: 4 },
      { lat: -12.35, lon: 132.93, altOrDepth: 6 },
      { lat: -12.41, lon: 132.97, altOrDepth: 8 },
      { lat: -12.29, lon: 132.88, altOrDepth: 5 },
    ],
    minAltBound: 1,
    maxAltBound: 15,
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

    const meanderScale =
      spec.meanderScale ?? (spec.id === 'darwin-sc-19' ? 0.0012 : 0.045);
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
    const isDiving =
      spec.isDiving ?? (spec.guild === 'MARINE' || spec.id === 'kalani-7');
    if (isDiving) {
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
      altOrDepth = Math.max(spec.minAltBound ?? 5, sampled.altOrDepth + altWave);
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
