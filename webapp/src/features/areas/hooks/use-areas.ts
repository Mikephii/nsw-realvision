/**
 * React hooks for accessing custom areas from the area store.
 *
 * These hooks provide the primary way for components to read area data
 * and invoke area actions. They use individual Zustand selectors to
 * minimise re-renders (following the pattern from `use-widget-data.ts`).
 */

import { useMemo } from 'react'
import { useAreaStore } from '../area-store'
import type { CustomArea } from '../types'

/**
 * Returns all saved custom areas as an array, sorted newest first.
 *
 * Components using this hook re-render when any area is added,
 * updated, or removed.
 *
 * @example
 * ```tsx
 * function AreaList() {
 *   const areas = useAreas()
 *   return areas.map(a => <div key={a.id}>{a.name}</div>)
 * }
 * ```
 */
export function useAreas(): Array<CustomArea> {
  const areas = useAreaStore((s) => s.areas)
  return useMemo(() => {
    const list = Object.values(areas)
    list.sort((a, b) => b.createdAt - a.createdAt)
    return list
  }, [areas])
}

/**
 * Returns a single custom area by ID, or `undefined` if not found.
 *
 * Only re-renders when the specific area changes (or is deleted).
 *
 * @param id - The area ID to look up.
 *
 * @example
 * ```tsx
 * function AreaName({ areaId }: { areaId: string }) {
 *   const area = useArea(areaId)
 *   return <span>{area?.name ?? 'Unknown'}</span>
 * }
 * ```
 */
export function useArea(id: string): CustomArea | undefined {
  return useAreaStore((s) => s.areas[id])
}

/**
 * Returns stable references to area store actions.
 *
 * Actions are safe to call from event handlers and effects without
 * causing re-renders (they're store methods, not state).
 *
 * @example
 * ```tsx
 * function CreateButton() {
 *   const { create } = useAreaActions()
 *   return <button onClick={() => create({ name: 'New Area', polygon, color: '#3b82f6' })}>
 *     Create
 *   </button>
 * }
 * ```
 */
export function useAreaActions() {
  const create = useAreaStore((s) => s.create)
  const update = useAreaStore((s) => s.update)
  const remove = useAreaStore((s) => s.remove)
  const getById = useAreaStore((s) => s.getById)

  return useMemo(
    () => ({ create, update, remove, getById }),
    [create, update, remove, getById],
  )
}
