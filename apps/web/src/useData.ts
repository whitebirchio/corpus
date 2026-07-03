import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fetch-on-mount with "refetch keeps the frame": while reloading (dep change,
 * tab refocus), the previous data stays rendered at reduced opacity instead of
 * flashing a spinner. Refetches when the PWA is foregrounded.
 */
export function useData<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): { data: T | null; error: string | null; stale: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(true);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setStale(true);
    try {
      const result = await fetcher();
      if (gen !== generation.current) return; // superseded by a newer request
      setData(result);
      setError(null);
    } catch (e) {
      if (gen !== generation.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === generation.current) setStale(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  return { data, error, stale, reload: () => void load() };
}
