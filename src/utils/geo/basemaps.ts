import type {
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import type { BasemapId } from '../../types/telemetry';

export const WILDPULSE_GLYPHS_URL =
  'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

export const BASEMAP_BG_COLORS: Record<BasemapId, string> = {
  'dark-tactical': '#04070d',
  satellite: '#050a14',
  terrain: '#0b141c',
  ocean: '#061224',
};

export const BASEMAP_LAYER_GROUPS: Record<BasemapId, string[]> = {
  'dark-tactical': [
    'esri-dark-gray-base-layer',
    'dark-vec-water',
    'dark-vec-landcover',
    'dark-vec-waterway',
    'dark-vec-roads',
    'dark-vec-boundary-sub',
    'dark-vec-boundary-country',
    'dark-vec-water-labels',
    'dark-vec-place-labels',
  ],
  satellite: [
    'esri-world-imagery-layer',
    'esri-reference-labels-layer',
  ],
  terrain: [
    'terrain-ocean-underlay-layer',
    'esri-world-topo-layer',
    'esri-world-hillshade-layer',
  ],
  ocean: [
    'esri-ocean-base-layer',
    'esri-ocean-reference-layer',
  ],
};

export interface BasemapDefinition {
  id: BasemapId;
  label: string;
  shortLabel: string;
  description: string;
  style: StyleSpecification;
}

function createUnifiedSources(): Record<string, SourceSpecification> {
  return {
    'esri-dark-gray-base': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 11,
      attribution: 'Tiles &copy; Esri',
    },
    'openfreemap-planet': {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    },
    'esri-reference-labels': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 12,
      attribution: '&copy; Esri',
    },
    'esri-ocean-base': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 10,
      attribution: 'Tiles &copy; Esri &mdash; GEBCO, NOAA, National Geographic',
    },
    'esri-ocean-reference': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 10,
      attribution: '&copy; Esri',
    },
    'esri-world-topo': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 11,
      attribution: 'Tiles &copy; Esri &mdash; Esri, Garmin, USGS, NGA, NPS',
    },
    'esri-world-hillshade': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 11,
      attribution: '&copy; Esri',
    },
  };
}

/**
 * Builds one unified MapLibre style containing all 4 basemap layer groups so terrain
 * switches toggle visibility/background in-place without destroying telemetry layers.
 */
export function buildUnifiedBasemapStyle(
  initialBasemap: BasemapId = 'dark-tactical',
): StyleSpecification {
  const safeInitial: BasemapId =
    initialBasemap in BASEMAP_BG_COLORS ? initialBasemap : 'dark-tactical';

  const vis = (group: BasemapId): 'visible' | 'none' =>
    group === safeInitial ? 'visible' : 'none';

  const layers: LayerSpecification[] = [
    {
      id: 'wildpulse-bg',
      type: 'background',
      paint: {
        'background-color': BASEMAP_BG_COLORS[safeInitial],
      },
    },

    // Dark Tactical: Esri Dark Gray raster underlay + OpenFreeMap crisp vector overlay
    {
      id: 'esri-dark-gray-base-layer',
      type: 'raster',
      source: 'esri-dark-gray-base',
      layout: {
        visibility: vis('dark-tactical'),
      },
      paint: {
        'raster-brightness-max': 0.44,
        'raster-contrast': 0.28,
        'raster-saturation': -0.2,
      },
    },
    {
      id: 'dark-vec-water',
      type: 'fill',
      source: 'openfreemap-planet',
      'source-layer': 'water',
      layout: {
        visibility: vis('dark-tactical'),
      },
      paint: {
        'fill-color': '#050b16',
      },
    },
    {
      id: 'dark-vec-landcover',
      type: 'fill',
      source: 'openfreemap-planet',
      'source-layer': 'park',
      layout: {
        visibility: vis('dark-tactical'),
      },
      paint: {
        'fill-color': '#0a1926',
        'fill-opacity': 0.35,
      },
    },
    {
      id: 'dark-vec-waterway',
      type: 'line',
      source: 'openfreemap-planet',
      'source-layer': 'waterway',
      layout: {
        visibility: vis('dark-tactical'),
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#0e2942',
        'line-width': 0.9,
      },
    },
    {
      id: 'dark-vec-roads',
      type: 'line',
      source: 'openfreemap-planet',
      'source-layer': 'transportation',
      minzoom: 5,
      layout: {
        visibility: vis('dark-tactical'),
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#17253b',
        'line-width': 0.8,
        'line-opacity': 0.65,
      },
    },
    {
      id: 'dark-vec-boundary-sub',
      type: 'line',
      source: 'openfreemap-planet',
      'source-layer': 'boundary',
      filter: ['==', 'admin_level', 4],
      layout: {
        visibility: vis('dark-tactical'),
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#1e324d',
        'line-dasharray': [3, 2],
        'line-width': 0.8,
      },
    },
    {
      id: 'dark-vec-boundary-country',
      type: 'line',
      source: 'openfreemap-planet',
      'source-layer': 'boundary',
      filter: ['<=', 'admin_level', 2],
      layout: {
        visibility: vis('dark-tactical'),
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#2d4a6d',
        'line-width': 1.2,
      },
    },
    {
      id: 'dark-vec-water-labels',
      type: 'symbol',
      source: 'openfreemap-planet',
      'source-layer': 'water_name',
      layout: {
        visibility: vis('dark-tactical'),
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
      },
      paint: {
        'text-color': '#38bdf8',
        'text-opacity': 0.45,
        'text-halo-color': '#04070d',
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'dark-vec-place-labels',
      type: 'symbol',
      source: 'openfreemap-planet',
      'source-layer': 'place',
      layout: {
        visibility: vis('dark-tactical'),
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 8, 12],
      },
      paint: {
        'text-color': '#94a3b8',
        'text-halo-color': '#04070d',
        'text-halo-width': 1.5,
      },
    },

    // Satellite: Esri World Imagery + Reference Boundaries & Labels
    {
      id: 'esri-world-imagery-layer',
      type: 'raster',
      source: 'esri-world-imagery',
      layout: {
        visibility: vis('satellite'),
      },
      paint: {
        'raster-brightness-max': 0.92,
        'raster-contrast': 0.06,
      },
    },
    {
      id: 'esri-reference-labels-layer',
      type: 'raster',
      source: 'esri-reference-labels',
      layout: {
        visibility: vis('satellite'),
      },
      paint: {
        'raster-opacity': 0.82,
      },
    },

    // Terrain: Ocean bathymetry underlay + World Topo + Hillshade relief
    {
      id: 'terrain-ocean-underlay-layer',
      type: 'raster',
      source: 'esri-ocean-base',
      layout: {
        visibility: vis('terrain'),
      },
      paint: {
        'raster-brightness-max': 0.82,
        'raster-contrast': 0.16,
      },
    },
    {
      id: 'esri-world-topo-layer',
      type: 'raster',
      source: 'esri-world-topo',
      layout: {
        visibility: vis('terrain'),
      },
      paint: {
        'raster-brightness-max': 0.84,
        'raster-contrast': 0.2,
        'raster-saturation': 0.08,
      },
    },
    {
      id: 'esri-world-hillshade-layer',
      type: 'raster',
      source: 'esri-world-hillshade',
      layout: {
        visibility: vis('terrain'),
      },
      paint: {
        'raster-opacity': 0.28,
      },
    },

    // Ocean Bathymetry: World Ocean Base + Marine Reference Labels (maxzoom 10)
    {
      id: 'esri-ocean-base-layer',
      type: 'raster',
      source: 'esri-ocean-base',
      layout: {
        visibility: vis('ocean'),
      },
      paint: {
        'raster-brightness-max': 0.84,
        'raster-contrast': 0.18,
      },
    },
    {
      id: 'esri-ocean-reference-layer',
      type: 'raster',
      source: 'esri-ocean-reference',
      layout: {
        visibility: vis('ocean'),
      },
      paint: {
        'raster-opacity': 0.85,
      },
    },
  ];

  return {
    version: 8,
    name: 'WildPulse Unified Mission Basemap Deck',
    glyphs: WILDPULSE_GLYPHS_URL,
    sources: createUnifiedSources(),
    layers,
  };
}

export const BASEMAPS: Record<BasemapId, BasemapDefinition> = {
  'dark-tactical': {
    id: 'dark-tactical',
    label: 'Dark Tactical',
    shortLabel: 'Dark',
    description: 'OpenFreeMap vector deck with Esri Dark Gray obsidian underlay',
    style: buildUnifiedBasemapStyle('dark-tactical'),
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    shortLabel: 'Sat',
    description: 'Esri World Imagery with reference boundaries and labels',
    style: buildUnifiedBasemapStyle('satellite'),
  },
  terrain: {
    id: 'terrain',
    label: 'Terrain',
    shortLabel: 'Topo',
    description: 'Esri World Topographic relief, hillshade, and bathymetry underlay',
    style: buildUnifiedBasemapStyle('terrain'),
  },
  ocean: {
    id: 'ocean',
    label: 'Ocean Bathymetry',
    shortLabel: 'Ocean',
    description: 'Esri Ocean Base bathymetry and marine reference chart',
    style: buildUnifiedBasemapStyle('ocean'),
  },
};

export const BASEMAP_LIST: BasemapDefinition[] = [
  BASEMAPS['dark-tactical'],
  BASEMAPS.satellite,
  BASEMAPS.terrain,
  BASEMAPS.ocean,
];

export function getBasemapStyle(id: BasemapId): StyleSpecification {
  return buildUnifiedBasemapStyle(id);
}
