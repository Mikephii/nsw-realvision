/**
 * Dashboard metadata store — manages the collection of saved dashboards
 * and which one is currently active. Persisted to localStorage.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useWidgetStore } from './widget-store'
import type { DashboardData } from '../types'

interface DashboardStoreState {
  dashboards: Array<DashboardData>
  activeDashboardId: string | null

  createDashboard: (name: string) => string
  deleteDashboard: (id: string) => void
  renameDashboard: (id: string, name: string) => void
  setActiveDashboard: (id: string) => void
}

export const useDashboardStore = create<DashboardStoreState>()(
  persist(
    (set) => ({
      dashboards: [],
      activeDashboardId: null,

      createDashboard: (name) => {
        const id = crypto.randomUUID()
        const now = Date.now()
        set((s) => ({
          dashboards: [
            ...s.dashboards,
            { id, name, createdAt: now, updatedAt: now },
          ],
          activeDashboardId: id,
        }))
        return id
      },

      deleteDashboard: (id) => {
        set((s) => {
          const remaining = s.dashboards.filter((d) => d.id !== id)
          return {
            dashboards: remaining,
            activeDashboardId:
              s.activeDashboardId === id
                ? (remaining[0]?.id ?? null)
                : s.activeDashboardId,
          }
        })
        // Clean up widgets belonging to this dashboard
        useWidgetStore.getState().removeWidgetsForDashboard(id)
      },

      renameDashboard: (id, name) => {
        set((s) => ({
          dashboards: s.dashboards.map((d) =>
            d.id === id ? { ...d, name, updatedAt: Date.now() } : d,
          ),
        }))
      },

      setActiveDashboard: (id) => set({ activeDashboardId: id }),
    }),
    { name: 'rv-dashboards' },
  ),
)
