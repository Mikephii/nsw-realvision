/**
 * Area store — manages the collection of user-defined custom areas.
 *
 * Implements {@link AreaRepository} as Zustand actions with localStorage
 * persistence. The store is the single source of truth for area data
 * and is consumed by React hooks ({@link useAreas}) and query resolvers.
 *
 * Areas are keyed by ID in a `Record<string, CustomArea>` for O(1) lookup,
 * following the same pattern as the widget store.
 *
 * **Storage:** areas live in the browser's localStorage. To keep them on a
 * server instead, write another `AreaRepository` implementation with the
 * same interface. All consumers use the repository methods via hooks, so no
 * downstream changes are needed.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AREA_COLORS } from './types'
import type {
  AreaRepository,
  CustomArea,
  CustomAreaCreate,
  CustomAreaUpdate,
} from './types'
import { useWidgetStore } from '@/features/dashboard/stores/widget-store'

// ---------------------------------------------------------------------------
// Store State
// ---------------------------------------------------------------------------

interface AreaStoreState extends AreaRepository {
  /** All saved areas, keyed by ID for O(1) lookup. */
  areas: Record<string, CustomArea>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAreaStore = create<AreaStoreState>()(
  persist(
    (set, get) => ({
      areas: {},

      getAll() {
        const areas = Object.values(get().areas)
        // Newest first
        areas.sort((a, b) => b.createdAt - a.createdAt)
        return areas
      },

      getById(id: string) {
        return get().areas[id]
      },

      create(input: CustomAreaCreate) {
        const id = crypto.randomUUID()
        const now = Date.now()

        // Auto-assign color if not provided, round-robin from palette
        const existingCount = Object.keys(get().areas).length
        const color =
          input.color || AREA_COLORS[existingCount % AREA_COLORS.length]

        const area: CustomArea = {
          id,
          name: input.name,
          description: input.description,
          polygon: input.polygon,
          color,
          createdAt: now,
          updatedAt: now,
        }

        set((s) => ({ areas: { ...s.areas, [id]: area } }))
        return id
      },

      update(id: string, changes: CustomAreaUpdate) {
        set((s) => {
          const existing = s.areas[id]
          if (!existing) return s
          return {
            areas: {
              ...s.areas,
              [id]: { ...existing, ...changes, updatedAt: Date.now() },
            },
          }
        })
      },

      remove(id: string) {
        set((s) => {
          const { [id]: _, ...rest } = s.areas
          return { areas: rest }
        })
        // Scrub the deleted ID from all widget configs
        scrubAreaIdFromWidgets(id)
      },
    }),
    { name: 'rv-areas' },
  ),
)

/** Remove a deleted area ID from every widget config that references it. */
function scrubAreaIdFromWidgets(areaId: string) {
  const { widgets, updateWidgetConfig } = useWidgetStore.getState()
  for (const [widgetId, widget] of Object.entries(widgets)) {
    const cfg = widget.config as Record<string, unknown>
    const areaIds = cfg.areaIds as Array<string> | undefined
    if (areaIds?.includes(areaId)) {
      updateWidgetConfig(widgetId, {
        ...cfg,
        areaIds: areaIds.filter((id) => id !== areaId),
      })
    }
  }
}
