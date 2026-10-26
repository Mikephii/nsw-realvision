/**
 * Widget definition for Property Map.
 */

import { HugeiconsIcon } from '@hugeicons/react'
import { MapsLocation01Icon } from '@hugeicons/core-free-icons'
import {  registerWidget } from '../registry'
import { PropertyMap } from './PropertyMap'
import { PropertyMapSettings } from './PropertyMapSettings'
import type {WidgetTag} from '../registry';
import type { PropertyMapConfig } from './types'

function PropertyMapIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={MapsLocation01Icon}
      className={className}
      strokeWidth={2}
    />
  )
}

registerWidget<PropertyMapConfig>({
  type: 'property-map',
  label: 'Property Map',
  icon: PropertyMapIcon,
  defaultLayout: { w: 6, h: 5, minW: 4, minH: 3 },
  defaultConfig: () => ({
    localities: [],
    areaIds: [],
    strataFilter: 'all',
    dateFrom: null,
    dateTo: null,
    colorMode: 'price',
    minPrice: null,
    maxPrice: null,
    enableClustering: false,
    fixedDotSize: false,
  }),
  component: PropertyMap,
  settingsPanel: PropertyMapSettings,
  getTags: (config) => {
    const tags: Array<WidgetTag> = []
    if (config.strataFilter === 'freehold') tags.push({ label: 'Freehold' })
    if (config.strataFilter === 'strata') tags.push({ label: 'Strata' })
    return tags
  },
})
