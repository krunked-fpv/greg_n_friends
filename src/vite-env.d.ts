/// <reference types="vite/client" />

export interface WildPulseMapDiagnostics {
  ready: boolean;
  basemap: string;
  trackColorMode: string;
  renderedAnimalCount: number;
  renderedSegmentCount: number;
  renderedHeadCount: number;
  styleLoaded: boolean;
}

declare global {
  interface Window {
    __WILDPULSE_MAP_DIAGNOSTICS__?: WildPulseMapDiagnostics;
  }
}
