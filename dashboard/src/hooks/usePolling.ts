'use client';

import { useEffect, useRef, useCallback } from 'react';

interface UsePollingOptions {
  interval: number;
  enabled?: boolean;
  immediate?: boolean;
}

export function usePolling(
  callback: () => Promise<void> | void,
  { interval, enabled = true, immediate = true }: UsePollingOptions
) {
  const savedCallback = useRef(callback);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }

    if (immediate) {
      savedCallback.current();
    }

    timerRef.current = setInterval(() => {
      savedCallback.current();
    }, interval);

    return stop;
  }, [interval, enabled, immediate, stop]);

  return { stop };
}
