/**
 * Widget registry for the dashboard builder.
 * Each widget type registers a definition that includes its component,
 * settings panel, default config, and layout constraints.
 *
 * New widget types are added by calling registerWidget() — zero changes
 * to dashboard infrastructure required.
 */

import type { ComponentType } from 'react'

/** A tag derived from widget config, displayed in the title bar. */
export interface WidgetTag {
  label: string
  variant?: 'secondary' | 'outline'
}

export interface WidgetDefinition<TConfig = unknown> {
  /** Unique type key, e.g. 'median-price-line' */
  type: string
  /** Human-readable label for the add-widget picker */
  label: string
  /** Icon component for the add-widget picker */
  icon: ComponentType<{ className?: string }>
  /** Default grid dimensions (react-grid-layout units) */
  defaultLayout: { w: number; h: number; minW: number; minH: number }
  /** Factory for a fresh default config when a new widget is created */
  defaultConfig: () => TConfig
  /** The visualisation component — receives config as prop, fetches its own data */
  component: ComponentType<{ config: TConfig; widgetId: string }>
  /** The settings panel component — controlled, calls onChange to update config */
  settingsPanel: ComponentType<{
    config: TConfig
    onChange: (config: TConfig) => void
  }>
  /** Derive display tags from the current config for the title bar. */
  getTags?: (config: TConfig) => Array<WidgetTag>
}

const registry = new Map<string, WidgetDefinition>()

export function registerWidget<TConfig>(def: WidgetDefinition<TConfig>): void {
  registry.set(def.type, def as WidgetDefinition<unknown>)
}

export function getWidgetDefinition(
  type: string,
): WidgetDefinition | undefined {
  return registry.get(type)
}

export function getAllWidgetTypes(): Array<WidgetDefinition> {
  return Array.from(registry.values())
}
