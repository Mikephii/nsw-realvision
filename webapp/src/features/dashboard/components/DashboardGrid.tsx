/**
 * Dashboard grid — renders widget instances in a draggable/resizable grid
 * using react-grid-layout v2.
 */

import { useCallback, useMemo } from 'react'
import { Responsive, useContainerWidth } from 'react-grid-layout'
import { useWidgetStore } from '../stores/widget-store'
import { getWidgetDefinition } from '../widgets/registry'
import { WidgetShell } from './WidgetShell'
import type { Layout, LayoutItem } from 'react-grid-layout'
import type { GridLayout } from '../types'
import 'react-grid-layout/css/styles.css'

const BREAKPOINTS = { lg: 1200, md: 768, sm: 480 }
const COLS = { lg: 12, md: 8, sm: 4 }
const ROW_HEIGHT = 80

interface Props {
  dashboardId: string
}

export function DashboardGrid({ dashboardId }: Props) {
  const allWidgets = useWidgetStore((s) => s.widgets)
  const updateLayouts = useWidgetStore((s) => s.updateLayouts)
  const widgets = useMemo(
    () =>
      Object.values(allWidgets).filter((w) => w.dashboardId === dashboardId),
    [allWidgets, dashboardId],
  )
  const { containerRef, width } = useContainerWidth()

  const layouts = useMemo(
    () => ({
      lg: widgets.map(
        (w): LayoutItem => ({
          i: w.layout.i,
          x: w.layout.x,
          y: w.layout.y,
          w: w.layout.w,
          h: w.layout.h,
          minW: w.layout.minW,
          minH: w.layout.minH,
        }),
      ),
    }),
    [widgets],
  )

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      const mapped: Array<GridLayout> = newLayout.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }))
      updateLayouts(dashboardId, mapped)
    },
    [dashboardId, updateLayouts],
  )

  if (widgets.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
      >
        No widgets yet. Click "Add Widget" to get started.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="pb-48">
      {width > 0 && (
        <Responsive
          width={width}
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          dragConfig={{
            enabled: true,
            handle: '.widget-drag-handle',
            bounded: false,
          }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          onLayoutChange={handleLayoutChange}
        >
          {widgets.map((widget) => {
            const def = getWidgetDefinition(widget.type)
            if (!def) return null
            const WidgetComponent = def.component
            return (
              <div key={widget.id}>
                <WidgetShell widgetId={widget.id} type={widget.type}>
                  <WidgetComponent
                    config={widget.config}
                    widgetId={widget.id}
                  />
                </WidgetShell>
              </div>
            )
          })}
        </Responsive>
      )}
    </div>
  )
}
