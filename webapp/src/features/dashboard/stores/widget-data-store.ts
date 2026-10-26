/**
 * Ephemeral data cache store for widget data.
 * NOT persisted — holds loading/data/error state per widget.
 */

import { create } from 'zustand'

interface WidgetDataEntry {
  data: unknown
  isLoading: boolean
  error: string | null
  fetchedAt: number
  /** Monotonic counter to discard stale in-flight responses. */
  version: number
}

interface WidgetDataStoreState {
  entries: Record<string, WidgetDataEntry>

  fetchData: (widgetId: string, fetcher: () => Promise<unknown>) => void
  invalidate: (widgetId: string) => void
  clearWidget: (widgetId: string) => void
}

export const useWidgetDataStore = create<WidgetDataStoreState>((set, get) => ({
  entries: {},

  fetchData: (widgetId, fetcher) => {
    // Bump version so any in-flight response from a previous call is discarded.
    const version = (get().entries[widgetId]?.version ?? 0) + 1

    set((s) => ({
      entries: {
        ...s.entries,
        [widgetId]: {
          data: s.entries[widgetId]?.data ?? null,
          isLoading: true,
          error: null,
          fetchedAt: s.entries[widgetId]?.fetchedAt ?? 0,
          version,
        },
      },
    }))

    fetcher()
      .then((data) => {
        // Discard if a newer request has been issued since this one started
        if (get().entries[widgetId]?.version !== version) return
        set((s) => ({
          entries: {
            ...s.entries,
            [widgetId]: {
              data,
              isLoading: false,
              error: null,
              fetchedAt: Date.now(),
              version,
            },
          },
        }))
      })
      .catch((err) => {
        if (get().entries[widgetId]?.version !== version) return
        set((s) => ({
          entries: {
            ...s.entries,
            [widgetId]: {
              // Preserve existing data on error so the visualization stays visible
              data: s.entries[widgetId]?.data ?? null,
              isLoading: false,
              error: err instanceof Error ? err.message : 'Failed to load data',
              fetchedAt: Date.now(),
              version,
            },
          },
        }))
      })
  },

  invalidate: (widgetId) => {
    set((s) => {
      const existing = s.entries[widgetId]
      if (!existing) return s
      return {
        entries: {
          ...s.entries,
          [widgetId]: { ...existing, fetchedAt: 0 },
        },
      }
    })
  },

  clearWidget: (widgetId) => {
    set((s) => {
      const { [widgetId]: _, ...rest } = s.entries
      return { entries: rest }
    })
  },
}))
