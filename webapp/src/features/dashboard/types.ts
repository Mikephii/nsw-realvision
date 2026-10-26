/**
 * Shared types for the dashboard builder system.
 */

/** Grid position for react-grid-layout */
export interface GridLayout {
  i: string // widget id
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

/** Serialized dashboard metadata */
export interface DashboardData {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/** Serialized widget instance */
export interface WidgetInstanceData {
  id: string
  dashboardId: string
  type: string
  config: unknown
  layout: GridLayout
}
