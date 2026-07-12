import type { PlaybackClock } from '@cuenote/score-domain';

export const PLAYBACK_CLOCK_CHANGE_EVENT = 'cuenote:playback-clock-change';

export interface BrowserPlaybackClock extends PlaybackClock {
  subscribe?(listener: () => void): () => void;
}

declare global {
  interface Window {
    __CUENOTE_PLAYBACK_CLOCK__?: BrowserPlaybackClock;
  }
}

export function createBrowserPlaybackClock(): BrowserPlaybackClock {
  return window.__CUENOTE_PLAYBACK_CLOCK__ ?? {
    now: () => performance.now()
  };
}

export function subscribeToPlaybackClock(clock: BrowserPlaybackClock, listener: () => void): () => void {
  if (typeof clock.subscribe === 'function') {
    return clock.subscribe(listener);
  }

  const handler = () => listener();
  window.addEventListener(PLAYBACK_CLOCK_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener(PLAYBACK_CLOCK_CHANGE_EVENT, handler);
  };
}
