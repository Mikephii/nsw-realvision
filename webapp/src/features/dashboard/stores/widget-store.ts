/**
 * Widget instance store — manages widget instances, configs, and grid layouts.
 * Persisted to localStorage.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getWidgetDefinition } from '../widgets/registry'
import type { GridLayout, WidgetInstanceData } from '../types'

interface WidgetStoreState {
  widgets: Record<string, WidgetInstanceData>

  addWidget: (dashboardId: string, type: string) => string
  removeWidget: (widgetId: string) => void
  removeWidgetsForDashboard: (dashboardId: string) => void
  updateWidgetConfig: (widgetId: string, config: unknown) => void
  updateLayouts: (dashboardId: string, layouts: Array<GridLayout>) => void
}

export const useWidgetStore = create<WidgetStoreState>()(
  persist(
    (set) => ({
      widgets: {},

      addWidget: (dashboardId, type) => {
        const def = getWidgetDefinition(type)
        if (!def) throw new Error(`Unknown widget type: ${type}`)
        const id = crypto.randomUUID()
        const widget: WidgetInstanceData = {
          id,
          dashboardId,
          type,
          config: def.defaultConfig(),
          layout: { i: id, x: 0, y: Infinity, ...def.defaultLayout },
        }
        set((s) => ({ widgets: { ...s.widgets, [id]: widget } }))
        return id
      },

      removeWidget: (widgetId) => {
        set((s) => {
          const { [widgetId]: _, ...rest } = s.widgets
          return { widgets: rest }
        })
      },

      removeWidgetsForDashboard: (dashboardId) => {
        set((s) => {
          const remaining: Record<string, WidgetInstanceData> = {}
          for (const [id, w] of Object.entries(s.widgets)) {
            if (w.dashboardId !== dashboardId) remaining[id] = w
          }
          return { widgets: remaining }
        })
      },

      updateWidgetConfig: (widgetId, config) => {
        set((s) => {
          const existing = s.widgets[widgetId]
          if (!existing) return s
          return {
            widgets: { ...s.widgets, [widgetId]: { ...existing, config } },
          }
        })
      },

      updateLayouts: (dashboardId, layouts) => {
        set((s) => {
          let changed = false
          const next = { ...s.widgets }
          for (const layout of layouts) {
            const existing = next[layout.i]
            if (existing && existing.dashboardId === dashboardId) {
              const prev = existing.layout
              if (
                prev.x !== layout.x ||
                prev.y !== layout.y ||
                prev.w !== layout.w ||
                prev.h !== layout.h
              ) {
                next[layout.i] = { ...existing, layout }
                changed = true
              }
            }
          }
          return changed ? { widgets: next } : s
        })
      },
    }),
    { name: 'rv-widgets' },
  ),
)
