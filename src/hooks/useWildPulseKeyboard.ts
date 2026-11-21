import { useEffect } from 'react';
import { playbackClock } from '../store/playbackClock';
import { useTelemetryStore } from '../store/telemetryStore';
import type { BasemapId } from '../types/telemetry';

const BASEMAP_BY_DIGIT: Record<string, BasemapId> = {
  '1': 'dark-tactical',
  '2': 'satellite',
  '3': 'terrain',
  '4': 'ocean',
};

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  if (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  ) {
    return true;
  }
  return target.isContentEditable;
}

/**
 * Registers global WildPulse tactical command shortcuts:
 * - `[` : Toggle Left Fleet Discovery Panel
 * - `]` : Toggle Right Animal Bio-Dossier Drawer
 * - `Space` : Play / Pause Migration Playback (ignored inside inputs/textareas)
 * - `F` : Toggle Follow-Cam tracking
 * - `Esc` : Close Study Importer modal or clear active selection
 * - `1–4` : Switch Basemaps (Dark Tactical, Satellite, Terrain, Ocean)
 */
export function useWildPulseKeyboard(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key === 'Escape') {
        const state = useTelemetryStore.getState();
        if (state.studyImporterOpen) {
          event.preventDefault();
          state.setStudyImporterOpen(false);
          return;
        }
        if (state.selectedAnimalId) {
          event.preventDefault();
          state.selectAnimal(null);
        }
        return;
      }

      if (isEditableElement(event.target)) {
        return;
      }

      if (event.repeat) {
        return;
      }

      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        playbackClock.togglePlay();
        return;
      }

      if (event.key === '[') {
        event.preventDefault();
        useTelemetryStore.getState().toggleLeftDrawer();
        return;
      }

      if (event.key === ']') {
        event.preventDefault();
        useTelemetryStore.getState().toggleRightDrawer();
        return;
      }

      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        playbackClock.toggleFollowCam();
        return;
      }

      const basemap = BASEMAP_BY_DIGIT[event.key];
      if (basemap) {
        event.preventDefault();
        useTelemetryStore.getState().setBasemap(basemap);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
