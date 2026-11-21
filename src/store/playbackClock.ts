import { useSyncExternalStore } from 'react';
import type { InterpolatedAnimalFrame } from '../types/telemetry';

export type PlaybackSpeedMultiplier = 1 | 10 | 50 | 250;
export type PlaybackSyncMode = 'FLEET_SYNC' | 'SOLO_ANIMAL';

export interface PlaybackSnapshot {
  isPlaying: boolean;
  speedMultiplier: PlaybackSpeedMultiplier;
  minMs: number;
  maxMs: number;
  windowStartMs: number;
  windowEndMs: number;
  currentMs: number;
  syncMode: PlaybackSyncMode;
  followCam: boolean;
  hoveredFixMs: number | null;
}

export type TickListener = (
  snapshot: PlaybackSnapshot,
  frames: InterpolatedAnimalFrame[],
) => void;

type ControlListener = () => void;

class PlaybackClockController {
  private state: PlaybackSnapshot = {
    isPlaying: false,
    speedMultiplier: 50,
    minMs: Date.now() - 30 * 24 * 3600 * 1000,
    maxMs: Date.now(),
    windowStartMs: Date.now() - 30 * 24 * 3600 * 1000,
    windowEndMs: Date.now(),
    currentMs: Date.now(),
    syncMode: 'FLEET_SYNC',
    followCam: false,
    hoveredFixMs: null,
  };

  private latestFrames: InterpolatedAnimalFrame[] = [];
  private tickListeners = new Set<TickListener>();
  private controlListeners = new Set<ControlListener>();

  getSnapshot = (): PlaybackSnapshot => this.state;

  getLatestFrames = (): InterpolatedAnimalFrame[] => this.latestFrames;

  subscribeControls = (listener: ControlListener): (() => void) => {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  };

  subscribeTick = (listener: TickListener): (() => void) => {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  };

  private emitControls(): void {
    for (const listener of this.controlListeners) {
      listener();
    }
  }

  private emitTick(): void {
    for (const listener of this.tickListeners) {
      listener(this.state, this.latestFrames);
    }
  }

  initializeBounds(minMs: number, maxMs: number): void {
    const safeMin = Number.isFinite(minMs) ? minMs : Date.now() - 14 * 86400 * 1000;
    const safeMax = Number.isFinite(maxMs) && maxMs > safeMin ? maxMs : safeMin + 86400 * 1000;
    this.state = {
      ...this.state,
      minMs: safeMin,
      maxMs: safeMax,
      windowStartMs: safeMin,
      windowEndMs: safeMax,
      currentMs: safeMax,
    };
    this.emitControls();
    this.emitTick();
  }

  setWindowRange(windowStartMs: number, windowEndMs: number): void {
    const clampedStart = Math.max(this.state.minMs, Math.min(windowStartMs, this.state.maxMs));
    const clampedEnd = Math.max(clampedStart + 60_000, Math.min(windowEndMs, this.state.maxMs));
    const clampedCurrent = Math.max(clampedStart, Math.min(this.state.currentMs, clampedEnd));
    this.state = {
      ...this.state,
      windowStartMs: clampedStart,
      windowEndMs: clampedEnd,
      currentMs: clampedCurrent,
    };
    this.emitControls();
    this.emitTick();
  }

  play(): void {
    if (this.state.isPlaying) return;
    let nextCurrent = this.state.currentMs;
    if (nextCurrent >= this.state.windowEndMs) {
      nextCurrent = this.state.windowStartMs;
    }
    this.state = {
      ...this.state,
      isPlaying: true,
      currentMs: nextCurrent,
    };
    this.emitControls();
    this.emitTick();
  }

  pause(): void {
    if (!this.state.isPlaying) return;
    this.state = { ...this.state, isPlaying: false };
    this.emitControls();
  }

  togglePlay(): void {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  setSpeedMultiplier(speedMultiplier: PlaybackSpeedMultiplier): void {
    this.state = { ...this.state, speedMultiplier };
    this.emitControls();
  }

  setSyncMode(syncMode: PlaybackSyncMode): void {
    this.state = { ...this.state, syncMode };
    this.emitControls();
    this.emitTick();
  }

  setFollowCam(followCam: boolean): void {
    this.state = { ...this.state, followCam };
    this.emitControls();
  }

  toggleFollowCam(): void {
    this.setFollowCam(!this.state.followCam);
  }

  setScrubMs(epochMs: number): void {
    const clamped = Math.max(
      this.state.windowStartMs,
      Math.min(epochMs, this.state.windowEndMs),
    );
    this.state = { ...this.state, currentMs: clamped };
    this.emitTick();
  }

  advanceByDeltaRealMs(deltaRealMs: number): number {
    const span = Math.max(1, this.state.windowEndMs - this.state.windowStartMs);
    // Base rate: 1x sweeps ~12 hours of migration per real second so even 30-day tracks feel responsive,
    // scaled by speedMultiplier (1x / 10x / 50x / 250x) relative to span.
    const simMsPerSec = Math.max(3600_000, span / 180) * (this.state.speedMultiplier / 10);
    let next = this.state.currentMs + (deltaRealMs / 1000) * simMsPerSec;
    if (next >= this.state.windowEndMs) {
      next = this.state.windowStartMs;
    }
    this.state = { ...this.state, currentMs: next };
    return next;
  }

  publishInterpolatedFrames(frames: InterpolatedAnimalFrame[]): void {
    this.latestFrames = frames;
    this.emitTick();
  }

  setHoveredFixMs(hoveredFixMs: number | null): void {
    if (this.state.hoveredFixMs === hoveredFixMs) return;
    this.state = { ...this.state, hoveredFixMs };
    this.emitTick();
  }
}

export const playbackClock = new PlaybackClockController();

export function usePlaybackControls(): PlaybackSnapshot {
  return useSyncExternalStore(
    playbackClock.subscribeControls,
    playbackClock.getSnapshot,
    playbackClock.getSnapshot,
  );
}
