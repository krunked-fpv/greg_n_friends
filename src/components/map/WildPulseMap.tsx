import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { playbackClock } from '../../store/playbackClock';
import {
  selectFilteredAnimals,
  useTelemetryStore,
} from '../../store/telemetryStore';
import type { BasemapId, TrackColorMode } from '../../types/telemetry';
import { getBasemapStyle } from '../../utils/geo/basemaps';
import {
  buildFleetGeoJsonFromIndex,
  buildPrecomputedTrackIndex,
  type FixMarkerProperties,
  type FleetGeoJsonBundle,
  type HeadBeaconProperties,
  type PrecomputedTrackIndex,
} from '../../utils/geo/trackGeoJson';
import { FixHoverTooltip, type HoveredMapTarget } from './FixHoverTooltip';
import { MapLegendOverlay } from './MapLegendOverlay';

const CHEVRON_IMAGE_ID = 'wildpulse-chevron';

const SOURCE_IDS = {
  uncertainty: 'wildpulse-uncertainty',
  tracks: 'wildpulse-tracks',
  fixes: 'wildpulse-fixes',
  heads: 'wildpulse-heads',
} as const;

const LAYER_IDS = {
  uncertaintyFill: 'wildpulse-uncertainty-fill',
  uncertaintyLine: 'wildpulse-uncertainty-line',
  tracksGlow: 'wildpulse-tracks-glow',
  tracksLine: 'wildpulse-tracks-line',
  tracksChevrons: 'wildpulse-tracks-chevrons',
  fixesCircle: 'wildpulse-fixes-circle',
  headPulse: 'wildpulse-head-pulse',
  headHalo: 'wildpulse-head-halo',
  headCore: 'wildpulse-head-core',
  headLabel: 'wildpulse-head-label',
} as const;

const EMPTY_BUNDLE: FleetGeoJsonBundle = {
  tracks: { type: 'FeatureCollection', features: [] },
  fixes: { type: 'FeatureCollection', features: [] },
  uncertainty: { type: 'FeatureCollection', features: [] },
  heads: { type: 'FeatureCollection', features: [] },
  renderedAnimalCount: 0,
  renderedSegmentCount: 0,
  renderedHeadCount: 0,
};

function createChevronImageData(): ImageData | null {
  if (typeof document === 'undefined') return null;
  const size = 28;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Forward-pointing chevron (+X axis aligns with LineString travel direction)
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(20, 14);
  ctx.lineTo(8, 22);
  ctx.strokeStyle = 'rgba(4, 7, 13, 0.9)';
  ctx.lineWidth = 5.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(20, 14);
  ctx.lineTo(8, 22);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2.6;
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}

/**
 * Idempotently creates or restores all WildPulse telemetry GeoJSON sources,
 * procedural chevron sprite, and WebGL layers onto a MapLibre map instance.
 */
export function ensureTelemetryLayers(
  map: MapLibreMap,
  bundle: FleetGeoJsonBundle = EMPTY_BUNDLE,
): void {
  if (!map || !map.getStyle()) return;

  if (!map.hasImage(CHEVRON_IMAGE_ID)) {
    const chevron = createChevronImageData();
    if (chevron) {
      map.addImage(CHEVRON_IMAGE_ID, chevron, { pixelRatio: 2 });
    }
  }

  if (!map.getSource(SOURCE_IDS.uncertainty)) {
    map.addSource(SOURCE_IDS.uncertainty, {
      type: 'geojson',
      data: bundle.uncertainty,
    });
  }
  if (!map.getSource(SOURCE_IDS.tracks)) {
    map.addSource(SOURCE_IDS.tracks, {
      type: 'geojson',
      data: bundle.tracks,
    });
  }
  if (!map.getSource(SOURCE_IDS.fixes)) {
    map.addSource(SOURCE_IDS.fixes, {
      type: 'geojson',
      data: bundle.fixes,
    });
  }
  if (!map.getSource(SOURCE_IDS.heads)) {
    map.addSource(SOURCE_IDS.heads, {
      type: 'geojson',
      data: bundle.heads,
    });
  }

  if (!map.getLayer(LAYER_IDS.uncertaintyFill)) {
    map.addLayer({
      id: LAYER_IDS.uncertaintyFill,
      type: 'fill',
      source: SOURCE_IDS.uncertainty,
      paint: {
        'fill-color': ['get', 'colorHex'],
        'fill-opacity': [
          'case',
          ['boolean', ['get', 'isHovered'], false],
          0.26,
          ['boolean', ['get', 'isSelected'], false],
          0.18,
          0.11,
        ],
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.uncertaintyLine)) {
    map.addLayer({
      id: LAYER_IDS.uncertaintyLine,
      type: 'line',
      source: SOURCE_IDS.uncertainty,
      paint: {
        'line-color': ['get', 'colorHex'],
        'line-width': [
          'case',
          ['boolean', ['get', 'isHovered'], false],
          1.8,
          ['boolean', ['get', 'isSelected'], false],
          1.5,
          1.0,
        ],
        'line-opacity': [
          'case',
          ['boolean', ['get', 'isHovered'], false],
          0.85,
          ['boolean', ['get', 'isSelected'], false],
          0.65,
          0.42,
        ],
        'line-dasharray': [2, 2],
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.tracksGlow)) {
    map.addLayer({
      id: LAYER_IDS.tracksGlow,
      type: 'line',
      source: SOURCE_IDS.tracks,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['boolean', ['get', 'isSelected'], false], 8.5, 5.2],
        'line-opacity': ['*', ['coalesce', ['get', 'opacity'], 0.9], 0.22],
        'line-blur': 3,
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.tracksLine)) {
    map.addLayer({
      id: LAYER_IDS.tracksLine,
      type: 'line',
      source: SOURCE_IDS.tracks,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['boolean', ['get', 'isSelected'], false], 3.4, 2.1],
        'line-opacity': ['coalesce', ['get', 'opacity'], 0.9],
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.tracksChevrons)) {
    map.addLayer({
      id: LAYER_IDS.tracksChevrons,
      type: 'symbol',
      source: SOURCE_IDS.tracks,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 95,
        'icon-image': CHEVRON_IMAGE_ID,
        'icon-size': ['case', ['boolean', ['get', 'isSelected'], false], 0.8, 0.66],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
      },
      paint: {
        'icon-opacity': ['*', ['coalesce', ['get', 'opacity'], 0.9], 0.92],
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.fixesCircle)) {
    map.addLayer({
      id: LAYER_IDS.fixesCircle,
      type: 'circle',
      source: SOURCE_IDS.fixes,
      paint: {
        'circle-radius': [
          'case',
          ['boolean', ['get', 'isHovered'], false],
          6.5,
          ['boolean', ['get', 'isSelected'], false],
          3.2,
          2.2,
        ],
        'circle-color': [
          'case',
          ['boolean', ['get', 'isOutlierSpike'], false],
          '#f43f5e',
          ['get', 'colorHex'],
        ],
        'circle-stroke-color': [
          'case',
          ['boolean', ['get', 'isHovered'], false],
          '#ffffff',
          '#04070d',
        ],
        'circle-stroke-width': [
          'case',
          ['boolean', ['get', 'isHovered'], false],
          2.2,
          1.0,
        ],
        'circle-opacity': [
          'case',
          ['boolean', ['get', 'isHovered'], false],
          1.0,
          ['boolean', ['get', 'isSelected'], false],
          0.85,
          0.48,
        ],
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.headPulse)) {
    map.addLayer({
      id: LAYER_IDS.headPulse,
      type: 'circle',
      source: SOURCE_IDS.heads,
      paint: {
        'circle-radius': 16,
        'circle-color': ['get', 'colorHex'],
        'circle-opacity': 0.24,
        'circle-stroke-color': ['get', 'colorHex'],
        'circle-stroke-width': 1.4,
        'circle-stroke-opacity': 0.48,
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.headHalo)) {
    map.addLayer({
      id: LAYER_IDS.headHalo,
      type: 'circle',
      source: SOURCE_IDS.heads,
      paint: {
        'circle-radius': ['case', ['boolean', ['get', 'isSelected'], false], 10.5, 8.2],
        'circle-color': '#04070d',
        'circle-opacity': 0.88,
        'circle-stroke-color': [
          'case',
          ['boolean', ['get', 'isSelected'], false],
          '#ffffff',
          ['get', 'colorHex'],
        ],
        'circle-stroke-width': ['case', ['boolean', ['get', 'isSelected'], false], 2.2, 1.6],
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.headCore)) {
    map.addLayer({
      id: LAYER_IDS.headCore,
      type: 'circle',
      source: SOURCE_IDS.heads,
      paint: {
        'circle-radius': ['case', ['boolean', ['get', 'isSelected'], false], 5.6, 4.4],
        'circle-color': ['get', 'colorHex'],
        'circle-opacity': 1,
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.headLabel)) {
    map.addLayer({
      id: LAYER_IDS.headLabel,
      type: 'symbol',
      source: SOURCE_IDS.heads,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-offset': [0, -1.45],
        'text-anchor': 'bottom',
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': '#04070d',
        'text-halo-width': 1.6,
      },
    });
  }
}

function pushBundleToSources(map: MapLibreMap, bundle: FleetGeoJsonBundle): void {
  const uncertaintySrc = map.getSource(SOURCE_IDS.uncertainty) as
    | GeoJSONSource
    | undefined;
  const tracksSrc = map.getSource(SOURCE_IDS.tracks) as GeoJSONSource | undefined;
  const fixesSrc = map.getSource(SOURCE_IDS.fixes) as GeoJSONSource | undefined;
  const headsSrc = map.getSource(SOURCE_IDS.heads) as GeoJSONSource | undefined;

  if (uncertaintySrc) uncertaintySrc.setData(bundle.uncertainty);
  if (tracksSrc) tracksSrc.setData(bundle.tracks);
  if (fixesSrc) fixesSrc.setData(bundle.fixes);
  if (headsSrc) headsSrc.setData(bundle.heads);
}

function parseFeatureProperties<T>(raw: Record<string, unknown> | undefined): T | null {
  if (!raw) return null;
  const nullableFields = [
    'altitudeOrDepthMeters',
    'groundSpeedKmh',
    'headingDeg',
    'externalTempC',
    'tagVoltage',
    'argosLc',
    'accuracyRadiusMeters',
  ];
  const normalized: Record<string, unknown> = { ...raw };
  for (const key of nullableFields) {
    if (normalized[key] === 'null' || normalized[key] === undefined) {
      normalized[key] = null;
    }
  }
  return normalized as unknown as T;
}

export function WildPulseMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const animals = useTelemetryStore(selectFilteredAnimals);
  const basemap = useTelemetryStore((s) => s.basemap);
  const trackColorMode = useTelemetryStore((s) => s.trackColorMode);
  const selectedAnimalId = useTelemetryStore((s) => s.selectedAnimalId);
  const flyToRequest = useTelemetryStore((s) => s.flyToRequest);
  const referenceNowMs = useTelemetryStore((s) => s.referenceNowMs);
  const rightDrawerOpen = useTelemetryStore((s) => s.rightDrawerOpen);
  const selectAnimal = useTelemetryStore((s) => s.selectAnimal);

  const [hoveredTarget, setHoveredTarget] = useState<HoveredMapTarget | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  const mapLoadedRef = useRef(false);
  const styleLoadedRef = useRef(false);
  const isReconcilingRef = useRef(false);
  const appliedBasemapRef = useRef<BasemapId>(basemap);
  const basemapRef = useRef<BasemapId>(basemap);
  const trackColorModeRef = useRef<TrackColorMode>(trackColorMode);
  const selectedAnimalIdRef = useRef<string | null>(selectedAnimalId);
  const referenceNowMsRef = useRef<number>(referenceNowMs);
  const lastFlyNonceRef = useRef<number>(0);
  const pendingFlyToRef = useRef<{ lat: number; lon: number; zoom?: number } | null>(null);
  const wasFollowCamRef = useRef<boolean>(false);

  basemapRef.current = basemap;
  trackColorModeRef.current = trackColorMode;
  selectedAnimalIdRef.current = selectedAnimalId;
  referenceNowMsRef.current = referenceNowMs;

  const trackIndex = useMemo<PrecomputedTrackIndex>(
    () =>
      buildPrecomputedTrackIndex(
        animals,
        trackColorMode,
        selectedAnimalId,
        referenceNowMs,
      ),
    [animals, trackColorMode, selectedAnimalId, referenceNowMs],
  );
  const trackIndexRef = useRef<PrecomputedTrackIndex>(trackIndex);
  trackIndexRef.current = trackIndex;

  const latestBundleRef = useRef<FleetGeoJsonBundle>(EMPTY_BUNDLE);

  const updateDiagnostics = (bundle: FleetGeoJsonBundle) => {
    if (typeof window === 'undefined') return;
    const map = mapRef.current;
    const hasCoreSources = Boolean(
      map &&
        map.getSource(SOURCE_IDS.tracks) &&
        map.getLayer(LAYER_IDS.tracksLine),
    );
    window.__WILDPULSE_MAP_DIAGNOSTICS__ = {
      ready: Boolean((mapLoadedRef.current || styleLoadedRef.current) && hasCoreSources),
      basemap: basemapRef.current,
      trackColorMode: trackColorModeRef.current,
      renderedAnimalCount: bundle.renderedAnimalCount,
      renderedSegmentCount: bundle.renderedSegmentCount,
      renderedHeadCount: bundle.renderedHeadCount,
      styleLoaded: Boolean(
        map && (map.isStyleLoaded() || (styleLoadedRef.current && hasCoreSources)),
      ),
    };
  };

  // Initialize MapLibre GL JS instance once
  useEffect(() => {
    const mapContainer = mapCanvasRef.current;
    const outerContainer = containerRef.current;
    if (!mapContainer || !outerContainer) return;

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: mapContainer,
        style: getBasemapStyle(basemapRef.current),
        center: [-105, 16],
        zoom: 1.75,
        minZoom: 1.2,
        maxZoom: 18,
        renderWorldCopies: true,
        attributionControl: { compact: true },
      });
    } catch (err) {
      setWebglError(
        err instanceof Error ? err.message : 'Unable to initialize WebGL map canvas',
      );
      return;
    }

    mapRef.current = map;
    appliedBasemapRef.current = basemapRef.current;

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }),
      'top-right',
    );

    const reconcileMap = (markStyleLoaded: boolean, markMapLoaded: boolean) => {
      if (markStyleLoaded) styleLoadedRef.current = true;
      if (markMapLoaded) mapLoadedRef.current = true;
      if (isReconcilingRef.current) return;
      isReconcilingRef.current = true;
      try {
        if (map.getStyle()) {
          ensureTelemetryLayers(map, latestBundleRef.current);
          pushBundleToSources(map, latestBundleRef.current);
        }
      } catch {
        // Ignore transient style teardown states during rapid basemap swaps
      } finally {
        isReconcilingRef.current = false;
      }
      updateDiagnostics(latestBundleRef.current);

      if (mapLoadedRef.current && pendingFlyToRef.current) {
        const pending = pendingFlyToRef.current;
        pendingFlyToRef.current = null;
        map.flyTo({
          center: [pending.lon, pending.lat],
          zoom: pending.zoom ?? Math.max(map.getZoom(), 4.4),
          duration: 1050,
          essential: true,
        });
      }
    };

    map.on('load', () => reconcileMap(true, true));
    map.on('style.load', () => reconcileMap(true, mapLoadedRef.current));
    map.on('styledata', () => reconcileMap(styleLoadedRef.current, mapLoadedRef.current));
    map.on('idle', () => updateDiagnostics(latestBundleRef.current));
    map.on('error', () => {
      // Suppress transient offline tile/glyph aborts so pageerror/console stay clean
    });

    const handleInteractiveHover = (
      e: MapLayerMouseEvent,
      isHead: boolean,
    ) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const parsed = isHead
        ? parseFeatureProperties<HeadBeaconProperties>(
            feature.properties as Record<string, unknown>,
          )
        : parseFeatureProperties<FixMarkerProperties>(
            feature.properties as Record<string, unknown>,
          );
      if (!parsed) return;
      map.getCanvas().style.cursor = 'pointer';
      setHoveredTarget({
        x: e.point.x,
        y: e.point.y,
        isHead,
        props: parsed,
      });
      if (Number.isFinite(parsed.timestampMs)) {
        playbackClock.setHoveredFixMs(parsed.timestampMs);
      }
    };

    const handleHoverLeave = () => {
      map.getCanvas().style.cursor = '';
      setHoveredTarget(null);
      playbackClock.setHoveredFixMs(null);
    };

    const handleFeatureClick = (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const animalId = feature?.properties?.animalId;
      if (typeof animalId === 'string' && animalId.length > 0) {
        selectAnimal(animalId, true);
      }
    };

    map.on('mousemove', LAYER_IDS.headCore, (e) => handleInteractiveHover(e, true));
    map.on('mousemove', LAYER_IDS.headHalo, (e) => handleInteractiveHover(e, true));
    map.on('mousemove', LAYER_IDS.fixesCircle, (e) => handleInteractiveHover(e, false));

    map.on('mouseleave', LAYER_IDS.headCore, handleHoverLeave);
    map.on('mouseleave', LAYER_IDS.headHalo, handleHoverLeave);
    map.on('mouseleave', LAYER_IDS.fixesCircle, handleHoverLeave);

    map.on('click', LAYER_IDS.headCore, handleFeatureClick);
    map.on('click', LAYER_IDS.headHalo, handleFeatureClick);
    map.on('click', LAYER_IDS.headLabel, handleFeatureClick);
    map.on('click', LAYER_IDS.fixesCircle, handleFeatureClick);
    map.on('click', LAYER_IDS.tracksLine, handleFeatureClick);

    // Resize cleanly when drawers toggle or viewport resizes
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(outerContainer);

    // Pulsing radar beacon ring animation decoupled from React state
    let rafId = 0;
    let lastPulsePaintMs = 0;
    const animateBeaconPulse = (nowMs: number) => {
      if (
        nowMs - lastPulsePaintMs >= 32 &&
        latestBundleRef.current.renderedHeadCount > 0 &&
        map.getStyle() &&
        map.getLayer(LAYER_IDS.headPulse)
      ) {
        lastPulsePaintMs = nowMs;
        const phase = (nowMs % 1800) / 1800;
        const radius = 8 + phase * 18;
        const opacity = Number((0.52 * (1 - phase)).toFixed(3));
        const strokeOpacity = Number((0.7 * (1 - phase)).toFixed(3));
        try {
          map.setPaintProperty(LAYER_IDS.headPulse, 'circle-radius', radius);
          map.setPaintProperty(LAYER_IDS.headPulse, 'circle-opacity', opacity);
          map.setPaintProperty(
            LAYER_IDS.headPulse,
            'circle-stroke-opacity',
            strokeOpacity,
          );
        } catch {
          // Ignore if layer is mid-transition during style reload
        }
      }
      rafId = window.requestAnimationFrame(animateBeaconPulse);
    };
    rafId = window.requestAnimationFrame(animateBeaconPulse);

    return () => {
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      mapRef.current = null;
      map.remove();
    };
  }, [selectAnimal]);

  // Switch basemap StyleJSON seamlessly while preserving active tracks
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (appliedBasemapRef.current === basemap) return;

    appliedBasemapRef.current = basemap;
    styleLoadedRef.current = false;
    updateDiagnostics(latestBundleRef.current);
    map.setStyle(getBasemapStyle(basemap));
  }, [basemap]);

  // FlyTo triggers from store (animal selection or quick fly-to button)
  useEffect(() => {
    if (!flyToRequest || flyToRequest.nonce === lastFlyNonceRef.current) return;
    lastFlyNonceRef.current = flyToRequest.nonce;

    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) {
      pendingFlyToRef.current = {
        lat: flyToRequest.lat,
        lon: flyToRequest.lon,
        zoom: flyToRequest.zoom,
      };
      return;
    }

    map.flyTo({
      center: [flyToRequest.lon, flyToRequest.lat],
      zoom: flyToRequest.zoom ?? Math.max(map.getZoom(), 4.4),
      duration: 1050,
      essential: true,
    });
  }, [flyToRequest]);

  // Recompute GeoJSON bundle whenever filtered animals, color mode, or selection changes
  useEffect(() => {
    const snap = playbackClock.getSnapshot();
    const bundle = buildFleetGeoJsonFromIndex(trackIndex, {
      trackColorMode,
      selectedAnimalId,
      windowStartMs: snap.windowStartMs,
      windowEndMs: snap.windowEndMs,
      currentMs: snap.currentMs,
      syncMode: snap.syncMode,
      hoveredFixMs: snap.hoveredFixMs,
      frames: playbackClock.getLatestFrames(),
      referenceMs: referenceNowMs,
    });
    latestBundleRef.current = bundle;

    const map = mapRef.current;
    if (map) {
      try {
        if (map.getStyle()) {
          ensureTelemetryLayers(map, bundle);
          pushBundleToSources(map, bundle);
        }
      } catch {
        // Style is still initializing; reconcileMap on 'load'/'style.load' will attach layers
      }
    }
    updateDiagnostics(bundle);
  }, [trackIndex, trackColorMode, selectedAnimalId, referenceNowMs]);

  // Keep MapLibre built-in top-right / bottom-right controls clear of HUD bar and right drawer
  useEffect(() => {
    const canvasHost = mapCanvasRef.current;
    if (!canvasHost) return;
    const rightMargin = rightDrawerOpen ? '404px' : '14px';
    const topRightCtrl = canvasHost.querySelector(
      '.maplibregl-ctrl-top-right',
    ) as HTMLElement | null;
    const bottomRightCtrl = canvasHost.querySelector(
      '.maplibregl-ctrl-bottom-right',
    ) as HTMLElement | null;

    if (topRightCtrl) {
      topRightCtrl.style.top = '66px';
      topRightCtrl.style.right = rightMargin;
      topRightCtrl.style.transition = 'right 300ms ease';
    }
    if (bottomRightCtrl) {
      bottomRightCtrl.style.bottom = '14px';
      bottomRightCtrl.style.right = rightMargin;
      bottomRightCtrl.style.transition = 'right 300ms ease';
    }
  }, [rightDrawerOpen]);

  // Direct 60fps subscription to playbackClock ticks (zero React re-renders!)
  useEffect(() => {
    const applyFollowCam = (
      bundle: FleetGeoJsonBundle,
      isPlaying: boolean,
      followCam: boolean,
    ) => {
      if (!followCam) {
        wasFollowCamRef.current = false;
        return;
      }
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;

      const targetId = selectedAnimalIdRef.current;
      const targetHead =
        (targetId
          ? bundle.heads.features.find((f) => f.properties.animalId === targetId)
          : undefined) ?? bundle.heads.features[0];
      if (!targetHead) return;

      const [lon, lat] = targetHead.geometry.coordinates;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

      const justEnabled = !wasFollowCamRef.current;
      wasFollowCamRef.current = true;

      if (justEnabled || !isPlaying) {
        map.easeTo({
          center: [lon, lat],
          zoom: justEnabled ? Math.max(map.getZoom(), 4.2) : map.getZoom(),
          duration: 380,
          essential: true,
        });
      } else {
        map.jumpTo({
          center: [lon, lat],
        });
      }
    };

    const unsubscribe = playbackClock.subscribeTick((snapshot, frames) => {
      const bundle = buildFleetGeoJsonFromIndex(trackIndexRef.current, {
        trackColorMode: trackColorModeRef.current,
        selectedAnimalId: selectedAnimalIdRef.current,
        windowStartMs: snapshot.windowStartMs,
        windowEndMs: snapshot.windowEndMs,
        currentMs: snapshot.currentMs,
        syncMode: snapshot.syncMode,
        hoveredFixMs: snapshot.hoveredFixMs,
        frames,
        referenceMs: referenceNowMsRef.current,
      });
      latestBundleRef.current = bundle;

      const map = mapRef.current;
      if (map && map.getStyle()) {
        pushBundleToSources(map, bundle);
      }
      updateDiagnostics(bundle);
      applyFollowCam(bundle, snapshot.isPlaying, snapshot.followCam);
    });

    const unsubscribeControls = playbackClock.subscribeControls(() => {
      const snap = playbackClock.getSnapshot();
      applyFollowCam(latestBundleRef.current, snap.isPlaying, snap.followCam);
    });

    return () => {
      unsubscribe();
      unsubscribeControls();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="wildpulse-map-container"
      style={{ width: '100vw', height: '100vh' }}
      className="relative h-screen w-screen overflow-hidden bg-obsidian-950"
    >
      <div ref={mapCanvasRef} className="h-full w-full" />

      {webglError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-obsidian-950/90 p-6 text-center">
          <div className="max-w-md rounded-xl border border-rose-500/30 bg-obsidian-900/90 p-4 text-sm text-rose-200">
            WebGL Map Context Unavailable: {webglError}
          </div>
        </div>
      )}

      <MapLegendOverlay />
      <FixHoverTooltip target={hoveredTarget} />
    </div>
  );
}

export default WildPulseMap;
