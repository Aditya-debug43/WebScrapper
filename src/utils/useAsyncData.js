import { useEffect, useState } from "react";

/**
 * Standardizes loading/error/data state for service calls. The fetcher is
 * always async today (resolving from mock data); this is the exact shape a
 * fetcher backed by the Java REST API would have, so pages don't change when
 * the service layer's internals do.
 */
export function useAsyncData(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, loading: false, error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
