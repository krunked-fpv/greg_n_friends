import type {
  EcologicalGuild,
  IucnStatus,
  StudyAttribution,
} from '../types/telemetry.ts';

export interface CuratedAtnDatasetSpec {
  datasetId: string;
  /** Canonical WildPulse AnimalDossier.id shared identically by server proxy and browser client */
  id: string;
  nickname: string;
  commonName: string;
  scientificName: string;
  guild: EcologicalGuild;
  colorHex: string;
  iucnStatus: IucnStatus;
  regionLabel: string;
  summaryExtract: string;
  attribution: StudyAttribution;
}

export const CURATED_ATN_DATASETS: readonly CuratedAtnDatasetSpec[] = [
  {
    datasetId: 'atn_174822_spotted-seal_trajectory_20180414-20181103',
    id: 'atn-174822-spotted-seal',
    nickname: 'Bering Seal PL2018 (PTT 174822)',
    commonName: 'Spotted Seal',
    scientificName: 'Phoca largha',
    guild: 'MARINE',
    colorHex: '#2dd4bf',
    iucnStatus: 'LC',
    regionLabel: 'Bering Sea, North Pacific',
    summaryExtract:
      'Pagophilic pinniped tracked across Bering Sea pack-ice margins and coastal haul-outs via Wildlife Computers SPOT satellite telemetry.',
    attribution: {
      studyTitle: 'Bering Sea Spotted & Ribbon Seal Telemetry (PTT 174822)',
      principalInvestigators:
        'Josh London, Stacie Koslovsky, Michael Cameron, Peter Boveng, Heather Ziel',
      institution:
        'NOAA Alaska Fisheries Science Center (Marine Mammal Laboratory)',
      studyUrl:
        'https://portal.atn.ioos.us/#metadata/70c76508-b252-4c3d-9f27-e4cba9300537/project',
      licenseTerms:
        'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge NOAA AFSC & US IOOS ATN.',
      licenseMd5Required: false,
    },
  },
  {
    datasetId: 'atn_94821_blainvilles-beaked-whale_trajectory_20091221-20100111',
    id: 'atn-94821-beaked-whale',
    nickname: 'HIMd168 Beaked Whale (PTT 94821)',
    commonName: "Blainville's Beaked Whale",
    scientificName: 'Mesoplodon densirostris',
    guild: 'MARINE',
    colorHex: '#60a5fa',
    iucnStatus: 'LC',
    regionLabel: "Hawai'i Island Basin, Central Pacific",
    summaryExtract:
      'Deep-diving ziphiid cetacean tracked off the leeward slope of Hawaiʻi Island using Argos SPOT5 satellite-linked telemetry.',
    attribution: {
      studyTitle:
        'Odontocete Tagging in the Main Hawaiian Islands (PTT 94821)',
      principalInvestigators:
        'Robin Baird, M. Bradley Hanson, Gregory S. Schorr, Daniel L. Webster, Erin M. Oleson',
      institution: 'Cascadia Research Collective / NOAA Fisheries',
      studyUrl:
        'https://portal.atn.ioos.us/#metadata/1f1ff520-a4f5-4425-9681-57396059f1c9/project',
      licenseTerms:
        'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge Cascadia Research Collective & US IOOS ATN.',
      licenseMd5Required: false,
    },
  },
  {
    datasetId: 'atn_85568_short-finned-pilot-whale_trajectory_20080705-20080802',
    id: 'atn-85568-pilot-whale',
    nickname: 'HIGm0471 Pilot Whale (PTT 85568)',
    commonName: 'Short-finned Pilot Whale',
    scientificName: 'Globicephala macrorhynchus',
    guild: 'MARINE',
    colorHex: '#38bdf8',
    iucnStatus: 'LC',
    regionLabel: "Hawai'i Island Basin, Central Pacific",
    summaryExtract:
      'Island-associated delphinid tracked along deep pelagic escarpments off Hawaiʻi via Argos satellite telemetry.',
    attribution: {
      studyTitle:
        'Odontocete Tagging in the Main Hawaiian Islands (PTT 85568)',
      principalInvestigators:
        'Robin Baird, M. Bradley Hanson, Gregory S. Schorr, Daniel L. Webster, Erin M. Oleson',
      institution: 'Cascadia Research Collective / NOAA Fisheries',
      studyUrl:
        'https://portal.atn.ioos.us/#metadata/1f1ff520-a4f5-4425-9681-57396059f1c9/project',
      licenseTerms:
        'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge Cascadia Research Collective & US IOOS ATN.',
      licenseMd5Required: false,
    },
  },
  {
    datasetId: 'atn_38553_bearded-seal_trajectory_20110618-20120314',
    id: 'atn-38553-bearded-seal',
    nickname: 'Chukchi Bearded Seal (PTT 38553)',
    commonName: 'Bearded Seal',
    scientificName: 'Erignathus barbatus',
    guild: 'MARINE',
    colorHex: '#34d399',
    iucnStatus: 'LC',
    regionLabel: 'Chukchi & Beaufort Seas, Arctic Ocean',
    summaryExtract:
      'Benthic-foraging Arctic phocid tracked across seasonal sea-ice breakups between the Bering, Chukchi, and Beaufort Seas.',
    attribution: {
      studyTitle:
        'Arctic Bearded Seal Sea-Ice Telemetry (PTT 38553)',
      principalInvestigators:
        'Peter Boveng, Josh London, Michael Cameron, Stacie Koslovsky',
      institution: 'NOAA Alaska Fisheries Science Center (Marine Mammal Laboratory)',
      studyUrl:
        'https://atn.ioos.us/erddap/tabledap/atn_38553_bearded-seal_trajectory_20110618-20120314.html',
      licenseTerms:
        'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge NOAA AFSC & US IOOS ATN.',
      licenseMd5Required: false,
    },
  },
  {
    datasetId: 'atn_53631_false-killer-whale_trajectory_20100927-20101001',
    id: 'atn-53631-false-killer-whale',
    nickname: 'Papahānaumokuākea FKW (PTT 53631)',
    commonName: 'False Killer Whale',
    scientificName: 'Pseudorca crassidens',
    guild: 'MARINE',
    colorHex: '#a78bfa',
    iucnStatus: 'NT',
    regionLabel: 'Northwestern Hawaiian Islands, North Pacific',
    summaryExtract:
      'Pelagic social odontocete monitored across seamounts and marine monument reefs of the Northwestern Hawaiian Islands.',
    attribution: {
      studyTitle:
        'Main & Northwestern Hawaiian Islands False Killer Whale Telemetry (PTT 53631)',
      principalInvestigators:
        'Robin W. Baird, Daniel L. Webster, Gregory S. Schorr',
      institution: 'Cascadia Research Collective / IOOS ATN',
      studyUrl:
        'https://atn.ioos.us/erddap/tabledap/atn_53631_false-killer-whale_trajectory_20100927-20101001.html',
      licenseTerms:
        'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge Cascadia Research Collective & US IOOS ATN.',
      licenseMd5Required: false,
    },
  },
  {
    datasetId: 'atn_41820_harbor-seal_trajectory_20040830-20041229',
    id: 'atn-41820-harbor-seal',
    nickname: 'Alaska Harbor Seal (PTT 41820)',
    commonName: 'Pacific Harbor Seal',
    scientificName: 'Phoca vitulina',
    guild: 'MARINE',
    colorHex: '#22d3ee',
    iucnStatus: 'LC',
    regionLabel: 'Gulf of Alaska, North Pacific',
    summaryExtract:
      'Coastal and fjord pinniped foraging along glacial tidewater passages and continental shelf eddies in the Gulf of Alaska.',
    attribution: {
      studyTitle:
        'Gulf of Alaska Harbor Seal Satellite Telemetry (PTT 41820)',
      principalInvestigators: 'Peter Boveng, Josh London, Michael Cameron',
      institution: 'NOAA Alaska Fisheries Science Center',
      studyUrl:
        'https://atn.ioos.us/erddap/tabledap/atn_41820_harbor-seal_trajectory_20040830-20041229.html',
      licenseTerms:
        'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge NOAA AFSC & US IOOS ATN.',
      licenseMd5Required: false,
    },
  },
  {
    datasetId: 'atn_131373_ribbon-seal_trajectory_20140428-20141213',
    id: 'atn-131373-ribbon-seal',
    nickname: 'Bering Ribbon Seal (PTT 131373)',
    commonName: 'Ribbon Seal',
    scientificName: 'Histriophoca fasciata',
    guild: 'MARINE',
    colorHex: '#f472b6',
    iucnStatus: 'LC',
    regionLabel: 'Bering Sea Pelagic Basin, North Pacific',
    summaryExtract:
      'Ice-associated pelagic seal dispersing across the deep Aleutian Basin and Bering Sea shelf break after spring molt.',
    attribution: {
      studyTitle:
        'Bering Sea Ribbon Seal Post-Molt Telemetry (PTT 131373)',
      principalInvestigators: 'Peter Boveng, Josh London, Michael Cameron',
      institution: 'Marine Mammal Laboratory, NOAA Alaska Fisheries Science Center',
      studyUrl:
        'https://atn.ioos.us/erddap/tabledap/atn_131373_ribbon-seal_trajectory_20140428-20141213.html',
      licenseTerms:
        'IOOS Animal Telemetry Network (ATN) Open Scientific Data — Acknowledge NOAA AFSC & US IOOS ATN.',
      licenseMd5Required: false,
    },
  },
];
