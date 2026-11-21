import type { StyleSpecification } from 'maplibre-gl';
import type { BasemapId } from '../../types/telemetry';

export const WILDPULSE_GLYPHS_URL =
  'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

export interface BasemapDefinition {
  id: BasemapId;
  label: string;
  shortLabel: string;
  description: string;
  style: StyleSpecification;
}

const DARK_TACTICAL_STYLE: StyleSpecification = {
  version: 8,
  name: 'WildPulse Dark Tactical (CARTO Dark Matter)',
  glyphs: WILDPULSE_GLYPHS_URL,
  sources: {
    'carto-dark-matter': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  },
  layers: [
    {
      id: 'wildpulse-bg',
      type: 'background',
      paint: {
        'background-color': '#04070d',
      },
    },
    {
      id: 'carto-dark-matter-layer',
      type: 'raster',
      source: 'carto-dark-matter',
      paint: {
        'raster-opacity': 0.94,
        'raster-contrast': 0.14,
        'raster-brightness-min': 0.02,
        'raster-brightness-max': 0.88,
        'raster-saturation': -0.15,
      },
    },
  ],
};

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  name: 'WildPulse Satellite (Esri World Imagery + Labels)',
  glyphs: WILDPULSE_GLYPHS_URL,
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    },
    'esri-reference-labels': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution: '&copy; Esri',
    },
  },
  layers: [
    {
      id: 'wildpulse-bg',
      type: 'background',
      paint: {
        'background-color': '#050a14',
      },
    },
    {
      id: 'esri-world-imagery-layer',
      type: 'raster',
      source: 'esri-world-imagery',
      paint: {
        'raster-brightness-max': 0.92,
        'raster-contrast': 0.06,
      },
    },
    {
      id: 'esri-reference-labels-layer',
      type: 'raster',
      source: 'esri-reference-labels',
      paint: {
        'raster-opacity': 0.82,
      },
    },
  ],
};

const TERRAIN_STYLE: StyleSpecification = {
  version: 8,
  name: 'WildPulse Terrain (Esri World Topo)',
  glyphs: WILDPULSE_GLYPHS_URL,
  sources: {
    'esri-world-topo': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution: 'Tiles &copy; Esri &mdash; Esri, Garmin, USGS, NGA, NPS',
    },
  },
  layers: [
    {
      id: 'wildpulse-bg',
      type: 'background',
      paint: {
        'background-color': '#0b141c',
      },
    },
    {
      id: 'esri-world-topo-layer',
      type: 'raster',
      source: 'esri-world-topo',
      paint: {
        'raster-brightness-max': 0.9,
        'raster-contrast': 0.1,
        'raster-saturation': -0.05,
      },
    },
  ],
};

const OCEAN_STYLE: StyleSpecification = {
  version: 8,
  name: 'WildPulse Ocean Bathymetry (Esri Ocean)',
  glyphs: WILDPULSE_GLYPHS_URL,
  sources: {
    'esri-ocean-base': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 13,
      attribution: 'Tiles &copy; Esri &mdash; GEBCO, NOAA, National Geographic',
    },
    'esri-ocean-reference': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 13,
      attribution: '&copy; Esri',
    },
  },
  layers: [
    {
      id: 'wildpulse-bg',
      type: 'background',
      paint: {
        'background-color': '#061224',
      },
    },
    {
      id: 'esri-ocean-base-layer',
      type: 'raster',
      source: 'esri-ocean-base',
      paint: {
        'raster-brightness-max': 0.88,
        'raster-contrast': 0.12,
      },
    },
    {
      id: 'esri-ocean-reference-layer',
      type: 'raster',
      source: 'esri-ocean-reference',
      paint: {
        'raster-opacity': 0.85,
      },
    },
  ],
};

export const BASEMAPS: Record<BasemapId, BasemapDefinition> = {
  'dark-tactical': {
    id: 'dark-tactical',
    label: 'Dark Tactical',
    shortLabel: 'Dark',
    description: 'CARTO Dark Matter custom-tuned obsidian mission deck',
    style: DARK_TACTICAL_STYLE,
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    shortLabel: 'Sat',
    description: 'Esri World Imagery with reference boundaries and labels',
    style: SATELLITE_STYLE,
  },
  terrain: {
    id: 'terrain',
    label: 'Terrain',
    shortLabel: 'Topo',
    description: 'Esri World Topographic relief and elevation contours',
    style: TERRAIN_STYLE,
  },
  ocean: {
    id: 'ocean',
    label: 'Ocean Bathymetry',
    shortLabel: 'Ocean',
    description: 'Esri Ocean Base bathymetry and marine reference chart',
    style: OCEAN_STYLE,
  },
};

export const BASEMAP_LIST: BasemapDefinition[] = [
  BASEMAPS['dark-tactical'],
  BASEMAPS.satellite,
  BASEMAPS.terrain,
  BASEMAPS.ocean,
];

export function getBasemapStyle(id: BasemapId): StyleSpecification {
  const def = BASEMAPS[id] ?? BASEMAPS['dark-tactical'];
  // Return a shallow clone of sources/layers arrays so MapLibre internal mutations
  // never corrupt shared static definitions across switches.
  return {
    ...def.style,
    sources: { ...def.style.sources },
    layers: def.style.layers.map((layer) => ({ ...layer })),
  };
}
