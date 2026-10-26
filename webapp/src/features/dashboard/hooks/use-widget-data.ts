/**
 * Hook that bridges widget config to server function calls.
 * Handles caching, staleness, and re-fetching on config change.
 *
 * This hook is what makes widget components composable — they can be used
 * inside the dashboard grid or on standalone pages without any store coupling.
 *
 * Key design decisions to prevent infinite render loops:
 * - Individual scalar selectors (not object selectors) from Zustand
 * - configKey (string) as the sole useEffect trigger
 * - Refs for config/fetcher to avoid dependency array churn
 */

import { useCallback, useEffect, useRef } from 'react'
import { useWidgetDataStore } from '../stores/widget-data-store'

const DEFAULT_STALE_MS = 5 * 60 * 1000 // 5 minutes

export function useWidgetData<TConfig, TData>(
  widgetId: string,
  config: TConfig,
  fetcher: (config: TConfig) => Promise<TData>,
  options?: { staleMs?: number },
) {
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS

  // Individual scalar selectors — Zustand uses Object.is equality,
  // so these only trigger re-renders when the value actually changes.
  // DO NOT use an object selector like `s.entries[widgetId]` — that
  // returns a new reference on every store change and causes loops.
  const data = useWidgetDataStore(
    (s) => s.entries[widgetId]?.data ?? null,
  ) as TData | null
  const isLoading = useWidgetDataStore(
    (s) => s.entries[widgetId]?.isLoading ?? false,
  )
  const error = useWidgetDataStore((s) => s.entries[widgetId]?.error ?? null)

  const configKey = JSON.stringify(config)

  // Refs to hold current values without being in dependency arrays
  const configRef = useRef(config)
  configRef.current = config
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const staleMsRef = useRef(staleMs)
  staleMsRef.current = staleMs

  // Track previous configKey so we can force refetch when config changes,
  // regardless of staleness. Without this, changing a widget's settings within
  // the stale window (5 min) would serve the old config's cached data.
  const prevConfigKeyRef = useRef<string>('')

  useEffect(() => {
    const { entries, fetchData } = useWidgetDataStore.getState()
    const entry = entries[widgetId]
    const configChanged = configKey !== prevConfigKeyRef.current
    prevConfigKeyRef.current = configKey
    const isStale =
      !entry ||
      configChanged ||
      Date.now() - entry.fetchedAt > staleMsRef.current
    if (isStale) {
      fetchData(widgetId, () => fetcherRef.current(configRef.current))
    }
    // Only re-run when config changes (via configKey) or widgetId changes.
    // fetchedAt, isLoading, etc. are intentionally excluded — we don't want
    // to re-check staleness when a fetch completes (that would loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, widgetId])

  const refetch = useCallback(() => {
    const { fetchData } = useWidgetDataStore.getState()
    fetchData(widgetId, () => fetcherRef.current(configRef.current))
  }, [widgetId])

  return { data, isLoading, error, refetch }
}
