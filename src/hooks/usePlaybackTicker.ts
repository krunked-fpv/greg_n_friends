import { useEffect, useRef } from 'react';
import { playbackClock, usePlaybackControls } from '../store/playbackClock';
import { useTelemetryStore } from '../store/telemetryStore';
import { kinematicsBridge } from '../workers/kinematicsBridge';

/**
 * Drives the 60fps requestAnimationFrame migration playback loop via `playbackClock`
 * and offloads temporal interpolation to `kinematicsBridge` (WebWorker with sync fallback)
 * without triggering React component re-renders.
 */
export function usePlaybackTicker(): void {
  const animals = useTelemetryStore((state) => state.animals);
  const { isPlaying } = usePlaybackControls();

  const inFlightRef = useRef(false);
  const queuedMsRef = useRef<number | null>(null);
  const lastDispatchedMsRef = useRef<number | null>(null);
  const isPublishingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const dispatchInterpolation = async (targetMs: number): Promise<void> => {
    if (!mountedRef.current) return;
    if (inFlightRef.current) {
      queuedMsRef.current = targetMs;
      return;
    }

    inFlightRef.current = true;
    lastDispatchedMsRef.current = targetMs;
    try {
      const frames = await kinematicsBridge.interpolateFleet(targetMs);
      if (!mountedRef.current) return;
      isPublishingRef.current = true;
      try {
        playbackClock.publishInterpolatedFrames(frames);
      } finally {
        isPublishingRef.current = false;
      }
    } catch {
      // Fallback already handled inside kinematicsBridge
    } finally {
      inFlightRef.current = false;
      const nextQueued = queuedMsRef.current;
      queuedMsRef.current = null;
      if (nextQueued !== null && mountedRef.current) {
        void dispatchInterpolation(nextQueued);
      }
    }
  };

  // Sync updated fleet into the worker and publish initial/static frames immediately
  useEffect(() => {
    kinematicsBridge.setFleet(animals);
    const currentMs = playbackClock.getSnapshot().currentMs;
    void dispatchInterpolation(currentMs);
  }, [animals]);

  // React to manual scrubber moves or bounds initialization while paused
  useEffect(() => {
    const unsubscribe = playbackClock.subscribeTick((snapshot) => {
      if (isPublishingRef.current) return;
      if (snapshot.currentMs !== lastDispatchedMsRef.current) {
        void dispatchInterpolation(snapshot.currentMs);
      }
    });
    return unsubscribe;
  }, []);

  // 60fps animation frame loop active only while playing
  useEffect(() => {
    if (!isPlaying) return;

    let active = true;
    let rafId = 0;
    let lastPerfMs: number | null = null;

    const tick = (nowPerfMs: number): void => {
      if (!active) return;
      const deltaRealMs =
        lastPerfMs === null
          ? 16.67
          : Math.min(100, Math.max(0, nowPerfMs - lastPerfMs));
      lastPerfMs = nowPerfMs;

      const nextSimMs = playbackClock.advanceByDeltaRealMs(deltaRealMs);
      void dispatchInterpolation(nextSimMs);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      active = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isPlaying]);
}
