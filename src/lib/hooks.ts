"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { subscribeToEvents, type EventData } from "./api";

// Retry backoff bounds: 2s initially, doubling up to 5s max.
const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 5_000;

export type PollingResult<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Consecutive fetch failures; resets to 0 on any success. Use >= 10 to render a "never connected" error card. */
  failures: number;
  refresh: () => void;
};

/**
 * Poll `fetcher` every `intervalMs` (0 = single-shot, retried until success so
 * a cold-starting daemon's 503s don't leave the UI loading forever). While a
 * fetch fails, retries use exponential backoff capped at 5s; the normal
 * interval resumes after any success.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = []
): PollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState(0);

  const aliveRef = useRef(true);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextDelay = useRef(BACKOFF_START_MS);

  const refresh = useCallback(async () => {
    const succeed = (result: T) => {
      if (!aliveRef.current) return;
      setData(result);
      setError(null);
      setFailures(0);
      nextDelay.current = BACKOFF_START_MS;
    };
    const fail = (err: unknown) => {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setFailures((n) => n + 1);
      const delay = nextDelay.current;
      nextDelay.current = Math.min(nextDelay.current * 2, BACKOFF_MAX_MS);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        if (aliveRef.current) void refresh();
      }, delay);
    };

    try {
      succeed(await fetcher());
    } catch (err) {
      fail(err);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const intervalId =
      intervalMs > 0 ? setInterval(() => void refresh(), intervalMs) : null;
    return () => {
      aliveRef.current = false;
      if (intervalId) clearInterval(intervalId);
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, failures, refresh };
}

/** Subscribe to the SSE event stream, keeping the newest `maxEvents` entries. */
export function useSSE(maxEvents = 100): {
  events: EventData[];
  connected: boolean;
} {
  const [events, setEvents] = useState<EventData[]>([]);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const onEvent = (event: EventData) => {
      setEvents((prev) => {
        const next = [event, ...prev];
        return next.length > maxEvents ? next.slice(0, maxEvents) : next;
      });
    };
    const onDisconnect = () => setConnected(false);
    return subscribeToEvents(onEvent, onDisconnect);
  }, [maxEvents]);

  return { events, connected };
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Render a timestamp as an English relative-time string ("5m ago"). */
export function timeAgo(ts: number): string {
  const elapsed = Date.now() - ts;
  if (elapsed < MS_PER_MINUTE) return "just now";
  if (elapsed < MS_PER_HOUR) return `${Math.floor(elapsed / MS_PER_MINUTE)}m ago`;
  if (elapsed < MS_PER_DAY) return `${Math.floor(elapsed / MS_PER_HOUR)}h ago`;
  return `${Math.floor(elapsed / MS_PER_DAY)}d ago`;
}
